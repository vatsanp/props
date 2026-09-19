"""Terminal output, kept compatible with the original CLI.

The year headers are read from the data now instead of being hardcoded, so
these tables relabel themselves when the season rolls over.
"""

from __future__ import annotations

from typing import List, Optional

from prettytable import PrettyTable

from . import teams as registry
from .config import STATS, STAT_ORDER
from .mismatch import Edge, summarize
from .models import StatSet

BLANK = "--"


def _fmt(value: Optional[float]) -> str:
    """One decimal place, matching how TeamRankings renders these values."""
    return BLANK if value is None else f"{value:.1f}"


def team_table(stats: StatSet, team_id: str) -> PrettyTable:
    """One team's 20 stats — the single-team view."""
    any_table = stats.stat(STAT_ORDER[0])
    table = PrettyTable(
        [
            "Stat",
            "Rank",
            str(any_table.season),
            "Last 3",
            "Last 1",
            "Home",
            "Away",
            str(any_table.prev_season_year),
        ]
    )
    for stat_id in STAT_ORDER:
        row = stats.value(stat_id, team_id)
        table.add_row(
            [
                STATS[stat_id].label,
                row.rank,
                _fmt(row.season),
                _fmt(row.last3),
                _fmt(row.last1),
                _fmt(row.home),
                _fmt(row.away),
                _fmt(row.prev_season),
            ]
        )
    return table


def edges_table(stats: StatSet, edges: List[Edge], team1: str, team2: str) -> PrettyTable:
    """The two-team mismatch view."""
    season = stats.stat(STAT_ORDER[0]).season
    name1 = registry.get(team1).tr_name
    name2 = registry.get(team2).tr_name
    # Header layout as it stands in the current CLI: the team name alone.
    table = PrettyTable(
        [name1, "T1 Rank", f"T1 {season}", "-", f"T2 {season}", "T2 Rank", name2]
    )
    for edge in edges:
        table.add_row(
            [
                STATS[edge.stat_id].label,
                edge.team1_rank,
                _fmt(edge.team1_value),
                "-",
                _fmt(edge.team2_value),
                edge.team2_rank,
                STATS[edge.mirror_id].label,
            ]
        )
    return table


def edges_report(stats: StatSet, edges: List[Edge], team1: str, team2: str) -> str:
    """Table plus the summary line the ASCII output never had."""
    name1 = registry.get(team1).tr_name
    name2 = registry.get(team2).tr_name
    counts = summarize(edges, team1, team2)
    lines = [
        f"Best Stats of {name1} vs {name2}",
        edges_table(stats, edges, team1, team2).get_string(),
        f"  edges: {name1} {counts[team1]} · {name2} {counts[team2]}",
    ]
    return "\n".join(lines)
