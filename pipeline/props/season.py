"""Where we are in the NFL calendar, derived from the schedule rather than
from a hardcoded date. The offseason is a first-class state: the gameday job
no-ops through it and the app says "season complete" instead of showing an
empty week.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from typing import List, Optional

from .sources import nflverse


@dataclass(frozen=True)
class SeasonState:
    season: int
    week: Optional[int]          # None in the offseason
    season_type: str             # REG, POST or OFF
    in_season: bool
    next_kickoff: Optional[str]  # ISO date of the next scheduled game

    @property
    def label(self) -> str:
        if not self.in_season:
            return f"{self.season} offseason"
        return f"{self.season} week {self.week}"


def today() -> _dt.date:
    return _dt.datetime.now(_dt.timezone.utc).date()


def current(games: List[dict], on: Optional[_dt.date] = None) -> SeasonState:
    """The current week is the earliest week that still has an unplayed game."""
    on = on or today()
    season = nflverse.latest_season(games)
    this_season = nflverse.by_season(games, season)

    upcoming = sorted(
        (g for g in this_season if _date(g) and _date(g) >= on),
        key=lambda g: (_date(g), int(g["week"])),
    )
    if not upcoming:
        # Every game of the newest season is played: we are past the Super Bowl.
        return SeasonState(
            season=season, week=None, season_type="OFF", in_season=False,
            next_kickoff=None,
        )

    first = upcoming[0]
    played = [g for g in this_season if nflverse.as_int(g.get("home_score")) is not None]
    if not played and (_date(first) - on).days > 14:
        # Next season's schedule is out but it has not started yet.
        return SeasonState(
            season=season, week=None, season_type="OFF", in_season=False,
            next_kickoff=first["gameday"],
        )

    return SeasonState(
        season=season,
        week=int(first["week"]),
        season_type=first.get("game_type", "REG") if first.get("game_type") != "REG" else "REG",
        in_season=True,
        next_kickoff=first["gameday"],
    )


def _date(game: dict) -> Optional[_dt.date]:
    value = (game.get("gameday") or "").strip()
    if not value:
        return None
    try:
        return _dt.date.fromisoformat(value)
    except ValueError:
        return None
