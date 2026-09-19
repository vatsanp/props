"""Generate the golden mismatch fixture using the ORIGINAL algorithm.

This deliberately reimplements the old main.py loop — raw csv.reader, string
equality on the team column, int() on the rank column, the inverseStats dict —
rather than calling any of the new code. It is the oracle the port is checked
against, so it must not share an implementation with what it verifies.

    python pipeline/tools/legacy_parity.py

Writes pipeline/tests/golden/edges_2025.json: every team pair that produces at
least one edge over the finished 2025 season, plus a handful of curated
zero-edge pairs. Both the Python tests and the app's TypeScript tests assert
against this one file, so the rule cannot drift between the two languages.
"""

from __future__ import annotations

import csv
import itertools
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "csv2025"
GOLDEN = ROOT / "tests" / "golden" / "edges_2025.json"

sys.path.insert(0, str(ROOT))
from props import teams as registry  # noqa: E402  (after sys.path juggling)

# Verbatim from the original main.py.
INVERSE_STATS = {
    "Passing Yards Per Game": "Opponent Passing Yards Per Game",
    "Opponent Passing Yards Per Game": "Passing Yards Per Game",
    "Passing TDs Per Game": "Opponent Passing TDs Per Game",
    "Opponent Passing TDs Per Game": "Passing TDs Per Game",
    "Rushing Yards Per Game": "Opponent Rushing Yards Per Game",
    "Opponent Rushing Yards Per Game": "Rushing Yards Per Game",
    "Rushing TDs Per Game": "Opponent Rushing TDs Per Game",
    "Opponent Rushing TDs Per Game": "Rushing TDs Per Game",
    "Points Per Game": "Opponent Points Per Game",
    "Opponent Points Per Game": "Points Per Game",
    "Q1 Points Per Game": "Opponent Q1 Points Per Game",
    "Opponent Q1 Points Per Game": "Q1 Points Per Game",
    "FG Made Per Game": "Opponent FG Attempts Per Game",
    "Opponent FG Attempts Per Game": "FG Made Per Game",
    "Interceptions Thrown Per Game": "Opponent Interceptions Thrown Per Game",
    "Opponent Interceptions Thrown Per Game": "Interceptions Thrown Per Game",
    "Sacks Per Game": "Opponent Sacks Per Game",
    "Opponent Sacks Per Game": "Sacks Per Game",
    "Defensive TDs Per Game": "Opponent Defensive TDs Per Game",
    "Opponent Defensive TDs Per Game": "Defensive TDs Per Game",
}

ORDER = [
    "Passing Yards Per Game", "Opponent Passing Yards Per Game",
    "Passing TDs Per Game", "Opponent Passing TDs Per Game",
    "Rushing Yards Per Game", "Opponent Rushing Yards Per Game",
    "Rushing TDs Per Game", "Opponent Rushing TDs Per Game",
    "Points Per Game", "Opponent Points Per Game",
    "Q1 Points Per Game", "Opponent Q1 Points Per Game",
    "FG Made Per Game", "Opponent FG Attempts Per Game",
    "Interceptions Thrown Per Game", "Opponent Interceptions Thrown Per Game",
    "Sacks Per Game", "Opponent Sacks Per Game",
    "Defensive TDs Per Game", "Opponent Defensive TDs Per Game",
]


def legacy_rows(team1: str, team2: str):
    """The original loop, including its exact threshold expression."""
    team1_stats, team2_stats = {}, {}
    for label in ORDER:
        with (FIXTURES / f"{label}.csv").open() as fh:
            for row in csv.reader(fh, delimiter=","):
                if len(row) < 9:
                    continue
                if row[2] == team1:
                    row = list(row)
                    row[0] = label
                    team1_stats[label] = row
                elif row[2] == team2:
                    row = list(row)
                    row[0] = label
                    team2_stats[label] = row

    out = []
    for stat in team1_stats:
        inverse = INVERSE_STATS[stat]
        t1 = team1_stats[stat]
        t2 = team2_stats[inverse]
        if (int(t1[1]) <= 10 and int(t2[1]) > 20) or (
            int(t1[1]) > 20 and int(t2[1]) <= 10
        ):
            out.append(
                {
                    "stat": stat,
                    "mirror": inverse,
                    "team1_rank": int(t1[1]),
                    "team1_value": float(t1[3]),
                    "team2_rank": int(t2[1]),
                    "team2_value": float(t2[3]),
                }
            )
    return out


def main() -> None:
    # Display names are what the legacy code matched on.
    display = {t.id: t.tr_name for t in registry.all_teams()}

    pairs = {}
    for one, two in itertools.permutations(sorted(display), 2):
        rows = legacy_rows(display[one], display[two])
        if rows:
            pairs[f"{one}_{two}"] = rows

    # Keep some zero-edge pairs too: "no edges" is a result the port must also
    # reproduce, and it is the easy case to get wrong by over-emitting.
    empties = 0
    for one, two in itertools.permutations(sorted(display), 2):
        key = f"{one}_{two}"
        if key not in pairs and empties < 20:
            pairs[key] = []
            empties += 1

    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(
        json.dumps(
            {
                "season": 2025,
                "source": "pipeline/tests/fixtures/csv2025",
                "generated_by": "pipeline/tools/legacy_parity.py",
                "elite_rank": 10,
                "weak_rank": 20,
                "pairs": dict(sorted(pairs.items())),
            },
            indent=1,
        )
        + "\n"
    )
    total = sum(len(v) for v in pairs.values())
    print(f"wrote {GOLDEN}: {len(pairs)} pairs, {total} edges")


if __name__ == "__main__":
    main()
