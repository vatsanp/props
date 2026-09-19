"""Regenerate props/data/teams.json from the live sources.

Run this when a team renames, relocates, or rebrands:

    python pipeline/tools/gen_teams.py

Everything that can be read from a source is read from a source; only the
nflverse code exceptions and the legacy CLI aliases are hand-maintained here,
because nflverse ships no machine-readable alias table.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

import requests
from bs4 import BeautifulSoup

OUT = pathlib.Path(__file__).resolve().parents[1] / "props" / "data" / "teams.json"

ESPN_TEAMS = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"
TR_PAGE = "https://www.teamrankings.com/nfl/stat/points-per-game"
# ESPN's edge rejects short or parenthesized User-Agents with a 403 ("props/1.0"
# and "props/1.0 (personal)" both fail; this exact form and curl's default pass).
# Keep the +url — that is what gets it through.
UA = "props/1.0 +https://github.com/vatsan/props"

# Canonical id == ESPN abbreviation, except Washington: the existing CLI and
# nflverse both say WAS, only ESPN says WSH.
CANON_FROM_ESPN = {"WSH": "WAS"}

# nflverse uses a different code for exactly one current team, plus three
# retired codes from relocations. Verified against nfldata/games.csv (1999-2026).
NFLVERSE_CURRENT = {"LAR": "LA"}
NFLVERSE_HISTORICAL = {"LAR": ["STL"], "LAC": ["SD"], "LV": ["OAK"]}

# Era labels for the three relocations, so head-to-head can render
# "12-9 as St. Louis" instead of silently rewriting history.
ERAS = {
    "LAR": [
        {"from": 1995, "to": 2015, "code": "STL", "name": "St. Louis Rams"},
        {"from": 2016, "to": None, "code": "LA", "name": "Los Angeles Rams"},
    ],
    "LAC": [
        {"from": 1961, "to": 2016, "code": "SD", "name": "San Diego Chargers"},
        {"from": 2017, "to": None, "code": "LAC", "name": "Los Angeles Chargers"},
    ],
    "LV": [
        {"from": 1995, "to": 2019, "code": "OAK", "name": "Oakland Raiders"},
        {"from": 2020, "to": None, "code": "LV", "name": "Las Vegas Raiders"},
    ],
}

# Every key of the `teams` dict in the original CLI, so nothing you already type
# stops working. Values are extra aliases beyond the ones derived automatically.
LEGACY_ALIASES = {
    "ARI": ["ARZ"],
    "JAX": ["JAC"],
    "WAS": ["WSH"],
    "LAR": ["ST LOUIS", "SAINT LOUIS"],
    "LAC": ["SAN DIEGO"],
    "LV": ["OAKLAND"],
}


def fetch_espn() -> list[dict]:
    r = requests.get(ESPN_TEAMS, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    return [t["team"] for t in r.json()["sports"][0]["leagues"][0]["teams"]]


def fetch_teamrankings() -> dict[str, str]:
    """nickname-ish slug -> display name, scraped from any stat page."""
    r = requests.get(TR_PAGE, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.select_one("table.tr-table")
    if table is None:
        sys.exit("TeamRankings: no table.tr-table on the page")
    out = {}
    for a in table.select("td a[href*='/nfl/team/']"):
        slug = a["href"].rstrip("/").rsplit("/", 1)[-1]
        out[slug] = a.get_text(strip=True)
    if len(out) != 32:
        sys.exit(f"TeamRankings: expected 32 teams, got {len(out)}")
    return out


def main() -> None:
    espn = fetch_espn()
    tr = fetch_teamrankings()

    # Match TeamRankings slugs to ESPN teams on the full name: the slug is
    # "<location>-<nickname>" lowercased and hyphenated.
    by_slug = {}
    for team in espn:
        # Keep digits, or "San Francisco 49ers" slugifies to "san-francisco-ers".
        want = re.sub(r"[^a-z0-9]+", "-", team["displayName"].lower()).strip("-")
        for slug in tr:
            if slug == want:
                by_slug[team["abbreviation"]] = slug
                break
    missing = {t["abbreviation"] for t in espn} - set(by_slug)
    if missing:
        sys.exit(f"Could not match TeamRankings slugs for: {sorted(missing)}")

    teams = []
    for team in sorted(espn, key=lambda t: t["abbreviation"]):
        espn_abbr = team["abbreviation"]
        tid = CANON_FROM_ESPN.get(espn_abbr, espn_abbr)
        slug = by_slug[espn_abbr]
        nick = team["name"]

        aliases = {nick.upper(), team["location"].upper(), tr[slug].upper()}
        aliases.update(LEGACY_ALIASES.get(tid, []))
        aliases.discard(tid)

        teams.append(
            {
                "id": tid,
                "location": team["location"],
                "nickname": nick,
                "conference": "AFC" if _conf(team) == "AFC" else "NFC",
                "division": _division(team),
                "colors": {
                    "primary": "#" + team.get("color", "222222"),
                    "secondary": "#" + team.get("alternateColor", "888888"),
                },
                "espn": {"abbr": espn_abbr, "id": team["id"]},
                "teamrankings": {"slug": slug, "name": tr[slug]},
                "nflverse": {
                    "current": NFLVERSE_CURRENT.get(tid, tid),
                    "historical": NFLVERSE_HISTORICAL.get(tid, []),
                },
                "aliases": sorted(aliases),
                "eras": ERAS.get(tid, []),
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"teams": teams}, indent=2) + "\n")
    print(f"wrote {OUT} ({len(teams)} teams)")


def _conf(team: dict) -> str:
    # ESPN nests conference/division under groups; fall back to a lookup.
    return _DIVISIONS[team["abbreviation"]].split()[0]


def _division(team: dict) -> str:
    return _DIVISIONS[team["abbreviation"]]


# ESPN's /teams response omits group metadata, so divisions are declared here.
_DIVISIONS = {
    "BUF": "AFC East", "MIA": "AFC East", "NE": "AFC East", "NYJ": "AFC East",
    "BAL": "AFC North", "CIN": "AFC North", "CLE": "AFC North", "PIT": "AFC North",
    "HOU": "AFC South", "IND": "AFC South", "JAX": "AFC South", "TEN": "AFC South",
    "DEN": "AFC West", "KC": "AFC West", "LAC": "AFC West", "LV": "AFC West",
    "DAL": "NFC East", "NYG": "NFC East", "PHI": "NFC East", "WSH": "NFC East",
    "CHI": "NFC North", "DET": "NFC North", "GB": "NFC North", "MIN": "NFC North",
    "ATL": "NFC South", "CAR": "NFC South", "NO": "NFC South", "TB": "NFC South",
    "ARI": "NFC West", "LAR": "NFC West", "SEA": "NFC West", "SF": "NFC West",
}

if __name__ == "__main__":
    main()
