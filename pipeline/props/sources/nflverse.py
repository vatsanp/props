"""nflverse datasets: game results, weekly player stats, injuries.

One CSV covers 1999 through the current season's full schedule — completed
games carry scores, future ones do not, so the same file answers "who plays
this week" and "what is the all-time record".

Dataset names have changed before (player_stats_<year>.csv now 404s in favour
of stats_player_week_<year>.csv), so every URL lives here and a miss fails the
build loudly rather than silently producing an empty payload.
"""

from __future__ import annotations

import csv
import io
import json
import pathlib
from typing import Dict, Iterable, List, Optional

from . import http

GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"
PLAYER_WEEK_URL = RELEASE + "/stats_player/stats_player_week_{season}.csv"
INJURIES_URL = RELEASE + "/injuries/injuries_{season}.csv"


class DatasetError(RuntimeError):
    """A dataset was missing or did not have the expected columns."""


def _rows(text: str) -> List[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def _require_columns(rows: List[dict], required: Iterable[str], what: str) -> None:
    if not rows:
        raise DatasetError(f"{what}: no rows")
    missing = [column for column in required if column not in rows[0]]
    if missing:
        raise DatasetError(f"{what}: missing columns {missing} — the schema moved")


def fetch_games(cache_dir: Optional[str] = ".cache", sess=None) -> List[dict]:
    """Every game 1999-present, plus the current season's remaining schedule."""
    sess = sess or http.session()
    text = _fetch_cached(sess, GAMES_URL, cache_dir, "games.csv")
    rows = _rows(text)
    _require_columns(
        rows,
        ["game_id", "season", "game_type", "week", "gameday", "away_team",
         "home_team", "away_score", "home_score"],
        "games.csv",
    )
    return rows


def fetch_player_weeks(season: int, cache_dir: Optional[str] = ".cache", sess=None) -> List[dict]:
    """Per-player, per-week production, with the opponent on every row."""
    sess = sess or http.session()
    url = PLAYER_WEEK_URL.format(season=season)
    text = _fetch_cached(sess, url, cache_dir, f"player_week_{season}.csv")
    rows = _rows(text)
    _require_columns(
        rows,
        ["player_id", "player_display_name", "position", "team", "opponent_team",
         "season", "week", "season_type", "targets", "receptions",
         "receiving_yards", "rushing_yards", "passing_yards"],
        f"stats_player_week_{season}.csv",
    )
    return rows


def fetch_injuries(season: int, cache_dir: Optional[str] = ".cache", sess=None) -> List[dict]:
    """Weekly injury report. Missing early in a season, which is not an error."""
    sess = sess or http.session()
    url = INJURIES_URL.format(season=season)
    try:
        text = _fetch_cached(sess, url, cache_dir, f"injuries_{season}.csv")
    except http.FetchError:
        return []
    rows = _rows(text)
    if rows:
        _require_columns(
            rows, ["season", "week", "team", "full_name", "position", "report_status"],
            f"injuries_{season}.csv",
        )
    return rows


def _fetch_cached(sess, url: str, cache_dir: Optional[str], name: str) -> str:
    """Conditional GET: nflverse serves ETags, so most runs cost a 304."""
    if not cache_dir:
        return http.get_text(sess, url)

    directory = pathlib.Path(cache_dir)
    directory.mkdir(parents=True, exist_ok=True)
    body = directory / name
    meta = directory / f"{name}.etag.json"

    headers = {}
    if body.exists() and meta.exists():
        try:
            etag = json.loads(meta.read_text()).get("etag")
            if etag:
                headers["If-None-Match"] = etag
        except json.JSONDecodeError:
            pass

    response = sess.get(url, headers=headers, timeout=http.TIMEOUT)
    if response.status_code == 304 and body.exists():
        return body.read_text()
    if response.status_code != 200:
        raise http.FetchError(f"GET {url} returned {response.status_code}")

    body.write_text(response.text)
    if response.headers.get("ETag"):
        meta.write_text(json.dumps({"etag": response.headers["ETag"]}))
    return response.text


def completed(games: Iterable[dict]) -> List[dict]:
    return [g for g in games if g.get("home_score") not in (None, "")]


def by_season(games: Iterable[dict], season: int) -> List[dict]:
    return [g for g in games if int(g["season"]) == season]


def latest_season(games: Iterable[dict]) -> int:
    return max(int(g["season"]) for g in games)


def as_int(value: str) -> Optional[int]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def as_float(value: str) -> Optional[float]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def num(value: str) -> float:
    """A missing stat means the player did not do that thing: zero, not null."""
    return as_float(value) or 0.0


def counts(rows: Iterable[dict], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for row in rows:
        out[row[key]] = out.get(row[key], 0) + 1
    return out
