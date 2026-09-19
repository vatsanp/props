"""Scrape the 20 team stat tables from teamrankings.com.

Replaces the vendored TeamRankingsWebScraper. Three things that code got wrong
and this one does not:

1. `soup.table` took whatever table came first. This selects `table.tr-table`
   and raises if it is missing, so a redesign fails the build instead of
   silently producing garbage.
2. Headers were trusted by name, so the season column (literally named "2026")
   forced a hand edit every year. Here the shape is asserted positionally and
   the year is *parsed out*.
3. `--` (no home games played yet) fell through as text. It is None here — and
   note the cell carries data-sort="0", so the text must be checked first or
   "hasn't played at home" becomes a real 0.0.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from bs4 import BeautifulSoup

from .. import teams as team_registry
from ..config import STATS, StatDef
from ..models import StatTable, TeamStat
from . import http

EXPECTED_COLUMNS = 8
MISSING_VALUES = {"--", "", "-", "N/A", "n/a"}
YEAR = re.compile(r"^\d{4}$")


class ScrapeError(RuntimeError):
    """The page did not look the way the parser expects."""


def parse_value(cell) -> Optional[float]:
    """A table cell -> float, or None when the stat does not apply yet.

    The text is checked before data-sort on purpose: `<td data-sort="0">--</td>`
    is real markup on this site. data-sort is preferred otherwise because it
    carries full precision (data-sort="25.7368" renders as "25.7").
    """
    text = cell.get_text(strip=True)
    if text in MISSING_VALUES:
        return None
    raw = cell.get("data-sort")
    if raw in (None, ""):
        raw = text
    try:
        return float(str(raw).replace(",", "").replace("%", ""))
    except ValueError:
        raise ScrapeError(f"could not parse value from {text!r}") from None


def parse_stat_html(html: str, stat: StatDef) -> StatTable:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.tr-table")
    if table is None:
        raise ScrapeError(f"{stat.slug}: no table.tr-table on the page")

    headers = [th.get_text(strip=True) for th in table.find_all("th")]
    _assert_header_shape(headers, stat)
    season = int(headers[2])
    prev_season = int(headers[7])

    rows = [tr for tr in table.find_all("tr") if len(tr.find_all("td")) > 1]
    if len(rows) != 32:
        raise ScrapeError(f"{stat.slug}: expected 32 team rows, got {len(rows)}")

    parsed: List[dict] = []
    for row in rows:
        cells = row.find_all("td")
        if len(cells) != EXPECTED_COLUMNS:
            raise ScrapeError(
                f"{stat.slug}: row has {len(cells)} cells, expected {EXPECTED_COLUMNS}"
            )
        parsed.append(
            {
                "team": _team_from_cell(cells[1]),
                "rank": int(cells[0].get_text(strip=True)),
                "season": parse_value(cells[2]),
                "last3": parse_value(cells[3]),
                "last1": parse_value(cells[4]),
                "home": parse_value(cells[5]),
                "away": parse_value(cells[6]),
                "prev_season": parse_value(cells[7]),
            }
        )

    found = {row["team"] for row in parsed}
    if found != set(team_registry.TEAM_IDS):
        missing = sorted(set(team_registry.TEAM_IDS) - found)
        raise ScrapeError(f"{stat.slug}: missing teams {missing}")

    rank_counts: Dict[int, int] = {}
    for row in parsed:
        rank_counts[row["rank"]] = rank_counts.get(row["rank"], 0) + 1

    prev_ranks = _rank_by_value(
        {row["team"]: row["prev_season"] for row in parsed}, stat.higher_is_better
    )

    entries = {}
    for row in parsed:
        entries[row["team"]] = TeamStat(
            team=row["team"],
            rank=row["rank"],
            tied=rank_counts[row["rank"]] > 1,
            pct=round((32 - row["rank"]) / 31, 4),
            season=row["season"],
            last3=row["last3"],
            last1=row["last1"],
            home=row["home"],
            away=row["away"],
            prev_season=row["prev_season"],
            prev_rank=prev_ranks.get(row["team"]),
        )

    return StatTable(
        stat_id=stat.id, season=season, prev_season_year=prev_season, teams=entries
    )


def fetch_stat(stat: StatDef, sess=None, cache_dir: Optional[str] = None) -> StatTable:
    sess = sess or http.session()
    html = http.get_text(sess, stat.url)
    path = http.cache_path(cache_dir, f"{stat.slug}.html")
    if path:
        with open(path, "w") as fh:
            fh.write(html)
    return parse_stat_html(html, stat)


def fetch_all(cache_dir: Optional[str] = ".cache/raw", pause: bool = True) -> Dict[str, StatTable]:
    """All 20 stats, sequentially and politely."""
    sess = http.session()
    tables: Dict[str, StatTable] = {}
    for index, stat in enumerate(STATS.values()):
        tables[stat.id] = fetch_stat(stat, sess=sess, cache_dir=cache_dir)
        if pause and index < len(STATS) - 1:
            http.polite_pause()
    seasons = {t.season for t in tables.values()}
    if len(seasons) > 1:
        raise ScrapeError(f"stat tables disagree about the season: {sorted(seasons)}")
    return tables


def _assert_header_shape(headers: List[str], stat: StatDef) -> None:
    if len(headers) != EXPECTED_COLUMNS:
        raise ScrapeError(
            f"{stat.slug}: expected {EXPECTED_COLUMNS} headers, got {headers}"
        )
    if headers[0] != "Rank" or headers[1] != "Team":
        raise ScrapeError(f"{stat.slug}: unexpected leading headers {headers[:2]}")
    if headers[3:7] != ["Last 3", "Last 1", "Home", "Away"]:
        raise ScrapeError(f"{stat.slug}: unexpected middle headers {headers[3:7]}")
    for index in (2, 7):
        if not YEAR.match(headers[index]):
            raise ScrapeError(
                f"{stat.slug}: header {index} is {headers[index]!r}, expected a year"
            )


def _team_from_cell(cell) -> str:
    """Prefer the team-page slug in the href; it is stable across rebrands."""
    link = cell.find("a", href=True)
    if link and "/nfl/team/" in link["href"]:
        slug = link["href"].rstrip("/").rsplit("/", 1)[-1]
        return team_registry.from_teamrankings(slug)
    return team_registry.from_teamrankings(cell.get_text(strip=True))


def _rank_by_value(values: Dict[str, Optional[float]], higher_is_better: bool) -> Dict[str, int]:
    """Competition ranking (1,1,3) over a column TeamRankings does not rank."""
    present = {team: value for team, value in values.items() if value is not None}
    ordered = sorted(present.items(), key=lambda kv: kv[1], reverse=higher_is_better)
    ranks: Dict[str, int] = {}
    previous_value = None
    previous_rank = 0
    for index, (team, value) in enumerate(ordered, start=1):
        if value == previous_value:
            ranks[team] = previous_rank
        else:
            ranks[team] = index
            previous_rank = index
            previous_value = value
    return ranks
