"""Load generator subprocess for the admin load test (see loadtest.py).

Run as ``python -m app.modules.admin.loadtest_runner``: reads one JSON config
object on stdin, drives the API over real HTTP/WebSocket on 127.0.0.1, and
writes one JSON event per line on stdout:

    {"event": "phase_start", "phase": "...", "label": "...", "concurrency": N}
    {"event": "progress", "phase": "...", "elapsed": s, "requests": n, "rps": x}
    {"event": "phase_end", "result": {...}}
    {"event": "setup", "books": n, "exchanges": n, "chats": n}
    {"event": "done"}  |  {"event": "error", "message": "..."}

Deliberately imports nothing from the app: it must stay a thin, cheap client
so the numbers measure the server, not this process. Every request carries
the run's X-Loadtest-Key, which lets it through maintenance mode.
"""

from __future__ import annotations

import asyncio
import json
import random
import resource
import signal
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlsplit

API = "/api/v1"


def emit(event: str, **data: Any) -> None:
    sys.stdout.write(json.dumps({"event": event, **data}, default=str) + "\n")
    sys.stdout.flush()


# ── Minimal keep-alive HTTP/1.1 client ──────────────────────────────────────


class HttpConn:
    def __init__(self, host: str, port: int, key: str) -> None:
        self.host, self.port, self.key = host, port, key
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None

    async def close(self) -> None:
        if self.writer is not None:
            self.writer.close()
        self.reader = self.writer = None

    async def request(
        self, method: str, path: str, token: str | None = None, body: Any = None
    ) -> tuple[int, bytes]:
        if self.writer is None:
            self.reader, self.writer = await asyncio.open_connection(self.host, self.port)
        payload = b"" if body is None else json.dumps(body).encode()
        head = (
            f"{method} {path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\n"
            f"X-Loadtest-Key: {self.key}\r\nUser-Agent: meetbook-loadtest\r\n"
        )
        if token:
            head += f"Authorization: Bearer {token}\r\n"
        if body is not None:
            head += "Content-Type: application/json\r\n"
        head += f"Content-Length: {len(payload)}\r\n\r\n"
        self.writer.write(head.encode() + payload)
        try:
            return await self._read()
        except BaseException:
            await self.close()
            raise

    async def _read(self) -> tuple[int, bytes]:
        assert self.reader is not None
        raw = await self.reader.readuntil(b"\r\n\r\n")
        lines = raw.split(b"\r\n")
        status = int(lines[0].split(b" ", 2)[1])
        length, chunked, close = 0, False, False
        for line in lines[1:]:
            name, _, value = line.partition(b":")
            name = name.strip().lower()
            if name == b"content-length":
                length = int(value)
            elif name == b"transfer-encoding" and b"chunked" in value.lower():
                chunked = True
            elif name == b"connection" and b"close" in value.lower():
                close = True
        body = b""
        if chunked:
            parts = []
            while True:
                size = int((await self.reader.readuntil(b"\r\n")).split(b";")[0], 16)
                parts.append(await self.reader.readexactly(size + 2))
                if size == 0:
                    break
            body = b"".join(p[:-2] for p in parts)
        elif length:
            body = await self.reader.readexactly(length)
        if close:
            await self.close()
        return status, body


# ── Test fixture (built by setup()) ─────────────────────────────────────────


@dataclass
class VUser:
    id: str
    token: str
    books: list[str] = field(default_factory=list)
    exchanges: list[str] = field(default_factory=list)
    chats: list[str] = field(default_factory=list)
    # exchange_id -> a message id in that chat (for mark-read)
    message_ids: dict[str, str] = field(default_factory=dict)


@dataclass
class Fixture:
    users: list[VUser]
    lat: float
    lng: float
    login: dict[str, str] | None

    def pick(self) -> tuple[VUser, VUser]:
        u = random.choice(self.users)
        other = random.choice(self.users)
        while other is u and len(self.users) > 1:
            other = random.choice(self.users)
        return u, other


# ── Scenarios ───────────────────────────────────────────────────────────────
# builder(fixture) -> (method, path, token, body)

Req = tuple[str, str, str | None, Any]


def _bbox(f: Fixture) -> str:
    return (
        f"min_lat={f.lat - 0.1}&max_lat={f.lat + 0.1}&min_lng={f.lng - 0.1}&max_lng={f.lng + 0.1}"
    )


def _s_health(f: Fixture) -> Req:
    return "GET", f"{API}/health", None, None


def _s_me(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/auth/me", u.token, None


def _s_search(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/books/search?lat={f.lat}&lng={f.lng}&radius_km=25", u.token, None


def _s_bbox(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/books/search-bbox?{_bbox(f)}", u.token, None


def _s_clusters(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/books/clusters?{_bbox(f)}", u.token, None


def _s_book_detail(f: Fixture) -> Req:
    u, o = f.pick()
    return "GET", f"{API}/books/{random.choice(o.books)}", u.token, None


def _s_my_books(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/books/me", u.token, None


def _s_exchanges(f: Fixture) -> Req:
    u, _ = f.pick()
    role = random.choice(["sent", "received"])
    return "GET", f"{API}/exchanges?role={role}", u.token, None


def _s_exchange_detail(f: Fixture) -> Req:
    u = random.choice([x for x in f.users if x.exchanges])
    return "GET", f"{API}/exchanges/{random.choice(u.exchanges)}", u.token, None


def _s_chat_list(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/chat", u.token, None


def _s_chat_messages(f: Fixture) -> Req:
    u = random.choice([x for x in f.users if x.exchanges])
    return "GET", f"{API}/exchanges/{random.choice(u.exchanges)}/chat/messages", u.token, None


def _s_notifications(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/notifications", u.token, None


def _s_wishlist(f: Fixture) -> Req:
    u, _ = f.pick()
    return "GET", f"{API}/wishlist", u.token, None


def _s_profile(f: Fixture) -> Req:
    u, o = f.pick()
    return "GET", f"{API}/auth/users/{o.id}", u.token, None


def _book_body(f: Fixture) -> dict[str, Any]:
    return {
        "title": f"Yük Testi Kitabı {random.randint(1, 10**6)}",
        "author": "MeetBook Load Test",
        "category": random.choice(["fiction", "non_fiction", "children"]),
        "condition": random.choice(["new", "like_new", "good"]),
        "language": "tr",
        "location": {
            "lat": f.lat + random.uniform(-0.03, 0.03),
            "lng": f.lng + random.uniform(-0.03, 0.03),
        },
    }


def _s_book_create(f: Fixture) -> Req:
    u, _ = f.pick()
    return "POST", f"{API}/books", u.token, _book_body(f)


def _s_book_update(f: Fixture) -> Req:
    u, _ = f.pick()
    body = {"description": f"Güncellendi {random.randint(1, 10**6)}"}
    return "PATCH", f"{API}/books/{random.choice(u.books)}", u.token, body


def _s_book_view(f: Fixture) -> Req:
    u, o = f.pick()
    return "POST", f"{API}/books/{random.choice(o.books)}/view", u.token, None


def _s_favorite(f: Fixture) -> Req:
    u, o = f.pick()
    method = random.choice(["POST", "DELETE"])
    return method, f"{API}/books/{random.choice(o.books)}/favorite", u.token, None


def _s_wishlist_add(f: Fixture) -> Req:
    u, _ = f.pick()
    return "POST", f"{API}/wishlist", u.token, {"title": f"İstek {random.randint(1, 10**6)}"}


def _s_chat_read(f: Fixture) -> Req:
    u = random.choice([x for x in f.users if x.message_ids])
    ex, msg = random.choice(list(u.message_ids.items()))
    return "POST", f"{API}/exchanges/{ex}/chat/read", u.token, {"up_to_message_id": msg}


def _s_login(f: Fixture) -> Req:
    assert f.login is not None
    return "POST", f"{API}/auth/login", None, dict(f.login)


@dataclass(frozen=True)
class Scenario:
    name: str
    label: str
    group: str  # read | write | auth | ws
    build: Callable[[Fixture], Req] | None
    weight: float = 1.0  # share in the mixed-traffic phase (0 = excluded)
    max_concurrency: int | None = None
    # Answers that are correct for this scenario, not failures (a random
    # favorite toggle legitimately gets "already favorited" / "not favorited").
    ok_statuses: frozenset[int] = frozenset()
    # Fixture data it needs: exchanges | chats | messages | login
    needs: str | None = None


SCENARIOS: dict[str, Scenario] = {
    s.name: s
    for s in [
        Scenario("health", "Sağlık kontrolü (DB + Redis)", "read", _s_health, 0.5),
        Scenario("me", "Profilim (/auth/me)", "read", _s_me, 3),
        Scenario("search", "Yakındaki kitaplar (arama)", "read", _s_search, 3),
        Scenario("bbox", "Harita alanı (bbox)", "read", _s_bbox, 4),
        Scenario("clusters", "Harita kümeleri", "read", _s_clusters, 2),
        Scenario("book_detail", "Kitap detayı", "read", _s_book_detail, 4),
        Scenario("my_books", "Kitaplarım", "read", _s_my_books, 1),
        Scenario("exchanges", "Takas listesi", "read", _s_exchanges, 2),
        Scenario(
            "exchange_detail", "Takas detayı", "read", _s_exchange_detail, 1, needs="exchanges"
        ),
        Scenario("chat_list", "Sohbet listesi", "read", _s_chat_list, 2),
        Scenario(
            "chat_messages", "Sohbet mesajları", "read", _s_chat_messages, 2, needs="exchanges"
        ),
        Scenario("notifications", "Bildirimler", "read", _s_notifications, 2),
        Scenario("wishlist", "İstek listesi", "read", _s_wishlist, 1),
        Scenario("profile", "Kullanıcı profili", "read", _s_profile, 1),
        Scenario("book_create", "Kitap ekleme", "write", _s_book_create, 0.3),
        Scenario("book_update", "Kitap güncelleme", "write", _s_book_update, 0.3),
        Scenario("book_view", "Kitap görüntülenme kaydı", "write", _s_book_view, 1),
        Scenario(
            "favorite",
            "Favori ekle/çıkar",
            "write",
            _s_favorite,
            0.5,
            ok_statuses=frozenset({404, 409}),
        ),
        Scenario("wishlist_add", "İstek listesine ekleme", "write", _s_wishlist_add, 0.2),
        Scenario(
            "chat_read", "Mesajları okundu işaretle", "write", _s_chat_read, 0.5, needs="messages"
        ),
        # argon2 verify is CPU-bound by design: few parallel logins only.
        Scenario("login", "Giriş (argon2)", "auth", _s_login, 0, max_concurrency=4, needs="login"),
        Scenario("ws_chat", "WebSocket mesaj gönderimi", "ws", None, 0, needs="chats"),
    ]
}


# ── Measurement ─────────────────────────────────────────────────────────────


class Stats:
    def __init__(self) -> None:
        self.latencies: list[float] = []
        self.statuses: Counter[str] = Counter()
        self.samples: list[dict[str, Any]] = []  # a few failed responses
        self.ok = 0

    def record(
        self,
        status: int | str,
        latency: float | None,
        body: bytes = b"",
        expected: frozenset[int] = frozenset(),
    ) -> None:
        self.statuses[str(status)] += 1
        if latency is not None:
            self.latencies.append(latency)
        ok = isinstance(status, int) and (200 <= status < 400 or status in expected)
        self.ok += ok
        if not ok and len(self.samples) < 5:
            self.samples.append({"status": status, "body": body[:300].decode("utf-8", "replace")})

    @property
    def count(self) -> int:
        return sum(self.statuses.values())

    def summary(self, elapsed: float) -> dict[str, Any]:
        lat = sorted(self.latencies)

        def pct(p: float) -> float:
            return round(lat[min(len(lat) - 1, int(len(lat) * p))] * 1000, 2) if lat else 0.0

        total = self.count
        ok = self.ok
        return {
            "requests": total,
            "ok": ok,
            "errors": total - ok,
            "error_rate": round((total - ok) / total * 100, 2) if total else 0.0,
            "rps": round(total / elapsed, 1) if elapsed else 0.0,
            "ok_rps": round(ok / elapsed, 1) if elapsed else 0.0,
            "p50_ms": pct(0.50),
            "p90_ms": pct(0.90),
            "p95_ms": pct(0.95),
            "p99_ms": pct(0.99),
            "max_ms": round(lat[-1] * 1000, 2) if lat else 0.0,
            "mean_ms": round(sum(lat) / len(lat) * 1000, 2) if lat else 0.0,
            "statuses": dict(self.statuses),
            "error_samples": self.samples,
        }


def _cpu_seconds() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


async def run_phase(
    phase: str,
    label: str,
    worker: Callable[[Stats, float], Any],
    concurrency: int,
    duration: float,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    emit("phase_start", phase=phase, label=label, concurrency=concurrency, duration=duration)
    stats = Stats()
    started = time.perf_counter()
    cpu0 = _cpu_seconds()
    deadline = started + duration

    async def progress() -> None:
        last_n, last_t = 0, started
        while True:
            await asyncio.sleep(1)
            now, n = time.perf_counter(), stats.count
            emit(
                "progress",
                phase=phase,
                elapsed=round(now - started, 1),
                requests=n,
                rps=round((n - last_n) / (now - last_t), 1),
            )
            last_n, last_t = n, now

    ticker = asyncio.create_task(progress())
    try:
        await asyncio.gather(*(worker(stats, deadline) for _ in range(concurrency)))
    finally:
        ticker.cancel()
    elapsed = time.perf_counter() - started
    result = {
        "phase": phase,
        "label": label,
        "concurrency": concurrency,
        "duration_s": round(elapsed, 2),
        "runner_cpu_pct": round((_cpu_seconds() - cpu0) / elapsed * 100, 1),
        **stats.summary(elapsed),
        **(extra or {}),
    }
    emit("phase_end", result=result)
    return result


def http_worker(host: str, port: int, key: str, fx: Fixture, pick: Callable[[], Scenario]):
    async def worker(stats: Stats, deadline: float) -> None:
        conn = HttpConn(host, port, key)
        try:
            while time.perf_counter() < deadline:
                sc = pick()
                assert sc.build is not None
                method, path, token, body = sc.build(fx)
                t0 = time.perf_counter()
                try:
                    status, resp = await conn.request(method, path, token, body)
                except (OSError, asyncio.IncompleteReadError, ValueError) as exc:
                    stats.record(f"error:{type(exc).__name__}", None)
                    await asyncio.sleep(0.01)
                    continue
                stats.record(status, time.perf_counter() - t0, resp, sc.ok_statuses)
        finally:
            await conn.close()

    return worker


def ws_worker(base: str, host: str, port: int, key: str, fx: Fixture):
    from websockets.asyncio.client import connect

    ws_base = "ws://" + base.split("://", 1)[1]
    seq = 0

    async def worker(stats: Stats, deadline: float) -> None:
        nonlocal seq
        conn = HttpConn(host, port, key)
        u = random.choice([x for x in fx.users if x.chats])
        chat_id = random.choice(u.chats)
        try:
            status, body = await conn.request("POST", f"{API}/chat/ticket", u.token)
        finally:
            await conn.close()
        if status != 200:
            stats.record(status, None, body)
            return
        ticket = json.loads(body)["ticket"]
        try:
            async with connect(
                f"{ws_base}/ws/chat?ticket={ticket}",
                additional_headers={"X-Loadtest-Key": key},
                open_timeout=10,
                max_size=2**20,
            ) as ws:
                while time.perf_counter() < deadline:
                    seq += 1
                    marker = f"lt-{id(ws)}-{seq}"
                    t0 = time.perf_counter()
                    await ws.send(json.dumps({"type": "send", "chat_id": chat_id, "text": marker}))
                    # Wait for our own message to come back (server echo).
                    while True:
                        remaining = deadline + 5 - time.perf_counter()
                        frame = json.loads(await asyncio.wait_for(ws.recv(), max(remaining, 0.1)))
                        if frame.get("type") == "error":
                            stats.record("ws_error", None, str(frame.get("error")).encode())
                            break
                        msg = frame.get("message") or {}
                        if frame.get("type") == "message" and msg.get("text") == marker:
                            stats.record(200, time.perf_counter() - t0)
                            break
        except (OSError, TimeoutError) as exc:
            stats.record(f"error:{type(exc).__name__}", None)
        except Exception as exc:  # websockets' own exception classes
            stats.record(f"error:{type(exc).__name__}", None, str(exc).encode())

    return worker


# ── Setup: books, exchanges, chats for the synthetic users ─────────────────


async def setup(host: str, port: int, key: str, fx: Fixture, books_per_user: int) -> None:
    emit("phase_start", phase="setup", label="Test verisi hazırlanıyor", concurrency=1, duration=0)
    conn = HttpConn(host, port, key)

    async def call(method: str, path: str, token: str | None, body: Any = None) -> Any:
        status, resp = await conn.request(method, path, token, body)
        if status >= 400:
            raise RuntimeError(f"setup {method} {path} -> {status}: {resp[:300]!r}")
        return json.loads(resp) if resp else None

    try:
        for u in fx.users:
            for _ in range(books_per_user):
                book = await call("POST", f"{API}/books", u.token, _book_body(fx))
                u.books.append(book["id"])
        n = len(fx.users)
        for i, requester in enumerate(fx.users):
            owner = fx.users[(i + 1) % n]
            ex = await call(
                "POST",
                f"{API}/exchanges",
                requester.token,
                {"book_id": owner.books[0], "initial_message": "Merhaba! (yük testi)"},
            )
            ex = await call("POST", f"{API}/exchanges/{ex['id']}/accept", owner.token)
            for p in (requester, owner):
                p.exchanges.append(ex["id"])
            msgs = await call("GET", f"{API}/exchanges/{ex['id']}/chat/messages", owner.token)
            items = msgs.get("items") or msgs.get("messages") or []
            if items:
                for p in (requester, owner):
                    p.message_ids[ex["id"]] = items[0]["id"]
        # The exchange's chat id comes from the chat list, not ExchangeDetail
        # (whose chat_id is the reading-buddy chat).
        for u in fx.users:
            chats = await call("GET", f"{API}/chat", u.token)
            u.chats = [c["chat_id"] for c in chats.get("items", [])]
    finally:
        await conn.close()
    emit(
        "setup",
        books=sum(len(u.books) for u in fx.users),
        exchanges=len(fx.users),
        chats=len({c for u in fx.users for c in u.chats}),
        messages=sum(len(u.message_ids) for u in fx.users),
    )


# ── Main ────────────────────────────────────────────────────────────────────


async def main() -> None:
    cfg = json.loads(sys.stdin.readline())
    base: str = cfg["base"]
    u = urlsplit(base)
    host, port = u.hostname or "127.0.0.1", u.port or 80
    key: str = cfg["key"]
    fx = Fixture(
        users=[VUser(x["id"], x["token"]) for x in cfg["users"]],
        lat=cfg["area"]["lat"],
        lng=cfg["area"]["lng"],
        login=cfg.get("login"),
    )
    conc: int = cfg["concurrency"]
    dur: float = cfg["duration"]

    await setup(host, port, key, fx, cfg.get("books_per_user", 3))

    selected = [SCENARIOS[n] for n in cfg["scenarios"] if n in SCENARIOS]
    have = {
        "exchanges": any(x.exchanges for x in fx.users),
        "chats": any(x.chats for x in fx.users),
        "messages": any(x.message_ids for x in fx.users),
        "login": bool(fx.login),
    }
    reasons = {
        "exchanges": "Takas oluşturulamadı",
        "chats": "Sohbet bulunamadı",
        "messages": "Sohbette mesaj bulunamadı",
        "login": "Giriş kullanıcısı yok",
    }
    usable = []
    for sc in selected:
        if sc.needs and not have[sc.needs]:
            emit("skip", phase=sc.name, reason=reasons[sc.needs])
            continue
        usable.append(sc)

    for sc in usable:
        c = min(conc, sc.max_concurrency or conc)
        if sc.group == "ws":
            worker = ws_worker(base, host, port, key, fx)
        else:
            worker = http_worker(host, port, key, fx, lambda sc=sc: sc)
        await run_phase(sc.name, sc.label, worker, c, dur)

    mix = [sc for sc in usable if sc.weight > 0 and sc.build is not None]
    if cfg.get("mixed") and mix:
        weights = [sc.weight for sc in mix]

        def pick() -> Scenario:
            return random.choices(mix, weights)[0]

        await run_phase(
            "mixed",
            "Karma trafik (gerçekçi dağılım)",
            http_worker(host, port, key, fx, pick),
            conc,
            dur,
        )

    ramp = cfg.get("ramp") or {}
    if ramp.get("enabled") and mix:
        weights = [sc.weight for sc in mix]

        def pick_r() -> Scenario:
            return random.choices(mix, weights)[0]

        for step in ramp["steps"]:
            r = await run_phase(
                f"ramp@{step}",
                f"Kapasite rampası — {step} eşzamanlı",
                http_worker(host, port, key, fx, pick_r),
                step,
                ramp.get("duration", dur),
                extra={"ramp_step": step},
            )
            if r["error_rate"] > 5 or r["p95_ms"] > 3000:
                emit("ramp_stop", step=step, reason="hata oranı > %5 veya p95 > 3 sn")
                break

    emit("done")


def _entry() -> None:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        import uvloop

        run = uvloop.run
    except ImportError:
        run = asyncio.run
    try:
        run(main())
    except SystemExit:
        raise
    except BaseException as exc:
        emit("error", message=f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    _entry()
