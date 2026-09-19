"""Current-season W-L-T, points for/against, streaks and splits."""

from __future__ import annotations

from typing import Dict, List

from .. import teams as registry
from ..sources import nflverse


def build(games: List[dict], season: int) -> dict:
    rows = nflverse.completed(nflverse.by_season(games, season))
    state: Dict[str, dict] = {
        team: {
            "w": 0, "l": 0, "t": 0, "pf": 0, "pa": 0,
            "home": [0, 0, 0], "away": [0, 0, 0],
            "div": [0, 0, 0], "conf": [0, 0, 0],
            "results": [],
        }
        for team in registry.TEAM_IDS
    }

    for row in sorted(rows, key=lambda g: (int(g["week"]), g["game_id"])):
        home = registry.from_nflverse(row["home_team"])
        away = registry.from_nflverse(row["away_team"])
        home_score = nflverse.as_int(row["home_score"])
        away_score = nflverse.as_int(row["away_score"])
        if home_score is None or away_score is None:
            continue

        divisional = (row.get("div_game") or "0").strip() == "1"
        same_conf = registry.get(home).conference == registry.get(away).conference

        for team, opponent_score, team_score, side in (
            (home, away_score, home_score, "home"),
            (away, home_score, away_score, "away"),
        ):
            entry = state[team]
            entry["pf"] += team_score
            entry["pa"] += opponent_score
            index = 0 if team_score > opponent_score else (1 if team_score < opponent_score else 2)
            key = ["w", "l", "t"][index]
            entry[key] += 1
            entry[side][index] += 1
            if divisional:
                entry["div"][index] += 1
            if same_conf:
                entry["conf"][index] += 1
            entry["results"].append("WLT"[index])

    return {
        "season": season,
        "teams": {
            team: {
                "w": entry["w"], "l": entry["l"], "t": entry["t"],
                "games": entry["w"] + entry["l"] + entry["t"],
                "pf": entry["pf"], "pa": entry["pa"],
                "streak": _streak(entry["results"]),
                "home": _fmt(entry["home"]),
                "away": _fmt(entry["away"]),
                "div": _fmt(entry["div"]),
                "conf": _fmt(entry["conf"]),
                "last5": _fmt_results(entry["results"][-5:]),
            }
            for team, entry in sorted(state.items())
        },
    }


def _fmt(triple) -> str:
    wins, losses, ties = triple
    return f"{wins}-{losses}" + (f"-{ties}" if ties else "")


def _fmt_results(results) -> str:
    return _fmt([results.count("W"), results.count("L"), results.count("T")])


def _streak(results) -> str:
    if not results:
        return "-"
    last = results[-1]
    count = 0
    for result in reversed(results):
        if result != last:
            break
        count += 1
    return f"{last}{count}"
