"""All-time head-to-head records, 1999 to date.

Franchise continuity is applied before counting: a 2004 Rams game is filed
under LAR even though the row says STL, so "Rams vs Seahawks all-time" is one
record rather than two. The era code is kept on every game so the UI can still
say "12-9 as St. Louis".
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .. import teams as registry
from ..sources import nflverse

SINCE = 1999
RECENT_GAMES = 12


def pair_key(one: str, two: str) -> str:
    return "_".join(sorted([one, two]))


def build(games: List[dict]) -> dict:
    """{"DAL_KC": {...}} keyed by the two ids sorted, plus per-team detail."""
    pairs: Dict[str, dict] = {}

    for row in nflverse.completed(games):
        home = registry.from_nflverse(row["home_team"])
        away = registry.from_nflverse(row["away_team"])
        home_score = nflverse.as_int(row["home_score"])
        away_score = nflverse.as_int(row["away_score"])
        if home_score is None or away_score is None:
            continue

        season = int(row["season"])
        neutral = (row.get("location") or "Home").strip().lower() == "neutral"
        winner = home if home_score > away_score else (away if away_score > home_score else None)

        key = pair_key(home, away)
        entry = pairs.setdefault(
            key,
            {
                "teams": sorted([home, away]),
                "games": [],
                "wins": {home: 0, away: 0},
                "ties": 0,
            },
        )
        if winner is None:
            entry["ties"] += 1
        else:
            entry["wins"][winner] = entry["wins"].get(winner, 0) + 1

        entry["games"].append(
            {
                "id": row["game_id"],
                "season": season,
                "week": int(row["week"]),
                "type": row.get("game_type", "REG"),
                "date": row["gameday"],
                "home": home,
                "away": away,
                "home_score": home_score,
                "away_score": away_score,
                "winner": winner,
                "neutral": neutral,
                # What each club was called at the time.
                "home_as": row["home_team"],
                "away_as": row["away_team"],
            }
        )

    summary: Dict[str, dict] = {}
    detail: Dict[str, Dict[str, dict]] = {}

    for key, entry in pairs.items():
        entry["games"].sort(key=lambda g: (g["season"], g["week"]))
        one, two = entry["teams"]
        wins = {one: entry["wins"].get(one, 0), two: entry["wins"].get(two, 0)}

        # The summary is fetched by every client on open, so it carries only
        # what a scoreboard row needs. The per-team files carry the rest.
        summary[key] = {
            "teams": entry["teams"],
            "games": len(entry["games"]),
            "wins": wins,
            "ties": entry["ties"],
            "streak": _streak(entry["games"]),
        }

        recent = [
            {
                "date": g["date"],
                "season": g["season"],
                "week": g["week"],
                "type": g["type"],
                "home": g["home"],
                "away": g["away"],
                "home_score": g["home_score"],
                "away_score": g["away_score"],
                "winner": g["winner"],
                "neutral": g["neutral"],
            }
            for g in reversed(entry["games"][-RECENT_GAMES:])
        ]
        eras = _eras(entry["games"])

        for team, opponent in ((one, two), (two, one)):
            detail.setdefault(team, {})[opponent] = {
                "games": len(entry["games"]),
                "wins": wins[team],
                "losses": wins[opponent],
                "ties": entry["ties"],
                "streak": _streak(entry["games"]),
                "splits": _splits(entry["games"], team, opponent),
                "eras": eras,
                "recent": recent,
            }

    return {
        "summary": {"since": SINCE, "include_relocations": True, "pairs": summary},
        "teams": detail,
    }


def record(h2h: dict, one: str, two: str) -> Optional[dict]:
    return h2h["pairs"].get(pair_key(one, two))


def _streak(games: List[dict]) -> Optional[str]:
    if not games:
        return None
    last = games[-1]["winner"]
    if last is None:
        return "T1"
    count = 0
    for game in reversed(games):
        if game["winner"] != last:
            break
        count += 1
    return f"{last} W{count}"


def _eras(games: List[dict]) -> List[dict]:
    """Records broken out by what the franchises were called at the time."""
    buckets: Dict[tuple, dict] = {}
    for game in games:
        key = tuple(sorted([game["home_as"], game["away_as"]]))
        bucket = buckets.setdefault(key, {"codes": list(key), "wins": {}, "ties": 0, "games": 0})
        bucket["games"] += 1
        if game["winner"] is None:
            bucket["ties"] += 1
        else:
            code = (
                game["home_as"] if game["winner"] == registry.from_nflverse(game["home_as"])
                else game["away_as"]
            )
            bucket["wins"][code] = bucket["wins"].get(code, 0) + 1
    out = list(buckets.values())
    return out if len(out) > 1 else []


def _splits(games: List[dict], one: str, two: str) -> dict:
    def tally(selected):
        wins = {one: 0, two: 0}
        ties = 0
        for game in selected:
            if game["winner"] is None:
                ties += 1
            elif game["winner"] in wins:
                wins[game["winner"]] += 1
        return {"w": wins[one], "l": wins[two], "t": ties}

    return {
        "all": tally(games),
        "regular": tally([g for g in games if g["type"] == "REG"]),
        "postseason": tally([g for g in games if g["type"] != "REG"]),
        # Home/away are from `one`'s perspective; neutral sites belong to neither.
        "home": tally([g for g in games if g["home"] == one and not g["neutral"]]),
        "away": tally([g for g in games if g["away"] == one and not g["neutral"]]),
        "last5": tally(games[-5:]),
        "last10": tally(games[-10:]),
    }
