#!/usr/bin/env python3
"""
Minimal HTTP load generator for the local API — no third-party deps.

Each worker process runs N keep-alive connections over raw asyncio streams
(HTTP/1.1), so the generator itself stays cheap and spreads over several
cores while the server under test is pinned to one. Only for LOCAL targets.

USAGE:
    python scripts/loadtest.py                       # health + /auth/me, 15s each
    python scripts/loadtest.py -d 30 -c 128 -p 4
    python scripts/loadtest.py --path /api/v1/health --no-auth
    python scripts/loadtest.py --json out.json       # machine-readable result
"""

import argparse
import asyncio
import json
import multiprocessing as mp
import statistics
import time
import urllib.request
from collections import Counter
from urllib.parse import urlsplit

DEFAULT_PATHS = ["/api/v1/health", "/api/v1/auth/me"]


def login(base: str, email: str, password: str) -> str:
    req = urllib.request.Request(  # noqa: S310 — operator-given base URL
        f"{base}/api/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 — local target
        return json.loads(resp.read())["access_token"]


async def _read_response(reader: asyncio.StreamReader) -> int:
    head = await reader.readuntil(b"\r\n\r\n")
    lines = head.split(b"\r\n")
    status = int(lines[0].split(b" ", 2)[1])
    length = 0
    chunked = False
    for line in lines[1:]:
        name, _, value = line.partition(b":")
        name = name.strip().lower()
        if name == b"content-length":
            length = int(value)
        elif name == b"transfer-encoding" and b"chunked" in value.lower():
            chunked = True
    if chunked:
        while True:
            size = int((await reader.readuntil(b"\r\n")).split(b";")[0], 16)
            await reader.readexactly(size + 2)
            if size == 0:
                break
    elif length:
        await reader.readexactly(length)
    return status


async def _connection(host, port, request, deadline, latencies, statuses) -> None:
    reader = writer = None
    while time.perf_counter() < deadline:
        try:
            if writer is None:
                reader, writer = await asyncio.open_connection(host, port)
            t0 = time.perf_counter()
            writer.write(request)
            status = await _read_response(reader)
            latencies.append(time.perf_counter() - t0)
            statuses[status] += 1
        except (OSError, asyncio.IncompleteReadError, ValueError) as exc:
            statuses[f"error:{type(exc).__name__}"] += 1
            if writer is not None:
                writer.close()
            reader = writer = None
    if writer is not None:
        writer.close()


def _worker(host, port, request, conns, duration, out) -> None:
    latencies: list[float] = []
    statuses: Counter = Counter()

    async def run() -> None:
        deadline = time.perf_counter() + duration
        await asyncio.gather(
            *(_connection(host, port, request, deadline, latencies, statuses) for _ in range(conns))
        )

    try:
        import uvloop

        uvloop.run(run())
    except ImportError:
        asyncio.run(run())
    out.put((latencies, dict(statuses)))


def bench(base: str, path: str, token: str | None, conns: int, procs: int, duration: float):
    u = urlsplit(base)
    host, port = u.hostname, u.port or 80
    headers = f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: keep-alive\r\n"
    if token:
        headers += f"Authorization: Bearer {token}\r\n"
    request = (headers + "\r\n").encode()

    out: mp.Queue = mp.Queue()
    per_proc = max(1, conns // procs)
    workers = [
        mp.Process(target=_worker, args=(host, port, request, per_proc, duration, out))
        for _ in range(procs)
    ]
    for w in workers:
        w.start()
    latencies: list[float] = []
    statuses: Counter = Counter()
    for _ in workers:
        lat, st = out.get()
        latencies.extend(lat)
        statuses.update(st)
    for w in workers:
        w.join()

    latencies.sort()

    def pct(p: float) -> float:
        return latencies[min(len(latencies) - 1, int(len(latencies) * p))] * 1000 if latencies else 0.0

    total = sum(statuses.values())
    return {
        "path": path,
        "requests": total,
        "rps": round(total / duration, 1),
        "ok_2xx": sum(v for k, v in statuses.items() if isinstance(k, int) and 200 <= k < 300),
        "statuses": {str(k): v for k, v in statuses.items()},
        "p50_ms": round(pct(0.50), 2),
        "p95_ms": round(pct(0.95), 2),
        "p99_ms": round(pct(0.99), 2),
        "mean_ms": round(statistics.fmean(latencies) * 1000, 2) if latencies else 0.0,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--path", action="append", help="repeatable; default: health + /auth/me")
    ap.add_argument("-c", "--connections", type=int, default=64)
    ap.add_argument("-p", "--procs", type=int, default=4)
    ap.add_argument("-d", "--duration", type=float, default=15)
    ap.add_argument("--email", default="demo@meetbook.app")
    ap.add_argument("--password", default="changeme123")  # dev seed user only
    ap.add_argument("--no-auth", action="store_true")
    ap.add_argument("--label", default="")
    ap.add_argument("--json", help="write results to this file")
    args = ap.parse_args()

    host = urlsplit(args.base).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"Refusing to load-test non-local host {host!r}")

    token = None if args.no_auth else login(args.base, args.email, args.password)
    results = []
    for path in args.path or DEFAULT_PATHS:
        r = bench(args.base, path, token, args.connections, args.procs, args.duration)
        r["label"] = args.label
        results.append(r)
        print(
            f"{args.label:>10} {path:<28} {r['rps']:>9.1f} req/s  "
            f"p50 {r['p50_ms']:>7.2f}ms  p95 {r['p95_ms']:>7.2f}ms  p99 {r['p99_ms']:>7.2f}ms  "
            f"statuses {r['statuses']}"
        )
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
