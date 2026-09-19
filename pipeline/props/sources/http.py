"""One configured requests.Session for every outbound call."""

from __future__ import annotations

import random
import time
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ESPN's edge 403s short or parenthesized User-Agents. "props/1.0" and
# "props/1.0 (personal)" are both rejected; this form, with the +url, passes.
# TeamRankings accepts anything. Keep the URL in here.
USER_AGENT = "props/1.0 +https://github.com/vatsan/props"

TIMEOUT = 20


class FetchError(RuntimeError):
    """A source could not be fetched. Never swallowed — the build fails."""


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def get_text(sess: requests.Session, url: str, **kw) -> str:
    try:
        resp = sess.get(url, timeout=TIMEOUT, **kw)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise FetchError(f"GET {url} failed: {exc}") from exc
    return resp.text


def get_bytes(sess: requests.Session, url: str, **kw) -> bytes:
    try:
        resp = sess.get(url, timeout=TIMEOUT, **kw)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise FetchError(f"GET {url} failed: {exc}") from exc
    return resp.content


def polite_pause(low: float = 1.0, high: float = 2.5) -> None:
    """Jitter between sequential requests to the same host."""
    time.sleep(random.uniform(low, high))


def cache_path(cache_dir: Optional[str], name: str) -> Optional[str]:
    import os

    if not cache_dir:
        return None
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, name)
