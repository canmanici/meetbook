"""Offline IP → country / city / ISP lookup (DB-IP "Lite" databases).

DB-IP Lite (CC BY 4.0 — attribution shown in the admin panel) is downloaded
monthly into settings.ip_db_dir by `refresh_ip_databases()` (called from
scripts/start_app.py before the server starts). Lookups are local mmdb reads —
user IPs never leave our server. If the files are missing every lookup simply
returns None and the rest of the app is unaffected.
"""

from __future__ import annotations

import gzip
import ipaddress
import logging
import os
import shutil
import time
import urllib.request
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_FILES = {
    "asn": "dbip-asn-lite.mmdb",
    "city": "dbip-city-lite.mmdb",
}
_URL = "https://download.db-ip.com/free/dbip-{kind}-lite-{month}.mmdb.gz"
_MAX_AGE_SECONDS = 35 * 24 * 3600


def _dir() -> Path:
    return Path(get_settings().ip_db_dir)


def refresh_ip_databases(force: bool = False) -> None:
    """Download this month's databases if missing or stale. Never raises."""
    base = _dir()
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("IP database dir %s not writable: %s", base, exc)
        return
    now = datetime.now(UTC)
    for kind, name in _FILES.items():
        target = base / name
        if (
            not force
            and target.exists()
            and time.time() - target.stat().st_mtime < _MAX_AGE_SECONDS
        ):
            continue
        # The current month's file appears a few days in; fall back one month.
        prev = now.replace(day=1) - timedelta(days=1)
        months = [now.strftime("%Y-%m"), prev.strftime("%Y-%m")]
        for month in months:
            url = _URL.format(kind=kind, month=month)
            tmp = target.with_suffix(".part")
            try:
                # DB-IP answers 403 to urllib's default User-Agent.
                req = urllib.request.Request(url, headers={"User-Agent": "MeetBook/1.0 (+ipdb)"})  # noqa: S310 — fixed https URL
                with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:  # noqa: S310
                    with gzip.GzipFile(fileobj=resp) as gz:
                        shutil.copyfileobj(gz, out)
                os.replace(tmp, target)
                logger.info("IP database %s updated (%s)", name, month)
                break
            except Exception as exc:  # network / 404 — try previous month, then give up
                logger.warning("IP database download failed %s: %s", url, exc)
                tmp.unlink(missing_ok=True)
    _readers.cache_clear()


@lru_cache(maxsize=1)
def _readers() -> dict[str, Any]:
    try:
        import maxminddb
    except ImportError:
        return {}
    out: dict[str, Any] = {}
    for kind, name in _FILES.items():
        path = _dir() / name
        if path.exists():
            try:
                out[kind] = maxminddb.open_database(str(path))
            except Exception as exc:
                logger.warning("Cannot open %s: %s", path, exc)
    return out


def _name(node: Any) -> str | None:
    if isinstance(node, dict):
        names = node.get("names") or {}
        return names.get("tr") or names.get("en")
    return None


def lookup_ip(ip: str | None) -> dict[str, Any] | None:
    """{country, country_code, region, city, asn, isp} for a public IP, else None."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.is_private or addr.is_loopback or addr.is_reserved or addr.is_link_local:
        return None
    readers = _readers()
    if not readers:
        return None
    out: dict[str, Any] = {}
    try:
        city = readers.get("city")
        rec = city.get(ip) if city else None
        if isinstance(rec, dict):
            country = rec.get("country") or {}
            out["country"] = _name(country)
            out["country_code"] = country.get("iso_code") if isinstance(country, dict) else None
            subdivisions = rec.get("subdivisions") or []
            if subdivisions:
                out["region"] = _name(subdivisions[0])
            out["city"] = _name(rec.get("city"))
            loc = rec.get("location") or {}
            if isinstance(loc, dict) and loc.get("latitude") is not None:
                out["lat"] = round(float(loc["latitude"]), 2)
                out["lng"] = round(float(loc["longitude"]), 2)
        asn = readers.get("asn")
        arec = asn.get(ip) if asn else None
        if isinstance(arec, dict):
            out["asn"] = arec.get("autonomous_system_number")
            out["isp"] = arec.get("autonomous_system_organization")
    except Exception as exc:
        logger.debug("IP lookup failed for %s: %s", ip, exc)
    return {k: v for k, v in out.items() if v is not None} or None
