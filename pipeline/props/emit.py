"""Serialize payloads for the app, and write them only when they change.

Content hashes are computed over the payload with `generated_at` removed, so a
run that scrapes identical numbers rewrites nothing and the cron job produces
no empty commit.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import pathlib
from typing import Any, Dict

from .config import STATS, STAT_ORDER
from .models import StatSet, StatTable, TeamStat

SCHEMA_VERSION = 1


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def content_hash(payload: Dict[str, Any]) -> str:
    """Stable across runs: ignores the timestamp, which always changes."""
    stripped = {k: v for k, v in payload.items() if k != "generated_at"}
    return hashlib.sha256(canonical_json(stripped).encode()).hexdigest()[:12]


def write_json(path, payload: Dict[str, Any]) -> bool:
    """Write `payload` to `path`. Returns True if the file actually changed."""
    target = pathlib.Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    new_hash = content_hash(payload)
    if target.exists():
        try:
            existing = json.loads(target.read_text())
        except json.JSONDecodeError:
            existing = None
        if existing is not None and content_hash(existing) == new_hash:
            return False

    target.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n")
    return True


def stats_payload(stats: StatSet) -> Dict[str, Any]:
    first = stats.stat(STAT_ORDER[0])
    return {
        "schema_version": SCHEMA_VERSION,
        "season": stats.season,
        "prev_season": first.prev_season_year,
        "generated_at": now(),
        "stats": [_stat_payload(stats.stat(sid)) for sid in STAT_ORDER],
    }


def _stat_payload(table: StatTable) -> Dict[str, Any]:
    definition = STATS[table.stat_id]
    return {
        "id": definition.id,
        "label": definition.label,
        "short": definition.short,
        "unit": definition.unit,
        "phrase": definition.phrase,
        "mirror": definition.mirror,
        "higher_is_better": definition.higher_is_better,
        "source": definition.url,
        "max_rank": table.max_rank,
        "teams": {
            team_id: {
                "rank": row.rank,
                "tied": row.tied,
                "pct": row.pct,
                "season": row.season,
                "last3": row.last3,
                "last1": row.last1,
                "home": row.home,
                "away": row.away,
                "prev_season": row.prev_season,
                "prev_rank": row.prev_rank,
            }
            for team_id, row in sorted(table.teams.items())
        },
    }


def stats_from_json(payload: Dict[str, Any]) -> StatSet:
    """Inverse of stats_payload, so the CLI can read what the pipeline wrote."""
    tables = {}
    for entry in payload["stats"]:
        tables[entry["id"]] = StatTable(
            stat_id=entry["id"],
            season=payload["season"],
            prev_season_year=payload["prev_season"],
            teams={
                team_id: TeamStat(
                    team=team_id,
                    rank=row["rank"],
                    tied=row["tied"],
                    pct=row["pct"],
                    season=row["season"],
                    last3=row["last3"],
                    last1=row["last1"],
                    home=row["home"],
                    away=row["away"],
                    prev_season=row["prev_season"],
                    prev_rank=row.get("prev_rank"),
                )
                for team_id, row in entry["teams"].items()
            },
        )
    return StatSet(season=payload["season"], tables=tables)
