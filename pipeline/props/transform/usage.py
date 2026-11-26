"""Who actually gets the ball, per team and position.

Only the current season is used here, deliberately. A defense's identity
carries over year to year, which is why defense-vs-position blends with the
prior season — but a player's does not: he may have changed teams, lost a job,
or inherited one. Blending last year's target share into this year's depth
chart would recommend the wrong man. The cost is that week 1 usage is thin,
which the confidence score accounts for instead.

When a teammate who carries real weight is out, the season line is the wrong
picture of the men left behind, so it is replaced (see `_inherit`):

1. Depth is ranked among available players only, so the backup moves up.
2. If the team has already played at least two games without him, everyone's
   shares and per-game numbers come from those games: real evidence of the
   bigger role (`basis.kind == "without"`).
3. If he is out for the first time, his share is handed out in proportion to
   the shares that are left, and the stats tied to it scale with it, capped at
   double (`basis.kind == "estimated"`). The recommender trusts that less.

The season numbers are kept beside the adjusted ones so the app can show both.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .. import teams as registry
from ..markets import MARKETS, POSITIONS, SCALES_WITH, SHARE_COLUMNS
from ..sources import nflverse

#: Share of a team's position-group volume required to be more than a bit part.
#: Also the bar for an injured teammate to count as leaving work behind.
SECONDARY_SHARE = 0.15

#: Games without an injured teammate needed before they are trusted over an
#: estimate.
MIN_WITHOUT_GAMES = 2

#: The most an estimate may multiply a player's share and stats.
MAX_BOOST = 2.0

#: Positions whose share is never redistributed by estimate. A backup QB's
#: numbers are mop-up snaps; scaling them says nothing about him starting.
NO_ESTIMATE_POSITIONS = {"QB"}

OUT_STATUSES = {"Out", "Doubtful"}
# The one nflverse roster status that means he can play. Everything else --
# RES (injured reserve, PUP, suspension), DEV (practice squad), CUT, RET,
# TRD -- reads as Out.
ROSTER_ACTIVE = "ACT"
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
    rosters: Optional[List[dict]] = None,
) -> dict:
    needed = _metric_columns()
    players: Dict[str, dict] = {}
    team_volume: Dict[str, Dict[str, float]] = {}
    # team -> "position:share_column" -> week -> volume, for windowed shares.
    team_week_volume: Dict[str, Dict[str, Dict[int, float]]] = {}
    team_weeks: Dict[str, set] = {}

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
                "weeks": [],
            },
        )
        # A midseason trade: file him with his current team.
        player["team"] = team
        player["games"] += 1
        values = {column: nflverse.num(row.get(column, "")) for column in needed[position]}
        for column, value in values.items():
            player["totals"][column] += value
        week_number = nflverse.as_int(row.get("week"))
        if week_number is not None:
            player["weeks"].append((week_number, team, values))
            team_weeks.setdefault(team, set()).add(week_number)

        volume = team_volume.setdefault(team, {})
        for share_column in SHARE_COLUMNS[position]:
            volume_key = f"{position}:{share_column}"
            amount = nflverse.num(row.get(share_column, ""))
            volume[volume_key] = volume.get(volume_key, 0.0) + amount
            if week_number is not None:
                by_week = team_week_volume.setdefault(team, {}).setdefault(volume_key, {})
                by_week[week_number] = by_week.get(week_number, 0.0) + amount

    status = _injury_index(injuries or [], week)
    roster = _Roster(rosters or [], week)

    out: Dict[str, Dict[str, list]] = {}
    weekly: Dict[int, list] = {}
    for player in players.values():
        if not player["games"]:
            continue
        position = player["position"]
        shares = {}
        for share_column in SHARE_COLUMNS[position]:
            team_total = team_volume.get(player["team"], {}).get(
                f"{position}:{share_column}", 0.0
            )
            # Only his games for this team: after a trade, his old team's
            # targets are not a share of his new team's (that read 128%).
            mine = sum(
                values.get(share_column, 0.0)
                for _, team, values in player["weeks"]
                if team == player["team"]
            )
            shares[share_column] = round(mine / team_total, 4) if team_total else 0.0
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
            "status": _status(player, status, roster),
        }
        out.setdefault(player["team"], {}).setdefault(position, []).append(entry)
        weekly[id(entry)] = player["weeks"]

    for team, positions in out.items():
        for position, entries in positions.items():
            _inherit(
                entries, position, team, weekly,
                sorted(team_weeks.get(team, ())), team_week_volume.get(team, {}),
            )

    # Depth and role are per share column: a back can be RB2 in carries and
    # RB1 in targets, and each market asks about a different one of those.
    # Players who are out sort last, so the man taking his snaps moves up.
    for positions in out.values():
        for position, entries in positions.items():
            for share_column in SHARE_COLUMNS[position]:
                ranked = sorted(
                    entries,
                    key=lambda p: (
                        not available(p), -p["shares"][share_column], -p["games"], p["name"]
                    ),
                )
                for index, entry in enumerate(ranked):
                    entry.setdefault("depth", {})[share_column] = index + 1
                    entry.setdefault("roles", {})[share_column] = _role(
                        index, entry["shares"][share_column]
                    )
            entries.sort(
                key=lambda p: (not available(p), -max(p["shares"].values()), p["name"])
            )

    return {
        "season": season,
        "week": week,
        "teams": {team: out[team] for team in sorted(out)},
    }


def _inherit(
    entries: List[dict],
    position: str,
    team: str,
    weekly: Dict[int, list],
    team_weeks: List[int],
    week_volume: Dict[str, Dict[int, float]],
) -> None:
    """Rewrite the available players' shares and per-game numbers when a
    teammate who carried real weight is out. See the module docstring."""
    absent = [
        e for e in entries
        if not available(e) and max(e["shares"].values(), default=0.0) >= SECONDARY_SHARE
    ]
    if not absent:
        return

    def last_played(entry: dict) -> int:
        weeks = [w for w, t, _ in weekly[id(entry)] if t == team]
        return max(weeks) if weeks else 0

    # The latest point after which the team has played enough games: every
    # absentee gone by then is covered by real games without him.
    cutoff: Optional[int] = None
    for candidate in sorted({last_played(e) for e in absent}, reverse=True):
        if sum(1 for w in team_weeks if w > candidate) >= MIN_WITHOUT_GAMES:
            cutoff = candidate
            break
    old = [e for e in absent if cutoff is not None and last_played(e) <= cutoff]
    fresh = [e for e in absent if e not in old]
    if position in NO_ESTIMATE_POSITIONS:
        fresh = []
    if not old and not fresh:
        return
    window = [w for w in team_weeks if cutoff is not None and w > cutoff] if old else None

    def window_line(entry: dict):
        """(games, shares, per_game) over the window; the season line if none."""
        if window is None:
            return entry["games"], dict(entry["shares"]), dict(entry["per_game"])
        rows = [v for w, t, v in weekly[id(entry)] if t == team and w in window]
        if not rows:
            return 0, None, None
        totals: Dict[str, float] = {}
        for values in rows:
            for column, value in values.items():
                totals[column] = totals.get(column, 0.0) + value
        shares = {}
        for share_column in entry["shares"]:
            volume = sum(
                week_volume.get(f"{position}:{share_column}", {}).get(w, 0.0) for w in window
            )
            shares[share_column] = totals.get(share_column, 0.0) / volume if volume else 0.0
        per_game = {column: total / len(rows) for column, total in totals.items()}
        return len(rows), shares, per_game

    # What the fresh absentees leave behind, per share column, measured over
    # the same games as everyone else.
    vacated: Dict[str, float] = {}
    for entry in fresh:
        _, shares, _ = window_line(entry)
        for share_column, share in (shares or {}).items():
            vacated[share_column] = vacated.get(share_column, 0.0) + share
    boost = {
        column: min(1.0 / (1.0 - v), MAX_BOOST) if v < 1.0 else MAX_BOOST
        for column, v in vacated.items()
        if v > 0
    }
    if not old and not boost:
        return

    names = sorted(e["name"] for e in old + fresh)
    for entry in entries:
        if not available(entry):
            continue
        games, shares, per_game = window_line(entry)
        if not games:
            continue  # no games in the window (hurt himself?): keep his season
        for share_column, factor in boost.items():
            if share_column not in shares:
                continue
            shares[share_column] = min(shares[share_column] * factor, 1.0)
            for column in SCALES_WITH.get(share_column, ()):
                if column in per_game:
                    per_game[column] *= factor
        entry["season_shares"] = entry["shares"]
        entry["season_per_game"] = entry["per_game"]
        entry["shares"] = {k: round(v, 4) for k, v in shares.items()}
        entry["per_game"] = {k: round(v, 2) for k, v in sorted(per_game.items())}
        entry["basis"] = {
            "kind": "estimated" if boost else "without",
            "without": names,
            "since_week": window[0] if window else None,
            "games": games,
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


def _latest_week(rows: List[dict], week: Optional[int]) -> Optional[int]:
    """The most recent week in `rows`, not later than the week being built."""
    weeks = [nflverse.as_int(row.get("week")) for row in rows]
    weeks = [w for w in weeks if w is not None and (week is None or w <= week)]
    return max(weeks) if weeks else None


def _team(code: Optional[str]) -> Optional[str]:
    code = (code or "").strip()
    if not code:
        return None
    try:
        return registry.from_nflverse(code)
    except Exception:
        return None


def _injury_index(injuries: List[dict], week: Optional[int]) -> Dict[str, str]:
    """Game statuses from the most recent injury report only.

    Not each player's last-ever entry: a man listed Questionable in week 3 and
    never since is not still questionable in week 12, and one who has since
    gone on IR is not on the report at all (rosters cover him).
    """
    report_week = _latest_week(injuries, week)
    statuses: Dict[str, str] = {}
    for row in injuries:
        if nflverse.as_int(row.get("week")) != report_week:
            continue
        team = _team(row.get("team"))
        status = (row.get("report_status") or "").strip()
        if team and status:
            statuses[_status_key(team, row.get("full_name"))] = status
    return statuses


class _Roster:
    """Who is on an active roster in the most recent roster week."""

    def __init__(self, rosters: List[dict], week: Optional[int]):
        roster_week = _latest_week(rosters, week)
        self.by_id: Dict[str, str] = {}
        self.by_name: Dict[str, str] = {}
        self.teams: set = set()
        for row in rosters:
            if nflverse.as_int(row.get("week")) != roster_week:
                continue
            team = _team(row.get("team"))
            if not team:
                continue
            self.teams.add(team)
            status = (row.get("status") or "").strip().upper()
            if row.get("gsis_id"):
                self.by_id[row["gsis_id"]] = status
            self.by_name[_status_key(team, row.get("full_name"))] = status

    def active(self, player: dict) -> Optional[bool]:
        """False when he is on a reserve list, the practice squad, released...
        or missing from his team's roster; None when there is no roster to ask."""
        if player["team"] not in self.teams:
            return None
        status = self.by_id.get(player["id"] or "")
        if status is None:
            status = self.by_name.get(_status_key(player["team"], player["name"]))
        return status == ROSTER_ACTIVE


def _status(player: dict, injuries: Dict[str, str], roster: _Roster) -> str:
    if roster.active(player) is False:
        return "Out"
    return injuries.get(_status_key(player["team"], player["name"]), "active")


def players_for(payload: dict, team: str, position: str) -> List[dict]:
    return payload["teams"].get(team, {}).get(position, [])


def available(player: dict) -> bool:
    return player["status"] not in OUT_STATUSES
