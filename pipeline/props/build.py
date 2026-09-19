"""Build every published payload into an output directory.

    python -m props build --out data/v1

Exits non-zero if any source fails, unless --allow-partial is passed (which the
game-day refresh uses so a flaky ESPN call cannot block the rest). This is the
deliberate opposite of the original scraper, which caught every exception and
printed "I don't think the file saved, you should double check."
"""

from __future__ import annotations

import pathlib
import traceback
from typing import Dict, List, Optional

from . import season as season_module
from .emit import SCHEMA_VERSION, content_hash, now, stats_payload, write_json
from .sources import nflverse
from .transform import dvp as dvp_module
from .transform import headtohead, props as props_module, records, schedule
from .transform import stats as stats_transform
from .transform import usage as usage_module

ARTIFACTS = ("stats", "schedule", "records", "h2h", "dvp", "usage", "props")


class BuildError(RuntimeError):
    pass


def build(
    out_dir: str,
    only: Optional[List[str]] = None,
    allow_partial: bool = False,
    cache_dir: str = ".cache",
    scrape: bool = True,
) -> dict:
    wanted = set(only or ARTIFACTS)
    unknown = wanted - set(ARTIFACTS)
    if unknown:
        raise BuildError(f"unknown artifact(s): {sorted(unknown)}")

    out = pathlib.Path(out_dir)
    written: Dict[str, bool] = {}
    sources: Dict[str, dict] = {}
    failures: List[str] = []

    def record_source(name: str, ok: bool, **extra) -> None:
        sources[name] = {"ok": ok, "fetched_at": now(), **extra}

    # --- nflverse games: the schedule, records and head-to-head all hang off
    # this one file, so a failure here is fatal regardless of --allow-partial.
    games = nflverse.fetch_games(cache_dir=cache_dir)
    state = season_module.current(games)
    record_source("nflverse_games", True, games=len(games), season=state.season)

    if "schedule" in wanted:
        payload = _wrap(schedule.build(games, state.season, state.week))
        written["schedule.json"] = write_json(out / "schedule.json", payload)

    if "records" in wanted:
        payload = _wrap(records.build(games, state.season))
        written["records.json"] = write_json(out / "records.json", payload)

    if "h2h" in wanted:
        built = headtohead.build(games)
        written["h2h.json"] = write_json(out / "h2h.json", _wrap(built["summary"]))
        # One file per team, fetched only when a matchup is opened: the full
        # detail for all 496 pairs is 100 KB gzipped, which is not something to
        # download on every cold start.
        for team, opponents in built["teams"].items():
            written[f"h2h/{team}.json"] = write_json(
                out / "h2h" / f"{team}.json",
                _wrap({"team": team, "since": built["summary"]["since"], "opponents": opponents}),
            )

    # --- TeamRankings
    if "stats" in wanted and scrape:
        try:
            from .sources.teamrankings import fetch_all

            tables = fetch_all(cache_dir=str(pathlib.Path(cache_dir) / "raw"))
            stat_set = stats_transform.from_tables(tables)
            written["stats.json"] = write_json(out / "stats.json", stats_payload(stat_set))
            record_source("teamrankings", True, stats=len(tables), season=stat_set.season)
        except Exception as exc:  # noqa: BLE001 - reported, then re-raised below
            record_source("teamrankings", False, error=f"{type(exc).__name__}: {exc}")
            failures.append(f"teamrankings: {exc}")
            traceback.print_exc()

    # --- player-level data for the props engine
    if wanted & {"dvp", "usage", "props"}:
        try:
            current_rows = nflverse.fetch_player_weeks(state.season, cache_dir=cache_dir)
            prior_rows = nflverse.fetch_player_weeks(state.season - 1, cache_dir=cache_dir)
            injuries = nflverse.fetch_injuries(state.season, cache_dir=cache_dir)
            record_source(
                "nflverse_players",
                True,
                player_weeks=len(current_rows),
                prior_player_weeks=len(prior_rows),
                injuries=len(injuries),
            )

            dvp_payload = dvp_module.build(
                current_rows, prior_rows, season=state.season, prior_season=state.season - 1
            )
            usage_payload = usage_module.build(
                current_rows, injuries, season=state.season, week=state.week
            )
            if "dvp" in wanted:
                written["dvp.json"] = write_json(out / "dvp.json", _wrap(dvp_payload))
            if "usage" in wanted:
                written["usage.json"] = write_json(out / "usage.json", _wrap(usage_payload))
            if "props" in wanted:
                schedule_payload = schedule.build(games, state.season, state.week)
                picks = props_module.build(
                    schedule_payload, dvp_payload, usage_payload, week=state.week
                )
                written["props.json"] = write_json(out / "props.json", _wrap(picks))
        except Exception as exc:  # noqa: BLE001
            record_source("nflverse_players", False, error=f"{type(exc).__name__}: {exc}")
            failures.append(f"nflverse players: {exc}")
            traceback.print_exc()

    manifest = _manifest(out, state, sources, written)
    write_json(out / "manifest.json", manifest)

    if failures and not allow_partial:
        raise BuildError("; ".join(failures))
    return {"state": state, "written": written, "failures": failures}


def _wrap(payload: dict) -> dict:
    return {"schema_version": SCHEMA_VERSION, "generated_at": now(), **payload}


def _manifest(out: pathlib.Path, state, sources: dict, written: Dict[str, bool]) -> dict:
    import json

    files = {}
    for path in sorted(out.glob("*.json")):
        if path.name == "manifest.json":
            continue
        try:
            payload = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        files[path.name] = {
            "hash": content_hash(payload),
            "bytes": path.stat().st_size,
            "changed": written.get(path.name, False),
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now(),
        "season": state.season,
        "current_week": state.week,
        "season_type": state.season_type,
        "in_season": state.in_season,
        "next_kickoff": state.next_kickoff,
        "files": files,
        "sources": sources,
    }
