"""Turn nflverse game rows into the schedule payload.

Kickoff times in games.csv are Eastern wall-clock with no zone attached, so
they are converted to UTC here; the phone renders local time from that. Neutral
site games are flagged rather than described as "away @ home", because the
London and Munich games are not home games for anyone.
"""

from __future__ import annotations

import datetime as _dt
from typing import Dict, List, Optional

from .. import teams as registry
from ..sources import nflverse

try:  # Python 3.9+
    from zoneinfo import ZoneInfo

    EASTERN = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - tzdata missing
    EASTERN = None


def kickoff_utc(gameday: str, gametime: str) -> Optional[str]:
    """"2026-09-24" + "20:15" (Eastern) -> "2026-09-25T00:15:00Z"."""
    gameday = (gameday or "").strip()
    gametime = (gametime or "").strip()
    if not gameday:
        return None
    if not gametime:
        return f"{gameday}T00:00:00Z"
    try:
        naive = _dt.datetime.fromisoformat(f"{gameday}T{gametime}")
    except ValueError:
        return f"{gameday}T00:00:00Z"
    if EASTERN is None:
        return naive.isoformat() + "Z"
    return (
        naive.replace(tzinfo=EASTERN)
        .astimezone(_dt.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def game_payload(row: dict) -> dict:
    home_score = nflverse.as_int(row.get("home_score"))
    away_score = nflverse.as_int(row.get("away_score"))
    return {
        "id": row["game_id"],
        "espn_id": (row.get("espn") or "").strip() or None,
        "type": row.get("game_type", "REG"),
        "week": int(row["week"]),
        "kickoff": kickoff_utc(row.get("gameday", ""), row.get("gametime", "")),
        "away": registry.from_nflverse(row["away_team"]),
        "home": registry.from_nflverse(row["home_team"]),
        "away_score": away_score,
        "home_score": home_score,
        "status": "final" if home_score is not None else "scheduled",
        "neutral": (row.get("location") or "Home").strip().lower() == "neutral",
        "div_game": (row.get("div_game") or "0").strip() == "1",
        "spread": nflverse.as_float(row.get("spread_line")),
        "total": nflverse.as_float(row.get("total_line")),
        "venue": (row.get("stadium") or "").strip() or None,
    }


def build(games: List[dict], season: int, current_week: Optional[int]) -> dict:
    rows = [game_payload(g) for g in nflverse.by_season(games, season)]
    rows.sort(key=lambda g: (g["week"], g["kickoff"] or "", g["id"]))

    playing: Dict[int, set] = {}
    for row in rows:
        if row["type"] == "REG":
            playing.setdefault(row["week"], set()).update({row["home"], row["away"]})

    byes = {
        str(week): sorted(set(registry.TEAM_IDS) - teams_playing)
        for week, teams_playing in sorted(playing.items())
        if len(teams_playing) < 32
    }

    # Games are a flat list sorted by week; the app groups them. A parallel
    # by-week index would just be the same 272 objects a second time.
    return {
        "season": season,
        "current_week": current_week,
        "games": rows,
        "byes": byes,
    }
