"""Command line entry point: `python -m props <command>`.

    props show KC DAL              # the original two-team mismatch view
    props show BUF                 # one team's 20 stats
    props show KC DAL --from-csv archive/csv/2025
    props scrape --out data/v1/stats.json

No path is hardcoded; `--out` defaults to $PROPS_OUT or ./data/v1.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from typing import List, Optional

from . import teams as registry
from .mismatch import ELITE_RANK, WEAK_RANK, find_edges
from .teams import AmbiguousTeamError, UnknownTeamError

DEFAULT_OUT = os.environ.get("PROPS_OUT", "data/v1")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="props", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    show = sub.add_parser("show", help="team stats, or a two-team matchup")
    show.add_argument("team1")
    show.add_argument("team2", nargs="?")
    show.add_argument("--from-csv", help="read an archived season instead of scraping")
    show.add_argument("--from-json", help="read a built stats.json")
    show.add_argument("--elite", type=int, default=ELITE_RANK)
    show.add_argument("--weak", type=int, default=WEAK_RANK)

    scrape = sub.add_parser("scrape", help="fetch the 20 stat tables")
    scrape.add_argument("--out", default=None, help="write stats.json here")
    scrape.add_argument("--cache", default=".cache/raw")
    scrape.add_argument("--no-pause", action="store_true")

    build_cmd = sub.add_parser("build", help="build every payload for the app")
    build_cmd.add_argument("--out", default=DEFAULT_OUT)
    build_cmd.add_argument("--only", help="comma separated: stats,schedule,records,h2h,dvp,usage,props")
    build_cmd.add_argument("--allow-partial", action="store_true")
    build_cmd.add_argument("--no-scrape", action="store_true", help="skip TeamRankings")
    build_cmd.add_argument("--cache", default=".cache")

    validate_cmd = sub.add_parser("validate", help="check a built directory")
    validate_cmd.add_argument("out", nargs="?", default=DEFAULT_OUT)

    week_cmd = sub.add_parser("week", help="this week's games")
    week_cmd.add_argument("--week", type=int)
    week_cmd.add_argument("--out", default=DEFAULT_OUT)

    h2h_cmd = sub.add_parser("h2h", help="all-time record between two teams")
    h2h_cmd.add_argument("team1")
    h2h_cmd.add_argument("team2")
    h2h_cmd.add_argument("--out", default=DEFAULT_OUT)

    picks_cmd = sub.add_parser("picks", help="this week's prop recommendations")
    picks_cmd.add_argument("--week", type=int)
    picks_cmd.add_argument("--team", help="only this team's players")
    picks_cmd.add_argument("--position", help="QB, RB, WR or TE")
    picks_cmd.add_argument("--limit", type=int, default=20)
    picks_cmd.add_argument("--out", default=DEFAULT_OUT)

    season_cmd = sub.add_parser("season", help="where we are in the calendar")
    season_cmd.add_argument("--is-in-season", action="store_true",
                            help="exit 0 in season, 1 otherwise")
    season_cmd.add_argument("--cache", default=".cache")

    teams_cmd = sub.add_parser("teams", help="list canonical teams")
    teams_cmd.add_argument("query", nargs="?", help="resolve one name")

    args = parser.parse_args(argv)
    try:
        return _dispatch(args)
    except (UnknownTeamError, AmbiguousTeamError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def _dispatch(args) -> int:
    handlers = {
        "show": _show,
        "scrape": _scrape,
        "build": _build,
        "validate": _validate,
        "week": _week,
        "h2h": _h2h,
        "picks": _picks,
        "season": _season,
        "teams": _teams,
    }
    return handlers[args.command](args)


def _read(out_dir: str, name: str) -> dict:
    path = pathlib.Path(out_dir) / name
    if not path.exists():
        raise SystemExit(
            f"error: {path} not found — run `props build --out {out_dir}` first"
        )
    return json.loads(path.read_text())


def _load_stats(args):
    from .transform.stats import from_csv_dir, from_tables

    if getattr(args, "from_csv", None):
        return from_csv_dir(args.from_csv)
    if getattr(args, "from_json", None):
        from .emit import stats_from_json

        return stats_from_json(json.loads(pathlib.Path(args.from_json).read_text()))

    default_json = pathlib.Path(DEFAULT_OUT) / "stats.json"
    if default_json.exists():
        from .emit import stats_from_json

        return stats_from_json(json.loads(default_json.read_text()))

    from .sources.teamrankings import fetch_all

    return from_tables(fetch_all())


def _show(args) -> int:
    from .render import edges_report, team_table

    stats = _load_stats(args)
    team1 = registry.resolve(args.team1)

    if not args.team2:
        print(registry.get(team1).full_name)
        print(team_table(stats, team1).get_string())
        return 0

    team2 = registry.resolve(args.team2)
    if team1 == team2:
        print("error: pick two different teams", file=sys.stderr)
        return 2
    edges = find_edges(stats, team1, team2, elite=args.elite, weak=args.weak)
    print(edges_report(stats, edges, team1, team2))
    return 0


def _scrape(args) -> int:
    from .emit import stats_payload, write_json
    from .sources.teamrankings import fetch_all
    from .transform.stats import from_tables

    tables = fetch_all(cache_dir=args.cache, pause=not args.no_pause)
    stats = from_tables(tables)
    out = args.out or str(pathlib.Path(DEFAULT_OUT) / "stats.json")
    write_json(out, stats_payload(stats))
    print(f"wrote {out}: {len(stats.tables)} stats, season {stats.season}")
    return 0


def _build(args) -> int:
    from .build import build

    only = args.only.split(",") if args.only else None
    result = build(
        args.out,
        only=only,
        allow_partial=args.allow_partial,
        cache_dir=args.cache,
        scrape=not args.no_scrape,
    )
    changed = [name for name, did in result["written"].items() if did]
    print(f"{result['state'].label}")
    print(f"  changed: {', '.join(sorted(changed)) if changed else 'nothing'}")
    for failure in result["failures"]:
        print(f"  PARTIAL: {failure}", file=sys.stderr)
    return 0


def _validate(args) -> int:
    from .validate import main as validate_main

    return validate_main(args.out)


def _week(args) -> int:
    from .render import week_table

    payload = _read(args.out, "schedule.json")
    week = args.week or payload.get("current_week")
    if week is None:
        print("offseason — no games scheduled")
        return 0
    games = [g for g in payload["games"] if g["week"] == week]
    print(f"Week {week}, {payload['season']}")
    print(week_table(games).get_string())
    return 0


def _h2h(args) -> int:
    from .render import h2h_report

    payload = _read(args.out, "h2h.json")
    team1 = registry.resolve(args.team1)
    team2 = registry.resolve(args.team2)
    print(h2h_report(payload, team1, team2))
    return 0


def _picks(args) -> int:
    from .render import picks_table

    payload = _read(args.out, "props.json")
    cards = payload["recommendations"]
    if args.week:
        cards = [c for c in cards if c["week"] == args.week]
    if args.team:
        team = registry.resolve(args.team)
        cards = [c for c in cards if c["player"]["team"] == team or c["defense"]["team"] == team]
    if args.position:
        position = args.position.upper()
        cards = [c for c in cards if c["position"] == position]

    print(f"Week {payload.get('week')} — {len(cards)} recommendation(s)")
    print(picks_table(cards[: args.limit]).get_string())
    if cards:
        print("\n" + "\n".join(f"  · {c['rationale']}" for c in cards[: args.limit]))
    return 0


def _season(args) -> int:
    from . import season as season_module
    from .sources import nflverse

    state = season_module.current(nflverse.fetch_games(cache_dir=args.cache))
    if args.is_in_season:
        return 0 if state.in_season else 1
    print(f"{state.label} (next kickoff {state.next_kickoff or 'unknown'})")
    return 0


def _teams(args) -> int:
    if args.query:
        team = registry.get(registry.resolve(args.query))
        print(f"{team.id}  {team.full_name}  ({team.division})")
        print(f"  teamrankings: {team.tr_name} / {team.tr_slug}")
        print(f"  nflverse:     {team.nflverse_code}"
              + (f" (was {', '.join(team.nflverse_historical)})" if team.nflverse_historical else ""))
        print(f"  espn:         {team.espn_abbr}")
        return 0
    for team in registry.all_teams():
        print(f"{team.id:4} {team.full_name:26} {team.division}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
