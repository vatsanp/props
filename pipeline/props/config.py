"""The 20 team stats: URLs, display order, and the offense/defense mirror map.

Ported verbatim from the original project — the URL list from the vendored
scraper's `links`, the ordering from `order`, and the pairings from
`inverseStats`. This module is the only place any of them exist now; adding a
21st stat means adding one `StatDef` here and nothing else.

A note on `unit`: it is NOT derivable from the "Opponent " prefix. "Sacks Per
Game" is your defense sacking their QB, while "Opponent Sacks Per Game" (from
qb-sacked-per-game) is your own QB being sacked, which is an offensive line
stat. Four of the ten pairs invert like this, so each one is declared.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

BASE_URL = "https://www.teamrankings.com/nfl/stat/"


@dataclass(frozen=True)
class StatDef:
    id: str
    label: str          # the legacy CSV filename, kept for fixture compatibility
    short: str          # for narrow screens
    slug: str           # TeamRankings URL slug
    unit: str           # which of YOUR units this measures: offense/defense/special
    phrase: str         # for generated sentences: "KC <phrase> vs DAL <phrase>"
    mirror: str         # the opposing stat, from inverseStats
    higher_is_better: bool

    @property
    def url(self) -> str:
        return BASE_URL + self.slug


def _s(**kw) -> StatDef:
    return StatDef(**kw)


STATS: Dict[str, StatDef] = {
    s.id: s
    for s in [
        _s(id="passing_yards_per_game", label="Passing Yards Per Game",
           short="Pass Yds/G", slug="passing-yards-per-game",
           unit="offense", phrase="passing offense",
           mirror="opponent_passing_yards_per_game", higher_is_better=True),
        _s(id="opponent_passing_yards_per_game", label="Opponent Passing Yards Per Game",
           short="Opp Pass Yds/G", slug="opponent-passing-yards-per-game",
           unit="defense", phrase="pass defense",
           mirror="passing_yards_per_game", higher_is_better=False),

        _s(id="passing_tds_per_game", label="Passing TDs Per Game",
           short="Pass TD/G", slug="passing-touchdowns-per-game",
           unit="offense", phrase="passing offense",
           mirror="opponent_passing_tds_per_game", higher_is_better=True),
        _s(id="opponent_passing_tds_per_game", label="Opponent Passing TDs Per Game",
           short="Opp Pass TD/G", slug="opponent-passing-touchdowns-per-game",
           unit="defense", phrase="pass defense",
           mirror="passing_tds_per_game", higher_is_better=False),

        _s(id="rushing_yards_per_game", label="Rushing Yards Per Game",
           short="Rush Yds/G", slug="rushing-yards-per-game",
           unit="offense", phrase="rushing offense",
           mirror="opponent_rushing_yards_per_game", higher_is_better=True),
        _s(id="opponent_rushing_yards_per_game", label="Opponent Rushing Yards Per Game",
           short="Opp Rush Yds/G", slug="opponent-rushing-yards-per-game",
           unit="defense", phrase="run defense",
           mirror="rushing_yards_per_game", higher_is_better=False),

        _s(id="rushing_tds_per_game", label="Rushing TDs Per Game",
           short="Rush TD/G", slug="rushing-touchdowns-per-game",
           unit="offense", phrase="rushing offense",
           mirror="opponent_rushing_tds_per_game", higher_is_better=True),
        _s(id="opponent_rushing_tds_per_game", label="Opponent Rushing TDs Per Game",
           short="Opp Rush TD/G", slug="opponent-rushing-touchdowns-per-game",
           unit="defense", phrase="run defense",
           mirror="rushing_tds_per_game", higher_is_better=False),

        _s(id="points_per_game", label="Points Per Game",
           short="Pts/G", slug="points-per-game",
           unit="offense", phrase="scoring offense",
           mirror="opponent_points_per_game", higher_is_better=True),
        _s(id="opponent_points_per_game", label="Opponent Points Per Game",
           short="Opp Pts/G", slug="opponent-points-per-game",
           unit="defense", phrase="scoring defense",
           mirror="points_per_game", higher_is_better=False),

        _s(id="q1_points_per_game", label="Q1 Points Per Game",
           short="Q1 Pts/G", slug="1st-quarter-points-per-game",
           unit="offense", phrase="first-quarter offense",
           mirror="opponent_q1_points_per_game", higher_is_better=True),
        _s(id="opponent_q1_points_per_game", label="Opponent Q1 Points Per Game",
           short="Opp Q1 Pts/G", slug="opp-1st-quarter-points-per-game",
           unit="defense", phrase="first-quarter defense",
           mirror="q1_points_per_game", higher_is_better=False),

        # The one asymmetric pair in the original: made vs attempts, not made vs
        # made. Kept as-is so the port stays faithful; see notes in the README.
        _s(id="fg_made_per_game", label="FG Made Per Game",
           short="FG Made/G", slug="field-goals-made-per-game",
           unit="special", phrase="field goal unit",
           mirror="opponent_fg_attempts_per_game", higher_is_better=True),
        _s(id="opponent_fg_attempts_per_game", label="Opponent FG Attempts Per Game",
           short="Opp FG Att/G", slug="opponent-field-goal-attempts-per-game",
           unit="special", phrase="field goal defense",
           mirror="fg_made_per_game", higher_is_better=False),

        _s(id="interceptions_thrown_per_game", label="Interceptions Thrown Per Game",
           short="INT Thrown/G", slug="interceptions-thrown-per-game",
           unit="offense", phrase="ball security",
           mirror="opponent_interceptions_thrown_per_game", higher_is_better=False),
        _s(id="opponent_interceptions_thrown_per_game",
           label="Opponent Interceptions Thrown Per Game",
           short="INT Forced/G", slug="interceptions-per-game",
           unit="defense", phrase="takeaway defense",
           mirror="interceptions_thrown_per_game", higher_is_better=True),

        # Inverted naming: "Sacks" is your defense, "Opponent Sacks" is your line.
        _s(id="sacks_per_game", label="Sacks Per Game",
           short="Sacks/G", slug="sacks-per-game",
           unit="defense", phrase="pass rush",
           mirror="opponent_sacks_per_game", higher_is_better=True),
        _s(id="opponent_sacks_per_game", label="Opponent Sacks Per Game",
           short="Sacks Allowed/G", slug="qb-sacked-per-game",
           unit="offense", phrase="pass protection",
           mirror="sacks_per_game", higher_is_better=False),

        _s(id="defensive_tds_per_game", label="Defensive TDs Per Game",
           short="Def TD/G", slug="defensive-touchdowns-per-game",
           unit="defense", phrase="defensive scoring",
           mirror="opponent_defensive_tds_per_game", higher_is_better=True),
        _s(id="opponent_defensive_tds_per_game", label="Opponent Defensive TDs Per Game",
           short="Def TD Allowed/G", slug="opponent-defensive-touchdowns-per-game",
           unit="offense", phrase="turnover protection",
           mirror="defensive_tds_per_game", higher_is_better=False),
    ]
}

#: Display order, ported from the original `order` list. Offense/defense pairs
#: stay adjacent, which is why it is not alphabetical.
STAT_ORDER: List[str] = [
    "passing_yards_per_game", "opponent_passing_yards_per_game",
    "passing_tds_per_game", "opponent_passing_tds_per_game",
    "rushing_yards_per_game", "opponent_rushing_yards_per_game",
    "rushing_tds_per_game", "opponent_rushing_tds_per_game",
    "points_per_game", "opponent_points_per_game",
    "q1_points_per_game", "opponent_q1_points_per_game",
    "fg_made_per_game", "opponent_fg_attempts_per_game",
    "interceptions_thrown_per_game", "opponent_interceptions_thrown_per_game",
    "sacks_per_game", "opponent_sacks_per_game",
    "defensive_tds_per_game", "opponent_defensive_tds_per_game",
]

#: label -> id, for reading the legacy CSV archives (filenames are labels).
BY_LABEL: Dict[str, str] = {s.label: s.id for s in STATS.values()}


def mirror(stat_id: str) -> str:
    """The opposing stat — ported from `inverseStats`."""
    return STATS[stat_id].mirror


def _self_check() -> None:
    assert set(STAT_ORDER) == set(STATS), "STAT_ORDER and STATS disagree"
    assert len(STAT_ORDER) == len(STATS) == 20
    for sid in STATS:
        assert mirror(mirror(sid)) == sid, f"{sid} mirror is not an involution"
    assert len({s.slug for s in STATS.values()}) == 20, "duplicate slug"


_self_check()
