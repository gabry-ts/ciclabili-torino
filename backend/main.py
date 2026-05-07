"""Tiny caching proxy for the Eco-Visio public endpoint.

Forwards any GET under /api/* to the upstream and caches the JSON response
in Redis for 24h, keyed by the full upstream URL. CORS is enabled so the
static frontend on :8765 can call it directly.
"""

import hashlib
import logging
import os
from contextlib import asynccontextmanager

import httpx
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

UPSTREAM = os.getenv(
    "UPSTREAM_BASE",
    "https://www.eco-visio.net/api/aladdin/1.0.0/pbl/publicwebpageplus",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
TTL_SECONDS = int(os.getenv("CACHE_TTL", str(60 * 60 * 24)))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:8765,http://127.0.0.1:8765",
    ).split(",")
    if o.strip()
]

log = logging.getLogger("ciclabili-proxy")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _app.state.redis = redis.from_url(REDIS_URL, decode_responses=False)
    _app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
    try:
        await _app.state.redis.ping()
        log.info("connected to redis at %s", REDIS_URL)
    except Exception as e:
        log.warning("redis unreachable on startup: %s (will retry per request)", e)
    yield
    await _app.state.http.aclose()
    await _app.state.redis.aclose()


app = FastAPI(title="Ciclabili Torino proxy", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def cache_key(url: str) -> str:
    return "eco:" + hashlib.sha1(url.encode("utf-8")).hexdigest()


async def fetch_cached(request: Request, url: str) -> tuple[bytes, str]:
    r: redis.Redis = request.app.state.redis
    http: httpx.AsyncClient = request.app.state.http
    key = cache_key(url)

    try:
        cached = await r.get(key)
        if cached is not None:
            return cached, "HIT"
    except Exception as e:
        log.warning("redis get failed (%s); fetching upstream", e)

    log.info("MISS %s", url)
    try:
        resp = await http.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}") from e
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
    body = resp.content
    try:
        await r.set(key, body, ex=TTL_SECONDS)
    except Exception as e:
        log.warning("redis set failed (%s)", e)
    return body, "MISS"


@app.get("/health")
async def health(request: Request):
    try:
        ok = await request.app.state.redis.ping()
    except Exception as e:
        return {"redis": False, "error": str(e)}
    return {"redis": bool(ok), "ttl_seconds": TTL_SECONDS, "upstream": UPSTREAM}


@app.get("/api/{path:path}")
async def proxy(path: str, request: Request):
    if ".." in path:
        raise HTTPException(status_code=400, detail="invalid path")
    qs = request.url.query
    upstream = f"{UPSTREAM}/{path}"
    if qs:
        upstream += f"?{qs}"
    body, status = await fetch_cached(request, upstream)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "x-cache": status,
            "cache-control": f"public, max-age={TTL_SECONDS}",
        },
    )
