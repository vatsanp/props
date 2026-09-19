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

    teams_cmd = sub.add_parser("teams", help="list canonical teams")
    teams_cmd.add_argument("query", nargs="?", help="resolve one name")

    args = parser.parse_args(argv)
    try:
        return _dispatch(args)
    except (UnknownTeamError, AmbiguousTeamError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def _dispatch(args) -> int:
    if args.command == "show":
        return _show(args)
    if args.command == "scrape":
        return _scrape(args)
    if args.command == "teams":
        return _teams(args)
    raise AssertionError(f"unhandled command {args.command}")


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
