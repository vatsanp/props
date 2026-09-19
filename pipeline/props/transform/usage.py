"""Who actually gets the ball, per team and position.

Only the current season is used here, deliberately. A defense's identity
carries over year to year, which is why defense-vs-position blends with the
prior season — but a player's does not: he may have changed teams, lost a job,
or inherited one. Blending last year's target share into this year's depth
chart would recommend the wrong man. The cost is that week 1 usage is thin,
which the confidence score accounts for instead.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .. import teams as registry
from ..markets import MARKETS, POSITIONS, SHARE_COLUMNS
from ..sources import nflverse

#: Share of a team's position-group volume required to be more than a bit part.
SECONDARY_SHARE = 0.15

OUT_STATUSES = {"Out", "Doubtful"}
WARN_STATUSES = {"Questionable"}


def _metric_columns() -> Dict[str, set]:
    """position -> every column any market for that position needs."""
    needed: Dict[str, set] = {}
    for market in MARKETS.values():
        needed.setdefault(market.position, set()).update(market.columns)
    for position in POSITIONS:
        needed.setdefault(position, set()).update(SHARE_COLUMNS[position])
    return needed


def build(
    rows: List[dict],
    injuries: Optional[List[dict]] = None,
    season: Optional[int] = None,
    week: Optional[int] = None,
) -> dict:
    needed = _metric_columns()
    players: Dict[str, dict] = {}
    team_volume: Dict[str, Dict[str, float]] = {}

    for row in rows:
        if row.get("season_type") != "REG":
            continue
        position = row.get("position") or ""
        if position not in POSITIONS:
            continue
        team_code = (row.get("team") or "").strip()
        if not team_code:
            continue
        team = registry.from_nflverse(team_code)

        key = row.get("player_id") or f"{team}:{row.get('player_display_name')}"
        player = players.setdefault(
            key,
            {
                "id": row.get("player_id") or None,
                "name": row.get("player_display_name") or row.get("player_name"),
                "team": team,
                "position": position,
                "games": 0,
                "totals": {column: 0.0 for column in needed[position]},
            },
        )
        # A midseason trade: file him with his current team.
        player["team"] = team
        player["games"] += 1
        for column in needed[position]:
            player["totals"][column] += nflverse.num(row.get(column, ""))

        volume = team_volume.setdefault(team, {})
        for share_column in SHARE_COLUMNS[position]:
            volume_key = f"{position}:{share_column}"
            volume[volume_key] = volume.get(volume_key, 0.0) + nflverse.num(
                row.get(share_column, "")
            )

    status = _injury_index(injuries or [], week)

    out: Dict[str, Dict[str, list]] = {}
    for player in players.values():
        if not player["games"]:
            continue
        position = player["position"]
        shares = {}
        for share_column in SHARE_COLUMNS[position]:
            team_total = team_volume.get(player["team"], {}).get(
                f"{position}:{share_column}", 0.0
            )
            shares[share_column] = (
                round(player["totals"][share_column] / team_total, 4)
                if team_total
                else 0.0
            )
        entry = {
            "id": player["id"],
            "name": player["name"],
            "team": player["team"],
            "position": position,
            "games": player["games"],
            "shares": shares,
            "per_game": {
                column: round(total / player["games"], 2)
                for column, total in sorted(player["totals"].items())
            },
            "status": status.get(_status_key(player["team"], player["name"]), "active"),
        }
        out.setdefault(player["team"], {}).setdefault(position, []).append(entry)

    # Depth and role are per share column: a back can be RB2 in carries and
    # RB1 in targets, and each market asks about a different one of those.
    for positions in out.values():
        for position, entries in positions.items():
            for share_column in SHARE_COLUMNS[position]:
                ranked = sorted(
                    entries,
                    key=lambda p: (-p["shares"][share_column], -p["games"], p["name"]),
                )
                for index, entry in enumerate(ranked):
                    entry.setdefault("depth", {})[share_column] = index + 1
                    entry.setdefault("roles", {})[share_column] = _role(
                        index, entry["shares"][share_column]
                    )
            entries.sort(key=lambda p: (-max(p["shares"].values()), p["name"]))

    return {
        "season": season,
        "week": week,
        "teams": {team: out[team] for team in sorted(out)},
    }


def _role(index: int, share: float) -> str:
    if share < SECONDARY_SHARE:
        return "committee"
    if index == 0:
        return "primary"
    if index == 1:
        return "secondary"
    return "committee"


def _status_key(team: str, name: Optional[str]) -> str:
    return f"{team}:{(name or '').strip().lower()}"


def _injury_index(injuries: List[dict], week: Optional[int]) -> Dict[str, str]:
    """Latest report per player, not later than the week being built."""
    latest: Dict[str, tuple] = {}
    for row in injuries:
        report_week = nflverse.as_int(row.get("week"))
        if report_week is None or (week is not None and report_week > week):
            continue
        team_code = (row.get("team") or "").strip()
        if not team_code:
            continue
        try:
            team = registry.from_nflverse(team_code)
        except Exception:
            continue
        key = _status_key(team, row.get("full_name"))
        status = (row.get("report_status") or "").strip() or "active"
        if key not in latest or latest[key][0] < report_week:
            latest[key] = (report_week, status)
    return {key: status for key, (_, status) in latest.items()}


def players_for(payload: dict, team: str, position: str) -> List[dict]:
    return payload["teams"].get(team, {}).get(position, [])


def available(player: dict) -> bool:
    return player["status"] not in OUT_STATUSES
