"""The rendered table must be byte-identical to the original script's output.

The legacy script is executed as a subprocess against the same CSV archive and
its stdout is diffed against the new renderer. This is the check that says the
terminal workflow did not change underfoot.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

import pytest

from props import teams as registry
from props.mismatch import find_edges
from props.render import edges_report, team_table
from props.transform.stats import from_csv_dir

HERE = pathlib.Path(__file__).resolve().parent
LEGACY = HERE / "legacy" / "main_legacy.py"
ARCHIVE = HERE.parents[1] / "archive" / "csv" / "2026"

PAIRS = [("KC", "DAL"), ("BUF", "MIA"), ("PHI", "NYG"), ("SF", "SEA"), ("GB", "CHI")]


def _run_legacy(*args: str) -> str:
    """Run the original script against the archive, without editing it."""
    source = LEGACY.read_text()
    patched = re.sub(
        r'^dir = .*$', f'dir = "{ARCHIVE}/"', source, count=1, flags=re.MULTILINE
    )
    script = HERE / "_legacy_patched.py"
    script.write_text(patched)
    try:
        result = subprocess.run(
            [sys.executable, str(script), *args],
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        script.unlink(missing_ok=True)
    return result.stdout.strip()


@pytest.fixture(scope="module")
def stats():
    if not ARCHIVE.exists():
        pytest.skip("2026 archive not present")
    return from_csv_dir(ARCHIVE)


@pytest.mark.parametrize("team1,team2", PAIRS)
def test_matchup_output_matches_legacy(stats, team1, team2):
    legacy = _run_legacy(team1, team2)
    edges = find_edges(stats, team1, team2)
    ours = edges_report(stats, edges, team1, team2)

    # The new report adds a trailing summary line the old one never had.
    ours_table = "\n".join(ours.splitlines()[:-1]).strip()
    assert ours_table == legacy, (
        f"\n--- legacy ---\n{legacy}\n--- new ---\n{ours_table}"
    )


@pytest.mark.parametrize("team", ["KC", "BUF", "LAR"])
def test_single_team_output_matches_legacy(stats, team):
    name = registry.get(team).tr_name
    legacy = _run_legacy(team, "")
    ours = f"{name}\n{team_table(stats, team).get_string()}"
    assert ours.strip() == legacy
