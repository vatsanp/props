"""Assemble a StatSet from scraped tables or from the legacy CSV archives."""

from __future__ import annotations

import csv
import pathlib
from typing import Dict, Optional

from .. import teams as registry
from ..config import BY_LABEL, STATS
from ..models import StatSet, StatTable, TeamStat
from ..sources.teamrankings import MISSING_VALUES, _rank_by_value


def from_tables(tables: Dict[str, StatTable]) -> StatSet:
    seasons = {t.season for t in tables.values()}
    if len(seasons) != 1:
        raise ValueError(f"tables span multiple seasons: {sorted(seasons)}")
    return StatSet(season=seasons.pop(), tables=dict(tables))


def from_csv_dir(directory) -> StatSet:
    """Read an archived season written by the original scraper.

    Filenames are stat labels ("Points Per Game.csv") and the header's third
    column is the season year, so nothing here is hardcoded to a year.
    """
    path = pathlib.Path(directory)
    tables: Dict[str, StatTable] = {}
    for csv_path in sorted(path.glob("*.csv")):
        label = csv_path.stem
        stat_id = BY_LABEL.get(label)
        if stat_id is None:
            continue
        tables[stat_id] = _read_csv(csv_path, stat_id)
    if not tables:
        raise ValueError(f"no recognizable stat CSVs in {path}")
    return from_tables(tables)


def _read_csv(csv_path: pathlib.Path, stat_id: str) -> StatTable:
    with csv_path.open() as fh:
        rows = list(csv.reader(fh))

    header = rows[0]
    season = int(header[3])
    prev_season = int(header[8])

    parsed = []
    for row in rows[1:]:
        if len(row) < 9 or not row[1].strip():
            continue
        parsed.append(
            {
                "team": registry.from_teamrankings(row[2]),
                "rank": int(row[1]),
                "season": _num(row[3]),
                "last3": _num(row[4]),
                "last1": _num(row[5]),
                "home": _num(row[6]),
                "away": _num(row[7]),
                "prev_season": _num(row[8]),
            }
        )

    rank_counts: Dict[int, int] = {}
    for row in parsed:
        rank_counts[row["rank"]] = rank_counts.get(row["rank"], 0) + 1
    prev_ranks = _rank_by_value(
        {r["team"]: r["prev_season"] for r in parsed}, STATS[stat_id].higher_is_better
    )

    entries = {
        row["team"]: TeamStat(
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
        for row in parsed
    }
    return StatTable(
        stat_id=stat_id, season=season, prev_season_year=prev_season, teams=entries
    )


def _num(value: str) -> Optional[float]:
    value = value.strip()
    if value in MISSING_VALUES:
        return None
    return float(value.replace(",", ""))
