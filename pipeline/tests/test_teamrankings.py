"""Parser tests against a real saved page — no network."""

from __future__ import annotations

import pathlib
import re

import pytest
from bs4 import BeautifulSoup

from props import teams as registry
from props.config import STATS
from props.sources.teamrankings import ScrapeError, parse_stat_html, parse_value

HERE = pathlib.Path(__file__).resolve().parent
PAGE = (HERE / "fixtures" / "teamrankings" / "points-per-game.html").read_text()
STAT = STATS["points_per_game"]


@pytest.fixture(scope="module")
def table():
    return parse_stat_html(PAGE, STAT)


def test_parses_all_thirty_two_teams(table):
    assert set(table.teams) == set(registry.TEAM_IDS)


def test_season_year_is_read_from_the_header_not_assumed(table):
    """The header column is literally named "2026"; parsing it is what stops
    the annual hand-edit the old CLI needed."""
    assert table.season == 2026
    assert table.prev_season_year == 2025


def test_header_year_survives_a_future_season():
    future = PAGE.replace(">2026<", ">2031<").replace(">2025<", ">2030<")
    parsed = parse_stat_html(future, STAT)
    assert parsed.season == 2031
    assert parsed.prev_season_year == 2030


def test_double_dash_becomes_none_not_zero(table):
    """`<td data-sort="0">--</td>` is real markup on this site: a team with no
    home games yet. Trusting data-sort would record a genuine 0.0 points."""
    blanks = [t for t in table.teams.values() if t.home is None or t.away is None]
    assert blanks, "fixture should contain teams with an unplayed home/away split"
    for team in blanks:
        assert team.home != 0.0 or team.home is None
        assert team.away != 0.0 or team.away is None


def test_data_sort_precision_is_preferred_over_rendered_text(table):
    """data-sort="25.7368" renders as "25.7"; keep the precision."""
    chicago = table.teams["CHI"]
    assert chicago.prev_season == pytest.approx(25.7368, abs=1e-4)


def test_value_parser_handles_each_cell_shape():
    def cell(html):
        return BeautifulSoup(html, "html.parser").td

    assert parse_value(cell('<td data-sort="0">--</td>')) is None
    assert parse_value(cell("<td>--</td>")) is None
    assert parse_value(cell("<td></td>")) is None
    assert parse_value(cell('<td data-sort="25.7368">25.7</td>')) == pytest.approx(25.7368)
    assert parse_value(cell("<td>1,234.5</td>")) == pytest.approx(1234.5)
    assert parse_value(cell("<td>0.0</td>")) == 0.0
    with pytest.raises(ScrapeError):
        parse_value(cell("<td>banana</td>"))


def test_team_identity_comes_from_the_slug(table):
    """Display names change on a rebrand; /nfl/team/<slug> is stable."""
    assert "CHI" in table.teams
    assert table.teams["CHI"].rank == 1


def test_ranks_are_kept_as_given_including_ties(table):
    ranks = sorted(t.rank for t in table.teams.values())
    assert ranks[0] == 1
    assert all(1 <= r <= 32 for r in ranks)
    for team in table.teams.values():
        shared = sum(1 for o in table.teams.values() if o.rank == team.rank)
        assert team.tied == (shared > 1)


def test_max_rank_exposes_tie_compression(table):
    """Ties can push the top rank well below 32, which makes a `rank > 20`
    threshold unreachable for some stats early in a season."""
    assert table.max_rank <= 32


def test_previous_season_rank_is_computed(table):
    ranked = [t for t in table.teams.values() if t.prev_rank is not None]
    assert len(ranked) == 32
    best = min(ranked, key=lambda t: t.prev_rank)
    # points_per_game is higher-is-better, so rank 1 must hold the max value.
    assert best.prev_season == max(t.prev_season for t in ranked)


def test_missing_table_raises():
    with pytest.raises(ScrapeError, match="no table.tr-table"):
        parse_stat_html("<html><body><p>nope</p></body></html>", STAT)


def test_unexpected_header_shape_raises():
    broken = PAGE.replace("<th", "<th data-x=1", 1).replace(">Last 3<", ">Last 4<")
    with pytest.raises(ScrapeError):
        parse_stat_html(broken, STAT)


def test_row_count_change_raises():
    """A 30-row table means the site changed; fail rather than publish it."""
    soup = BeautifulSoup(PAGE, "html.parser")
    rows = [tr for tr in soup.select_one("table.tr-table").find_all("tr")
            if len(tr.find_all("td")) > 1]
    rows[0].decompose()
    with pytest.raises(ScrapeError, match="expected 32 team rows"):
        parse_stat_html(str(soup), STAT)


def test_every_configured_stat_has_a_plausible_url():
    for stat in STATS.values():
        assert stat.url.startswith("https://www.teamrankings.com/nfl/stat/")
        assert re.fullmatch(r"[a-z0-9-]+", stat.slug)
