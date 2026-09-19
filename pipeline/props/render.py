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


def week_table(games: List[dict]) -> PrettyTable:
    """This week's schedule."""
    table = PrettyTable(["Kickoff (UTC)", "Away", "Home", "Score", "Spread", "Venue"])
    table.align["Venue"] = "l"
    for game in games:
        score = (
            f"{game['away_score']}-{game['home_score']}"
            if game.get("home_score") is not None
            else "-"
        )
        home = game["home"] + (" (N)" if game.get("neutral") else "")
        table.add_row(
            [
                (game.get("kickoff") or "")[:16].replace("T", " "),
                game["away"],
                home,
                score,
                _fmt(game.get("spread")),
                (game.get("venue") or "")[:28],
            ]
        )
    return table


def picks_table(cards: List[dict]) -> PrettyTable:
    """Prop recommendations, strongest first."""
    table = PrettyTable(["Score", "Player", "Tm", "Market", "Per game", "vs", "Allowed", "Rk"])
    table.align["Player"] = "l"
    table.align["Market"] = "l"
    for card in cards:
        player = card["player"]
        defense = card["defense"]
        flag = "!" if player["status"] != "active" else ""
        table.add_row(
            [
                f"{card['score']:.2f}",
                f"{player['name']}{flag}",
                player["team"],
                f"{card['market_label']} ({player['position']})",
                f"{player['per_game']:g} {player['unit']}",
                defense["team"],
                f"{defense['allowed_per_game']:g}",
                33 - defense["softness_rank"],
            ]
        )
    return table


def h2h_report(payload: dict, team1: str, team2: str, detail: Optional[dict] = None) -> str:
    """All-time record plus recent meetings.

    `payload` is the summary file; `detail` is the optional per-team file that
    carries splits, eras and the recent meetings.
    """
    from .transform.headtohead import pair_key

    entry = payload["pairs"].get(pair_key(team1, team2))
    name1 = registry.get(team1).tr_name
    name2 = registry.get(team2).tr_name
    if entry is None:
        return f"{name1} and {name2} have not met since {payload['since']}."

    wins1 = entry["wins"].get(team1, 0)
    wins2 = entry["wins"].get(team2, 0)
    ties = entry["ties"]
    record = f"{wins1}-{wins2}" + (f"-{ties}" if ties else "")

    lines = [
        f"{name1} vs {name2}: {record} since {payload['since']} "
        f"({entry['games']} meetings)"
    ]

    opponent = (detail or {}).get("opponents", {}).get(team2, {})
    for era in opponent.get("eras", []):
        codes = " vs ".join(era["codes"])
        detail = ", ".join(f"{code} {count}" for code, count in sorted(era["wins"].items()))
        lines.append(f"  as {codes}: {detail} ({era['games']} games)")

    splits = opponent.get("splits")
    if not splits:
        return "\n".join(lines)
    lines.append(
        f"  regular {_split(splits['regular'])} · postseason {_split(splits['postseason'])}"
        f" · last 5 {_split(splits['last5'])}"
    )
    lines.append(f"  {name1} at home {_split(splits['home'])} · away {_split(splits['away'])}")

    table = PrettyTable(["Date", "Away", "Pts", "Home", "Pts.", "Winner"])
    for game in opponent.get("recent", [])[:8]:
        table.add_row(
            [
                game["date"],
                game["away"],
                game["away_score"],
                game["home"],
                game["home_score"],
                game["winner"] or "tie",
            ]
        )
    lines.append(table.get_string())
    return "\n".join(lines)


def _split(split: dict) -> str:
    return f"{split['w']}-{split['l']}" + (f"-{split['t']}" if split["t"] else "")
