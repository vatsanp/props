"""Sanity gates on a built data directory.

Every check here is one the original pipeline lacked, and each corresponds to a
way the data has actually been wrong or could silently become wrong: a stat
table missing teams, a season that did not roll over, ranks outside 1-32, a
schedule that lost games, head-to-head totals that do not reconcile.

Exits non-zero so a cron job fails loudly instead of committing bad data.
"""

from __future__ import annotations

import json
import pathlib
from typing import List

from . import teams as registry
from .config import STAT_ORDER
from .markets import POSITIONS

REG_SEASON_GAMES = 272


class ValidationError(RuntimeError):
    pass


def validate(out_dir: str) -> List[str]:
    """Returns a list of problems; empty means the build is publishable."""
    out = pathlib.Path(out_dir)
    problems: List[str] = []

    manifest = _load(out / "manifest.json", problems)
    if manifest is None:
        return problems

    season = manifest.get("season")
    if not isinstance(season, int) or not (2000 < season < 2100):
        problems.append(f"manifest: implausible season {season!r}")

    _check_stats(out, season, problems)
    _check_schedule(out, season, problems)
    _check_h2h(out, problems)
    _check_dvp(out, problems)
    _check_props(out, problems)

    for name, entry in (manifest.get("sources") or {}).items():
        if not entry.get("ok"):
            problems.append(f"source {name} failed: {entry.get('error')}")

    return problems


def _load(path: pathlib.Path, problems: List[str]):
    if not path.exists():
        problems.append(f"{path.name} is missing")
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        problems.append(f"{path.name} is not valid JSON: {exc}")
        return None


def _check_stats(out: pathlib.Path, season, problems: List[str]) -> None:
    payload = _load(out / "stats.json", problems)
    if payload is None:
        return

    if payload.get("season") != season:
        problems.append(
            f"stats.json season {payload.get('season')} != manifest season {season}"
        )

    ids = [stat["id"] for stat in payload.get("stats", [])]
    missing = set(STAT_ORDER) - set(ids)
    if missing:
        problems.append(f"stats.json missing stats: {sorted(missing)}")

    for stat in payload.get("stats", []):
        teams = stat.get("teams", {})
        if set(teams) != set(registry.TEAM_IDS):
            problems.append(
                f"{stat['id']}: team set is wrong "
                f"(missing {sorted(set(registry.TEAM_IDS) - set(teams))})"
            )
            continue
        ranks = [row["rank"] for row in teams.values()]
        if min(ranks) != 1:
            problems.append(f"{stat['id']}: no rank 1")
        if max(ranks) > 32:
            problems.append(f"{stat['id']}: rank above 32")
        if any(r < 1 for r in ranks):
            problems.append(f"{stat['id']}: rank below 1")


def _check_schedule(out: pathlib.Path, season, problems: List[str]) -> None:
    payload = _load(out / "schedule.json", problems)
    if payload is None:
        return

    games = payload.get("games", [])
    regular = [g for g in games if g.get("type") == "REG"]
    if len(regular) < REG_SEASON_GAMES:
        problems.append(
            f"schedule.json has {len(regular)} regular season games, expected "
            f"at least {REG_SEASON_GAMES}"
        )
    for game in games:
        for side in ("home", "away"):
            if game.get(side) not in registry.TEAM_IDS:
                problems.append(f"schedule: {game.get('id')} has bad {side} {game.get(side)!r}")
        if game.get("kickoff") and not game["kickoff"].endswith("Z"):
            problems.append(f"schedule: {game['id']} kickoff is not UTC")

    week = payload.get("current_week")
    if week is not None and not (1 <= week <= 22):
        problems.append(f"schedule: implausible current_week {week}")


def _check_h2h(out: pathlib.Path, problems: List[str]) -> None:
    payload = _load(out / "h2h.json", problems)
    schedule_payload = _load(out / "schedule.json", [])
    if payload is None:
        return

    pairs = payload.get("pairs", {})
    if len(pairs) < 400:
        problems.append(f"h2h.json has only {len(pairs)} pairs")

    for key, entry in pairs.items():
        total = sum(entry["wins"].values()) + entry["ties"]
        if total != entry["games"]:
            problems.append(
                f"h2h {key}: wins+ties {total} != games {entry['games']}"
            )
        if set(entry["wins"]) != set(entry["teams"]):
            problems.append(f"h2h {key}: wins keys {sorted(entry['wins'])} != teams")

    if schedule_payload:
        del schedule_payload  # only loaded to keep the check order stable


def _check_dvp(out: pathlib.Path, problems: List[str]) -> None:
    path = out / "dvp.json"
    if not path.exists():
        return
    payload = _load(path, problems)
    if payload is None:
        return

    defenses = payload.get("defenses", {})
    if set(defenses) - set(registry.TEAM_IDS):
        problems.append("dvp.json contains unknown defenses")
    if defenses and len(defenses) != 32:
        problems.append(f"dvp.json covers {len(defenses)} defenses, expected 32")

    for team, positions in defenses.items():
        for position in POSITIONS:
            if position not in positions:
                problems.append(f"dvp {team}: no {position} row")
        for position, metrics in positions.items():
            for metric, cell in metrics.items():
                rank = cell.get("softness_rank")
                if rank is None or not (1 <= rank <= 32):
                    problems.append(f"dvp {team}/{position}/{metric}: bad rank {rank}")
                if cell.get("allowed_per_game") is None:
                    problems.append(f"dvp {team}/{position}/{metric}: no value")


def _check_props(out: pathlib.Path, problems: List[str]) -> None:
    path = out / "props.json"
    if not path.exists():
        return
    payload = _load(path, problems)
    if payload is None:
        return

    for card in payload.get("recommendations", []):
        player = card["player"]
        if player["status"] in {"Out", "Doubtful"}:
            problems.append(f"props: {player['name']} is {player['status']}")
        if player["role"] == "committee":
            problems.append(f"props: {player['name']} is a committee player")
        if not 0.0 <= card["score"] <= 1.0:
            problems.append(f"props: {player['name']} score {card['score']} out of range")
        if card["defense"]["allowed_per_game"] <= 0:
            problems.append(f"props: {player['name']} matchup allows nothing")
        if not card.get("rationale"):
            problems.append(f"props: {player['name']} has no rationale")


def main(out_dir: str) -> int:
    problems = validate(out_dir)
    if problems:
        print(f"{len(problems)} problem(s) in {out_dir}:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"{out_dir}: ok")
    return 0
