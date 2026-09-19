"""Every spelling any source uses must resolve, and nothing may resolve twice."""

from __future__ import annotations

import csv
import pathlib

import pytest

from props import teams as registry
from props.teams import AmbiguousTeamError, UnknownTeamError

HERE = pathlib.Path(__file__).resolve().parent
ARCHIVES = HERE.parents[1] / "archive" / "csv"

# All 35 codes that appear in nflverse games.csv for 1999-2026, including the
# three retired ones. A code that stops resolving means a franchise moved.
NFLVERSE_CODES = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA",
    "MIN", "NE", "NO", "NYG", "NYJ", "OAK", "PHI", "PIT", "SD", "SEA",
    "SF", "STL", "TB", "TEN", "WAS",
]

ESPN_ABBRS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA",
    "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
    "TEN", "WSH",
]

# Every key of the original CLI's `teams` dict.
LEGACY_KEYS = [
    "ARI", "ARZ", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL",
    "DEN", "DET", "GB", "HOU", "IND", "JAC", "JAX", "KC", "LAC", "LAR",
    "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA",
    "SF", "TB", "TEN", "WAS", "WSH",
]


def test_there_are_thirty_two_teams():
    assert len(registry.TEAM_IDS) == 32


@pytest.mark.parametrize("code", NFLVERSE_CODES)
def test_every_nflverse_code_resolves(code):
    assert registry.from_nflverse(code) in registry.TEAM_IDS


@pytest.mark.parametrize("abbr", ESPN_ABBRS)
def test_every_espn_abbr_resolves(abbr):
    assert registry.from_espn(abbr) in registry.TEAM_IDS


@pytest.mark.parametrize("key", LEGACY_KEYS)
def test_every_legacy_cli_key_still_works(key):
    assert registry.resolve(key) in registry.TEAM_IDS


@pytest.mark.parametrize("team", registry.all_teams(), ids=lambda t: t.id)
def test_teamrankings_names_and_slugs_resolve(team):
    assert registry.from_teamrankings(team.tr_slug) == team.id
    assert registry.from_teamrankings(team.tr_name) == team.id


@pytest.mark.parametrize("season_dir", ["2024", "2025", "2026"])
def test_archived_csv_team_names_all_resolve(season_dir):
    """The three CSV archives are the real-world corpus of display names."""
    directory = ARCHIVES / season_dir
    if not directory.exists():
        pytest.skip(f"{season_dir} archive not present")
    seen = set()
    for path in directory.glob("*.csv"):
        with path.open() as fh:
            rows = list(csv.reader(fh))
        for row in rows[1:]:
            if len(row) > 2 and row[2].strip():
                seen.add(row[2])
    assert seen, "archive had no team names"
    assert {registry.from_teamrankings(name) for name in seen} == set(registry.TEAM_IDS)


def test_relocations_map_to_the_modern_franchise():
    assert registry.from_nflverse("STL") == "LAR"
    assert registry.from_nflverse("SD") == "LAC"
    assert registry.from_nflverse("OAK") == "LV"
    assert registry.from_nflverse("LA") == "LAR"


def test_era_names():
    assert registry.era_name("LAR", 2004) == "St. Louis Rams"
    assert registry.era_name("LAR", 2020) == "Los Angeles Rams"
    assert registry.era_name("LV", 2018) == "Oakland Raiders"
    assert registry.era_name("LV", 2024) == "Las Vegas Raiders"
    assert registry.era_name("KC", 2004) == "Kansas City Chiefs"


def test_hyphen_and_case_insensitivity():
    for spelling in ["KC", "kc", "Kansas City", "kansas-city", "KANSAS  CITY"]:
        assert registry.resolve(spelling) == "KC"


def test_shared_city_names_are_ambiguous_not_arbitrary():
    """"Los Angeles" is two teams; guessing one silently would be worse."""
    for spelling in ["Los Angeles", "New York"]:
        with pytest.raises(AmbiguousTeamError):
            registry.resolve(spelling)


def test_canonical_id_beats_any_alias():
    # "LA" is nflverse's Rams code; it must not shadow a canonical id anywhere.
    for team_id in registry.TEAM_IDS:
        assert registry.resolve(team_id) == team_id


def test_unknown_team_raises_with_a_suggestion():
    with pytest.raises(UnknownTeamError) as excinfo:
        registry.resolve("Chicagoo")
    assert "did you mean" in str(excinfo.value)


def test_unknown_team_does_not_return_none():
    """The original CLI printed an empty table for a typo. Never again."""
    with pytest.raises(UnknownTeamError):
        registry.resolve("Not A Team")


def test_colliding_aliases_are_ambiguous_rather_than_silently_resolved():
    """No alias may quietly pick one of two teams that both claim it."""
    owners = {}
    for team in registry.all_teams():
        for alias in team.aliases:
            owners.setdefault(alias.upper(), set()).add(team.id)

    for alias, claimants in owners.items():
        if len(claimants) > 1:
            with pytest.raises(AmbiguousTeamError):
                registry.resolve(alias)
        else:
            assert registry.resolve(alias) == next(iter(claimants))
