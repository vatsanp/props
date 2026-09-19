"""The prop markets the recommender covers.

Each market pairs a position with one statistic, measured two ways:

    * what a defense allows to that position, per game  (the matchup)
    * what a player produces, per game                  (the usage)

Column names are the nflverse stats_player_week columns, so adding a market is
a one-line change here as long as the column exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

#: Positions the recommender knows about. Everything else (OL, K, defenders)
#: is filtered out before any aggregation.
POSITIONS = ("QB", "RB", "WR", "TE")


@dataclass(frozen=True)
class Market:
    id: str
    label: str            # "Receiving Yards"
    position: str
    columns: Tuple[str, ...]  # summed together; ("rushing_tds","receiving_tds")
    unit: str             # "yds" / "rec" / "TD" / "att"
    noun: str             # for the generated sentence: "receiving yards"
    min_per_game: float   # below this the player is not worth a card

    @property
    def metric(self) -> str:
        """Key used in the defense-vs-position payload."""
        return "_".join(self.columns) if len(self.columns) > 1 else self.columns[0]


def _m(**kw) -> Market:
    return Market(**kw)


MARKETS: Dict[str, Market] = {
    m.id: m
    for m in [
        # Receiving — the strongest signal, and the reason this app exists.
        _m(id="wr_receiving_yards", label="Receiving Yards", position="WR",
           columns=("receiving_yards",), unit="yds", noun="receiving yards",
           min_per_game=35.0),
        _m(id="wr_receptions", label="Receptions", position="WR",
           columns=("receptions",), unit="rec", noun="receptions",
           min_per_game=3.0),
        _m(id="te_receiving_yards", label="Receiving Yards", position="TE",
           columns=("receiving_yards",), unit="yds", noun="receiving yards",
           min_per_game=25.0),
        _m(id="te_receptions", label="Receptions", position="TE",
           columns=("receptions",), unit="rec", noun="receptions",
           min_per_game=2.5),
        # Running backs catch passes too — asked for explicitly.
        _m(id="rb_receiving_yards", label="Receiving Yards", position="RB",
           columns=("receiving_yards",), unit="yds", noun="receiving yards",
           min_per_game=15.0),
        _m(id="rb_receptions", label="Receptions", position="RB",
           columns=("receptions",), unit="rec", noun="receptions",
           min_per_game=2.0),

        # Rushing.
        _m(id="rb_rushing_yards", label="Rushing Yards", position="RB",
           columns=("rushing_yards",), unit="yds", noun="rushing yards",
           min_per_game=35.0),
        _m(id="rb_carries", label="Carries", position="RB",
           columns=("carries",), unit="att", noun="carries",
           min_per_game=8.0),
        # Mobile quarterbacks, also asked for explicitly.
        _m(id="qb_rushing_yards", label="Rushing Yards", position="QB",
           columns=("rushing_yards",), unit="yds", noun="rushing yards",
           min_per_game=15.0),

        # Passing.
        _m(id="qb_passing_yards", label="Passing Yards", position="QB",
           columns=("passing_yards",), unit="yds", noun="passing yards",
           min_per_game=180.0),
        _m(id="qb_passing_tds", label="Passing TDs", position="QB",
           columns=("passing_tds",), unit="TD", noun="passing touchdowns",
           min_per_game=1.0),

        # Anytime touchdown: rushing and receiving scores combined.
        _m(id="rb_anytime_td", label="Anytime TD", position="RB",
           columns=("rushing_tds", "receiving_tds"), unit="TD",
           noun="touchdowns", min_per_game=0.35),
        _m(id="wr_anytime_td", label="Anytime TD", position="WR",
           columns=("rushing_tds", "receiving_tds"), unit="TD",
           noun="touchdowns", min_per_game=0.3),
        _m(id="te_anytime_td", label="Anytime TD", position="TE",
           columns=("rushing_tds", "receiving_tds"), unit="TD",
           noun="touchdowns", min_per_game=0.25),
    ]
}

MARKET_ORDER: List[str] = list(MARKETS)

#: Every (position, metric) pair the defense-vs-position table must contain.
def required_metrics() -> Dict[str, List[Tuple[str, ...]]]:
    out: Dict[str, List[Tuple[str, ...]]] = {}
    for market in MARKETS.values():
        out.setdefault(market.position, [])
        if market.columns not in out[market.position]:
            out[market.position].append(market.columns)
    return out


#: How a player's share of his team's work is measured. A running back has two
#: separate jobs, so he gets two shares and two depth-chart positions: the
#: third-down back can be the team's primary receiving back while being second
#: in carries, and quoting his carry share on a receiving prop would be wrong.
SHARE_COLUMNS = {
    "WR": ("targets",),
    "TE": ("targets",),
    "RB": ("carries", "targets"),
    "QB": ("attempts",),
}

RECEIVING_COLUMNS = {"receptions", "receiving_yards", "receiving_tds"}
RUSHING_COLUMNS = {"carries", "rushing_yards", "rushing_tds"}


def share_column_for(market: Market) -> str:
    """Which share makes this market's usage claim true."""
    if market.position == "QB":
        return "attempts"
    if market.position == "RB":
        # Anytime TD touches both columns; for a back it is goal-line carries
        # that drive it, so rushing wins the tie.
        return "carries" if set(market.columns) & RUSHING_COLUMNS else "targets"
    return "targets"
