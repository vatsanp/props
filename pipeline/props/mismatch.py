"""Team-level matchup edges.

A direct port of the rule in the original main.py:

    for stat in team1Stats:
        inverse = inverseStats[stat]
        if (int(team1Stat[1]) <= 10 and int(team2Stat[1]) > 20) or \
           (int(team1Stat[1]) > 20 and int(team2Stat[1]) <= 10):

For each of the 20 stats, team 1's rank is compared against team 2's rank in
the *mirror* stat, and a row is emitted only when the two sides sit at opposite
extremes: one top-10, the other bottom-12.

All 20 iterations are distinct and all are kept. Iterating "Passing Yards Per
Game" compares team 1's passing offense to team 2's pass defense; iterating
"Opponent Passing Yards Per Game" compares team 1's pass defense to team 2's
passing offense. Those are different matchups, not the same one twice.

What is new versus the CLI: `advantage`. TeamRankings orients every stat so
rank 1 is best for that team, so whichever side is top-10 is the side that
benefits — the ASCII table made you infer that from the rank columns.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .config import STATS, STAT_ORDER
from .models import StatSet

ELITE_RANK = 10   # rank <= ELITE_RANK is a strength
WEAK_RANK = 20    # rank >  WEAK_RANK is a weakness


@dataclass(frozen=True)
class Edge:
    stat_id: str
    mirror_id: str
    team1: str
    team1_rank: int
    team1_value: Optional[float]
    team2: str
    team2_rank: int
    team2_value: Optional[float]
    advantage: str          # the canonical id of whoever benefits
    severity: int           # rank gap, for sorting

    @property
    def headline(self) -> str:
        """"Kansas City rushing offense vs Dallas run defense"."""
        from . import teams as registry

        one = registry.get(self.team1)
        two = registry.get(self.team2)
        return (
            f"{one.location} {STATS[self.stat_id].phrase} vs "
            f"{two.location} {STATS[self.mirror_id].phrase}"
        )


def find_edges(
    stats: StatSet,
    team1: str,
    team2: str,
    elite: int = ELITE_RANK,
    weak: int = WEAK_RANK,
    order: Optional[List[str]] = None,
) -> List[Edge]:
    """Every stat where one side is top-`elite` and the other bottom-`weak`."""
    if team1 == team2:
        raise ValueError("a team cannot be compared against itself")

    edges: List[Edge] = []
    for stat_id in order or STAT_ORDER:
        mirror_id = STATS[stat_id].mirror
        one = stats.value(stat_id, team1)
        two = stats.value(mirror_id, team2)

        if (one.rank <= elite and two.rank > weak) or (
            one.rank > weak and two.rank <= elite
        ):
            edges.append(
                Edge(
                    stat_id=stat_id,
                    mirror_id=mirror_id,
                    team1=team1,
                    team1_rank=one.rank,
                    team1_value=one.season,
                    team2=team2,
                    team2_rank=two.rank,
                    team2_value=two.season,
                    advantage=team1 if one.rank <= elite else team2,
                    severity=abs(one.rank - two.rank),
                )
            )
    return edges


def summarize(edges: List[Edge], team1: str, team2: str) -> "dict":
    """{team_id: edge count} — the one-glance answer the CLI never gave."""
    return {
        team1: sum(1 for e in edges if e.advantage == team1),
        team2: sum(1 for e in edges if e.advantage == team2),
    }
