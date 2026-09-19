"""Canonical team identity.

Four namespaces disagree about what to call a team:

    canonical   LAR          LAC          WAS          JAX
    TeamRankings"LA Rams"    "LA Chargers""Washington" "Jacksonville"
    nflverse    LA (+STL)    LAC (+SD)    WAS          JAX
    ESPN        LAR          LAC          WSH          JAX

Everything in the pipeline speaks canonical ids; conversion happens once, at
the edge, in the `from_*` functions. Canonical ids are the keys of the original
CLI's `teams` dict, so anything you already type still works.
"""

from __future__ import annotations

import difflib
import json
import pathlib
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

_DATA = pathlib.Path(__file__).resolve().parent / "data" / "teams.json"


class UnknownTeamError(ValueError):
    """A value could not be resolved to any team."""


class AmbiguousTeamError(ValueError):
    """A value matches more than one team (e.g. "Los Angeles", "New York")."""


@dataclass(frozen=True)
class Era:
    code: str
    name: str
    start: int
    end: Optional[int]

    def covers(self, season: int) -> bool:
        return season >= self.start and (self.end is None or season <= self.end)


@dataclass(frozen=True)
class Team:
    id: str
    location: str
    nickname: str
    conference: str
    division: str
    primary_color: str
    secondary_color: str
    espn_abbr: str
    espn_id: str
    tr_slug: str
    tr_name: str
    nflverse_code: str
    nflverse_historical: tuple = ()
    aliases: tuple = ()
    eras: tuple = field(default=())

    @property
    def full_name(self) -> str:
        return f"{self.location} {self.nickname}"

    def name_in(self, season: int) -> str:
        """Franchise name during `season` — "St. Louis Rams" for (LAR, 2004)."""
        for era in self.eras:
            if era.covers(season):
                return era.name
        return self.full_name


def _norm(value: str) -> str:
    """Uppercase, punctuation to spaces, collapsed — "LA-Rams" -> "LA RAMS"."""
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9]+", " ", value)).strip().upper()


def _load() -> "tuple[dict, dict, dict, dict, dict, set]":
    raw = json.loads(_DATA.read_text())["teams"]
    teams: dict = {}
    for entry in raw:
        teams[entry["id"]] = Team(
            id=entry["id"],
            location=entry["location"],
            nickname=entry["nickname"],
            conference=entry["conference"],
            division=entry["division"],
            primary_color=entry["colors"]["primary"],
            secondary_color=entry["colors"]["secondary"],
            espn_abbr=entry["espn"]["abbr"],
            espn_id=entry["espn"]["id"],
            tr_slug=entry["teamrankings"]["slug"],
            tr_name=entry["teamrankings"]["name"],
            nflverse_code=entry["nflverse"]["current"],
            nflverse_historical=tuple(entry["nflverse"]["historical"]),
            aliases=tuple(entry["aliases"]),
            eras=tuple(
                Era(code=e["code"], name=e["name"], start=e["from"], end=e["to"])
                for e in entry["eras"]
            ),
        )

    # Per-source indexes are exact and never ambiguous.
    by_tr: dict = {}
    by_nflverse: dict = {}
    by_espn: dict = {}
    # The general index is fuzzy, so collisions must be detected, not resolved.
    general: dict = {}
    collisions: set = set()

    def add(index: dict, key: str, team_id: str) -> None:
        index[_norm(key)] = team_id

    def add_general(key: str, team_id: str) -> None:
        key = _norm(key)
        if not key:
            return
        if key in general and general[key] != team_id:
            collisions.add(key)
        else:
            general[key] = team_id

    for team in teams.values():
        add(by_tr, team.tr_slug, team.id)
        add(by_tr, team.tr_name, team.id)
        add(by_nflverse, team.nflverse_code, team.id)
        for code in team.nflverse_historical:
            add(by_nflverse, code, team.id)
        add(by_espn, team.espn_abbr, team.id)
        add(by_espn, team.espn_id, team.id)

        for key in (
            team.id,
            team.tr_slug,
            team.tr_name,
            team.nflverse_code,
            team.espn_abbr,
            team.full_name,
            team.nickname,
            *team.nflverse_historical,
            *team.aliases,
            *(e.name for e in team.eras),
        ):
            add_general(key, team.id)

    # A canonical id always wins, even if some other team lists it as an alias.
    for team_id in teams:
        general[_norm(team_id)] = team_id
        collisions.discard(_norm(team_id))

    for key in collisions:
        general.pop(key, None)

    return teams, by_tr, by_nflverse, by_espn, general, collisions


TEAMS, _BY_TR, _BY_NFLVERSE, _BY_ESPN, _GENERAL, _AMBIGUOUS = _load()

#: Canonical ids, sorted. The only 32 values the rest of the pipeline accepts.
TEAM_IDS = tuple(sorted(TEAMS))


def all_teams() -> "list[Team]":
    return [TEAMS[t] for t in TEAM_IDS]


def get(team_id: str) -> Team:
    try:
        return TEAMS[team_id]
    except KeyError:
        raise UnknownTeamError(f"{team_id!r} is not a canonical team id") from None


def resolve(value: str) -> str:
    """Any spelling a human or a source might use -> canonical id.

    Raises rather than returning None: a silently unmatched team is how the
    original CLI printed an empty table for a typo.
    """
    key = _norm(value)
    if key in _GENERAL:
        return _GENERAL[key]
    if key in _AMBIGUOUS:
        matches = sorted(t.id for t in TEAMS.values() if key in {_norm(a) for a in _spellings(t)})
        raise AmbiguousTeamError(f"{value!r} matches {' and '.join(matches)} — be more specific")
    raise UnknownTeamError(f"unknown team {value!r}{_suggest(key)}")


def from_teamrankings(value: str) -> str:
    return _from(_BY_TR, value, "TeamRankings")


def from_nflverse(value: str) -> str:
    return _from(_BY_NFLVERSE, value, "nflverse")


def from_espn(value: str) -> str:
    return _from(_BY_ESPN, value, "ESPN")


def era_name(team_id: str, season: int) -> str:
    return get(team_id).name_in(season)


def _from(index: dict, value: str, source: str) -> str:
    key = _norm(value)
    if key in index:
        return index[key]
    raise UnknownTeamError(f"{source} sent unknown team {value!r}{_suggest(key, index)}")


def _spellings(team: Team) -> Iterable:
    yield team.id
    yield team.tr_slug
    yield team.tr_name
    yield team.nflverse_code
    yield team.espn_abbr
    yield team.full_name
    yield team.nickname
    yield from team.nflverse_historical
    yield from team.aliases


def _suggest(key: str, index: Optional[dict] = None) -> str:
    close = difflib.get_close_matches(key, list(index or _GENERAL), n=3, cutoff=0.6)
    return f" — did you mean {', '.join(close)}?" if close else ""
