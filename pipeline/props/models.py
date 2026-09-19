"""Shared value types for the pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class TeamStat:
    """One team's row in one stat table."""

    team: str                    # canonical id
    rank: int                    # TeamRankings rank; 1 is always best
    tied: bool                   # another team shares this rank
    pct: float                   # 1.0 = best, 0.0 = worst, for percentile mode
    season: Optional[float]      # season-to-date average
    last3: Optional[float]
    last1: Optional[float]
    home: Optional[float]        # None when no home games played yet ("--")
    away: Optional[float]
    prev_season: Optional[float]
    prev_rank: Optional[int] = None


@dataclass(frozen=True)
class StatTable:
    """One scraped stat, all 32 teams."""

    stat_id: str
    season: int                  # parsed from the header, never assumed
    prev_season_year: int
    teams: Dict[str, TeamStat]

    @property
    def max_rank(self) -> int:
        """Ties compress the scale; this can be well below 32 early in a season."""
        return max(t.rank for t in self.teams.values())

    def __getitem__(self, team_id: str) -> TeamStat:
        return self.teams[team_id]


class MissingStatError(KeyError):
    """A stat or a team is absent from the data set."""


@dataclass(frozen=True)
class StatSet:
    """All 20 stat tables for one season."""

    season: int
    tables: Dict[str, StatTable]

    def stat(self, stat_id: str) -> StatTable:
        try:
            return self.tables[stat_id]
        except KeyError:
            raise MissingStatError(f"stat {stat_id!r} was not collected") from None

    def value(self, stat_id: str, team_id: str) -> TeamStat:
        table = self.stat(stat_id)
        try:
            return table[team_id]
        except KeyError:
            raise MissingStatError(
                f"{team_id!r} has no row in {stat_id!r}"
            ) from None

    def __contains__(self, stat_id: str) -> bool:
        return stat_id in self.tables
