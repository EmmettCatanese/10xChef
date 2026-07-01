"""
Easy Recipe Manager — recipe scraper (FastAPI service).

Lookup order for GET /api/scrape?url=...:
    1. cache    — return a previously stored result if we have one
    2. wayback  — ask the Internet Archive if the page is archived; if so,
                  pull the raw capture and extract from that
    3. live     — fetch the live page directly

Whatever succeeds is stored in the cache so the next lookup is instant.
The JSON response includes a "source" field telling you which path answered.

Run:  uvicorn main:app --reload
"""

import re
import json
import time
import sqlite3
import logging
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from recipe_scrapers import scrape_html

# ----------------------------------------------------------------------------- config
DB_PATH = "cache.db"
UA = {"User-Agent": "EasyRecipeManager/1.0 (+https://example.com/contact)"}
WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("easyrecipe")

# Resilient HTTP session: the CDX index and the Archive 503 under load, which
# would otherwise silently drop every request through to the live site.
from requests.adapters import HTTPAdapter
try:
    from urllib3.util.retry import Retry
    try:
        _retry = Retry(total=3, backoff_factor=0.5,
                       status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
    except TypeError:  # older urllib3
        _retry = Retry(total=3, backoff_factor=0.5,
                       status_forcelist=[429, 500, 502, 503, 504], method_whitelist=["GET"])
except Exception:
    _retry = None
HTTP = requests.Session(); HTTP.headers.update(UA)
if _retry:
    HTTP.mount("https://", HTTPAdapter(max_retries=_retry))


def _cdx_captures(target: str, with_mime: bool = True):
    """Return CDX capture rows [timestamp, original, statuscode] for a URL, newest last.

    `fastLatest=true` is the key: with a negative limit it reads from the newest
    end of the index instead of scanning every capture, which is what was timing
    out. We drop `collapse` (expensive per-row dedup we don't need)."""
    params = {"url": target, "output": "json", "fl": "timestamp,original,statuscode",
              "filter": ["statuscode:200"] + (["mimetype:text/html"] if with_mime else []),
              "fastLatest": "true", "limit": "-3"}
    r = HTTP.get(WAYBACK_CDX, params=params, timeout=20)
    r.raise_for_status()
    rows = r.json()
    return rows[1:] if rows and rows[0] and rows[0][0] == "timestamp" else rows

app = FastAPI(title="Easy Recipe Manager — Scraper")

# Allow a browser frontend to call this during testing.
# Tighten allow_origins to your real domain before production.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"]
)

# ----------------------------------------------------------------------------- cache (sqlite)
def init_db() -> None:
    with sqlite3.connect(DB_PATH) as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS recipes ("
            "  url TEXT PRIMARY KEY,"
            "  data TEXT,"
            "  origin_source TEXT,"
            "  fetched_at REAL)"
        )


def cache_get(url: str):
    with sqlite3.connect(DB_PATH) as c:
        row = c.execute(
            "SELECT data, origin_source, fetched_at FROM recipes WHERE url = ?", (url,)
        ).fetchone()
    if not row:
        return None
    data = json.loads(row[0])
    data["source"] = "cache"          # how this request was answered
    data["origin_source"] = row[1]    # where the data originally came from
    data["fetched_at"] = row[2]
    return data


def cache_put(url: str, data: dict, origin_source: str) -> None:
    with sqlite3.connect(DB_PATH) as c:
        c.execute(
            "INSERT OR REPLACE INTO recipes (url, data, origin_source, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (url, json.dumps(data), origin_source, time.time()),
        )


init_db()

# ----------------------------------------------------------------------------- helpers
def canonicalize(url: str) -> str:
    """Stable cache key: lowercase host, drop fragment + utm_ params + trailing slash."""
    p = urlsplit(url.strip())
    q = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith("utm_")]
    return urlunsplit(
        (p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/") or "/", urlencode(q), "")
    )


def parse_servings(yields) -> int | None:
    m = re.search(r"\d+", str(yields or ""))
    return int(m.group()) if m else None


def extract(html: str, url: str) -> dict:
    """HTML -> recipe dict. Shared by both the wayback and live paths.
    Raises ValueError if no usable recipe is found."""
    s = scrape_html(html=html, org_url=url, wild_mode=True)
    ingredients = s.ingredients()
    if not ingredients:
        raise ValueError("no ingredients in page")
    try:
        total_time = s.total_time()  # minutes; not all pages provide it
    except Exception:
        total_time = None
    return {
        "title": s.title(),
        "servings": parse_servings(s.yields()),
        "total_time": total_time,          # minutes (int) or null
        "ingredients": ingredients,        # list of strings -> frontend parseLine
        "instructions": s.instructions_list(),
    }

# ----------------------------------------------------------------------------- sources
def wayback_lookup(url: str) -> dict:
    """Walk the Internet Archive path and return a structured diagnostic.

    Always returns a dict:
        {"ok": bool, "reason": str, "data": dict|None, plus stage details}
    so callers can both use the result and see exactly where it stopped.
    """
    diag = {"ok": False, "reason": None, "data": None,
            "cdx_matches": 0, "snapshot": None, "raw_url": None, "raw_status": None}

    # --- stage 1: query the CDX index for the most recent successful HTML capture.
    # The CDX index is far more reliable than the Availability API, which often
    # returns no snapshot even when captures exist.
    try:
        captures = _cdx_captures(url, with_mime=True)
        if not captures:                              # capture recorded with an odd mime?
            captures = _cdx_captures(url, with_mime=False)
        if not captures and url.rstrip("/") != url:   # trailing-slash mismatch (CDX is exact-match)
            captures = _cdx_captures(url.rstrip("/"), with_mime=True)
    except Exception as e:
        diag["reason"] = f"CDX request failed: {e}"
        return diag
    diag["cdx_matches"] = len(captures)
    if not captures:
        diag["reason"] = "not archived (no 200 captures in the CDX index)"
        return diag

    ts, original = captures[-1][0], captures[-1][1]   # most recent capture
    diag["snapshot"] = {"timestamp": ts, "original": original}

    # --- stage 2: fetch the raw 'id_' capture (original bytes, no Archive rewriting)
    raw_url = f"https://web.archive.org/web/{ts}id_/{original}"
    diag["raw_url"] = raw_url
    try:
        rr = HTTP.get(raw_url, timeout=20)
        diag["raw_status"] = rr.status_code
        rr.raise_for_status()
        html = rr.text
    except Exception as e:
        diag["reason"] = f"fetching the archived capture failed: {e}"
        return diag

    # --- stage 3: extract a recipe from the captured HTML
    try:
        data = extract(html, url)
    except Exception as e:
        diag["reason"] = f"snapshot fetched but no recipe could be parsed from it: {e}"
        return diag

    data["snapshot_timestamp"] = ts
    diag["ok"] = True
    diag["reason"] = "ok"
    diag["data"] = data
    return diag


def live_fetch(url: str) -> dict:
    """Fetch and extract from the live page."""
    r = requests.get(url, headers=UA, timeout=15)
    r.raise_for_status()
    return extract(r.text, url)

# ----------------------------------------------------------------------------- routes
@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/wayback")
def wayback_debug(url: str):
    """Inspect ONLY the Internet Archive path for a URL. Shows how many CDX
    captures matched, the chosen snapshot, the raw capture URL and its HTTP
    status, and the exact stage/reason it succeeded or stopped at."""
    return wayback_lookup(url)


@app.get("/api/scrape")
def scrape(url: str, refresh: bool = False, debug: bool = False):
    key = canonicalize(url)

    # 1) cache
    if not refresh:
        cached = cache_get(key)
        if cached:
            return cached

    # 2) wayback
    wb = wayback_lookup(url)
    log.info("wayback %s -> %s", url, wb["reason"])
    if wb["ok"]:
        data = wb["data"]
        cache_put(key, data, "wayback")
        return {**data, "source": "wayback"}

    # 3) live
    try:
        data = live_fetch(url)
        cache_put(key, data, "live")
        result = {**data, "source": "live"}
        if debug:
            # why didn't wayback answer? include the diagnostic (minus bulky html-derived data)
            result["wayback_debug"] = {k: v for k, v in wb.items() if k != "data"}
        return result
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Could not get a recipe. wayback: {wb['reason']}; live: {e}",
        )