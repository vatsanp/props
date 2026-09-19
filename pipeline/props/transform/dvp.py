"""Defense vs position: what each defense gives up to QBs, RBs, WRs and TEs.

Computed by grouping every player-week by `opponent_team` and position, so a
defense's number is literally the production it allowed. The 2025 season spread
for tight end receiving yards ran from 84.9 per game (Cincinnati, worst) to
29.8 (Philadelphia, best) — a 2.8x gap, which is why this is worth computing.

Two things make raw numbers dangerous early in a season:

* One game swings a defense twenty ranks. Current-season figures are therefore
  blended with the prior season, weighted by games played, and both components
  ship in the payload so the app can show its work.
* `softness_rank` is deliberately NOT named `rank`. Here 1 means "allows the
  most", i.e. the best matchup to attack. TeamRankings' rank 1 means "best
  defense". Mixing those up would invert every recommendation.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .. import teams as registry
from ..markets import POSITIONS, required_metrics
from ..sources import nflverse

#: Games of current-season evidence at which the blend is half current.
BLEND_PRIOR_GAMES = 4.0


def blend_weight(games: int, k: float = BLEND_PRIOR_GAMES) -> float:
    """0 at the start of a season, ->1 as real evidence accumulates."""
    return round(games / (games + k), 4) if games else 0.0


def _totals(rows: List[dict]) -> Tuple[Dict[str, Dict[str, Dict[str, float]]], Dict[str, set]]:
    """(defense -> position -> metric -> total allowed, defense -> weeks seen)."""
    metrics = required_metrics()
    totals: Dict[str, Dict[str, Dict[str, float]]] = {}
    weeks: Dict[str, set] = {}

    for row in rows:
        if row.get("season_type") != "REG":
            continue
        position = row.get("position") or ""
        if position not in POSITIONS:
            continue
        opponent = (row.get("opponent_team") or "").strip()
        if not opponent:
            continue
        defense = registry.from_nflverse(opponent)

        weeks.setdefault(defense, set()).add(row["week"])
        bucket = totals.setdefault(defense, {}).setdefault(position, {})
        for columns in metrics.get(position, []):
            key = "_".join(columns) if len(columns) > 1 else columns[0]
            bucket[key] = bucket.get(key, 0.0) + sum(
                nflverse.num(row.get(column, "")) for column in columns
            )

    return totals, weeks


def _per_game(rows: List[dict]) -> Dict[str, Dict[str, Dict[str, float]]]:
    totals, weeks = _totals(rows)
    out: Dict[str, Dict[str, Dict[str, float]]] = {}
    for defense, positions in totals.items():
        games = len(weeks.get(defense, ()))
        if not games:
            continue
        out[defense] = {
            position: {metric: value / games for metric, value in metrics.items()}
            for position, metrics in positions.items()
        }
    return out


def games_played(rows: List[dict]) -> Dict[str, int]:
    _, weeks = _totals(rows)
    return {defense: len(seen) for defense, seen in weeks.items()}


def build(
    current_rows: List[dict],
    prior_rows: Optional[List[dict]] = None,
    season: Optional[int] = None,
    prior_season: Optional[int] = None,
) -> dict:
    """The defense-vs-position payload, blended and ranked."""
    current = _per_game(current_rows)
    prior = _per_game(prior_rows or [])
    games = games_played(current_rows)

    blended: Dict[str, Dict[str, Dict[str, dict]]] = {}
    for defense in registry.TEAM_IDS:
        played = games.get(defense, 0)
        weight = blend_weight(played)
        for position, metrics in (current.get(defense) or prior.get(defense) or {}).items():
            for metric in metrics:
                now = current.get(defense, {}).get(position, {}).get(metric)
                before = prior.get(defense, {}).get(position, {}).get(metric)

                if now is None and before is None:
                    continue
                if before is None:
                    value, used_weight = now, 1.0
                elif now is None:
                    value, used_weight = before, 0.0
                else:
                    value = weight * now + (1 - weight) * before
                    used_weight = weight

                blended.setdefault(defense, {}).setdefault(position, {})[metric] = {
                    "allowed_per_game": round(value, 2),
                    "current": round(now, 2) if now is not None else None,
                    "prior": round(before, 2) if before is not None else None,
                    "games": played,
                    "blend_weight": round(used_weight, 3),
                }

    _rank(blended)

    return {
        "season": season,
        "prior_season": prior_season,
        "blend_prior_games": BLEND_PRIOR_GAMES,
        "note": "softness_rank 1 = allows the most = softest matchup",
        "defenses": {team: blended.get(team, {}) for team in sorted(blended)},
    }


def _rank(blended: Dict[str, Dict[str, Dict[str, dict]]]) -> None:
    """Rank 1 = allows the most. Ties share a rank, as ranks conventionally do."""
    combos = {
        (position, metric)
        for positions in blended.values()
        for position, metrics in positions.items()
        for metric in metrics
    }
    for position, metric in combos:
        entries = [
            (team, positions[position][metric]["allowed_per_game"])
            for team, positions in blended.items()
            if metric in positions.get(position, {})
        ]
        entries.sort(key=lambda kv: kv[1], reverse=True)

        previous_value = None
        previous_rank = 0
        total = len(entries)
        for index, (team, value) in enumerate(entries, start=1):
            rank = previous_rank if value == previous_value else index
            previous_rank, previous_value = rank, value
            cell = blended[team][position][metric]
            cell["softness_rank"] = rank
            cell["softness_pct"] = round((total - rank) / (total - 1), 4) if total > 1 else 1.0


def lookup(payload: dict, defense: str, position: str, metric: str) -> Optional[dict]:
    return payload["defenses"].get(defense, {}).get(position, {}).get(metric)
