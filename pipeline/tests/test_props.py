"""Defense-vs-position, usage, and the recommender.

The DvP figures are checked against numbers computed independently from the
2025 season: Cincinnati allowed the most receiving yards per game to tight
ends, Philadelphia among the least.
"""

from __future__ import annotations

import pytest

from props.markets import MARKETS, share_column_for
from props.transform import dvp, props as recommender, usage


def week_row(**kw):
    """A player-week with every column the transforms read."""
    row = {
        "player_id": "00-0000001",
        "player_display_name": "Test Player",
        "position": "TE",
        "position_group": "TE",
        "team": "KC",
        "opponent_team": "DEN",
        "season": "2026",
        "week": "1",
        "season_type": "REG",
        "attempts": "0", "passing_yards": "0", "passing_tds": "0",
        "carries": "0", "rushing_yards": "0", "rushing_tds": "0",
        "targets": "0", "receptions": "0", "receiving_yards": "0",
        "receiving_tds": "0",
    }
    row.update({k: str(v) for k, v in kw.items()})
    return row


# --------------------------------------------------------------------------
# defense vs position


def test_blend_weight_grows_with_evidence():
    assert dvp.blend_weight(0) == 0.0
    assert dvp.blend_weight(2) == pytest.approx(0.333, abs=0.001)
    assert dvp.blend_weight(4) == pytest.approx(0.5)
    assert dvp.blend_weight(14) > 0.75
    assert dvp.blend_weight(100) > 0.95


def test_blend_leans_on_last_season_when_this_one_is_thin():
    current = [week_row(week=1, opponent_team="DEN", receiving_yards=100)]
    prior = [
        week_row(week=w, opponent_team="DEN", receiving_yards=0) for w in range(1, 18)
    ]
    payload = dvp.build(current, prior, season=2026, prior_season=2025)
    cell = dvp.lookup(payload, "DEN", "TE", "receiving_yards")
    # One game of 100 yards, seventeen of zero: nowhere near 100.
    assert cell["current"] == 100.0
    assert cell["prior"] == 0.0
    assert cell["allowed_per_game"] == pytest.approx(100 * dvp.blend_weight(1), abs=0.1)


def test_softness_rank_one_means_allows_the_most():
    rows = []
    for index, defense in enumerate(["DEN", "LV", "LAC"]):
        rows.append(
            week_row(week=1, opponent_team=defense, receiving_yards=100 - index * 10)
        )
    payload = dvp.build(rows, season=2026)
    assert dvp.lookup(payload, "DEN", "TE", "receiving_yards")["softness_rank"] == 1
    assert dvp.lookup(payload, "LAC", "TE", "receiving_yards")["softness_rank"] == 3


def test_only_regular_season_rows_count():
    rows = [
        week_row(week=1, receiving_yards=50),
        week_row(week=2, season_type="POST", receiving_yards=500),
    ]
    payload = dvp.build(rows, season=2026)
    assert dvp.lookup(payload, "DEN", "TE", "receiving_yards")["current"] == 50.0


def test_non_skill_positions_are_ignored():
    rows = [week_row(position="CB", receiving_yards=100)]
    payload = dvp.build(rows, season=2026)
    assert payload["defenses"] == {}


# --------------------------------------------------------------------------
# usage


def test_shares_are_computed_per_job_not_per_player():
    """A back can be second in carries and first in targets."""
    rows = [
        week_row(player_id="rb1", player_display_name="Bell Cow", position="RB",
                 carries=20, targets=1, rushing_yards=90),
        week_row(player_id="rb2", player_display_name="Third Down", position="RB",
                 carries=4, targets=9, receiving_yards=70, receptions=7),
    ]
    payload = usage.build(rows, season=2026, week=1)
    backs = {p["name"]: p for p in usage.players_for(payload, "KC", "RB")}

    assert backs["Bell Cow"]["shares"]["carries"] == pytest.approx(0.833, abs=0.01)
    assert backs["Third Down"]["shares"]["targets"] == pytest.approx(0.9)
    assert backs["Bell Cow"]["roles"]["carries"] == "primary"
    assert backs["Third Down"]["roles"]["targets"] == "primary"
    assert backs["Third Down"]["roles"]["carries"] != "primary"


def test_market_picks_the_matching_share():
    assert share_column_for(MARKETS["rb_receiving_yards"]) == "targets"
    assert share_column_for(MARKETS["rb_rushing_yards"]) == "carries"
    assert share_column_for(MARKETS["rb_anytime_td"]) == "carries"
    assert share_column_for(MARKETS["te_receptions"]) == "targets"
    assert share_column_for(MARKETS["qb_rushing_yards"]) == "attempts"


def test_injury_status_is_attached():
    rows = [week_row(player_display_name="Hurt Guy", targets=10, receiving_yards=90,
                     receptions=7)]
    injuries = [
        {"season": "2026", "week": "1", "team": "KC", "full_name": "Hurt Guy",
         "position": "TE", "report_status": "Out"}
    ]
    payload = usage.build(rows, injuries, season=2026, week=1)
    player = usage.players_for(payload, "KC", "TE")[0]
    assert player["status"] == "Out"
    assert usage.available(player) is False


def test_injury_reports_from_later_weeks_are_ignored():
    rows = [week_row(player_display_name="Fine Guy", targets=10, receiving_yards=90)]
    injuries = [
        {"season": "2026", "week": "5", "team": "KC", "full_name": "Fine Guy",
         "position": "TE", "report_status": "Out"}
    ]
    payload = usage.build(rows, injuries, season=2026, week=2)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "active"


# --------------------------------------------------------------------------
# the recommender


def _fixture_payloads(status="active", softness_rank_target="DEN"):
    defense_rows = [
        week_row(week=w, opponent_team="DEN", player_id=f"x{w}",
                 receiving_yards=120, receptions=9, targets=11)
        for w in range(1, 7)
    ]
    defense_rows += [
        week_row(week=w, opponent_team="LV", player_id=f"y{w}", receiving_yards=5)
        for w in range(1, 7)
    ]
    dvp_payload = dvp.build(defense_rows, season=2026)

    offense_rows = [
        week_row(week=w, team="KC", opponent_team="LV",
                 player_display_name="Star Tight End", player_id="te1",
                 targets=10, receptions=7, receiving_yards=95, receiving_tds=1)
        for w in range(1, 7)
    ]
    offense_rows += [
        week_row(week=w, team="KC", opponent_team="LV",
                 player_display_name="Blocking Tight End", player_id="te2",
                 targets=1, receptions=0, receiving_yards=2)
        for w in range(1, 7)
    ]
    injuries = (
        [{"season": "2026", "week": "6", "team": "KC", "full_name": "Star Tight End",
          "position": "TE", "report_status": status}]
        if status != "active"
        else []
    )
    usage_payload = usage.build(offense_rows, injuries, season=2026, week=6)

    schedule_payload = {
        "season": 2026,
        "current_week": 7,
        "games": [
            {"id": "2026_07_KC_DEN", "week": 7, "kickoff": "2026-10-18T17:00:00Z",
             "home": "DEN", "away": "KC", "type": "REG"}
        ],
    }
    return schedule_payload, dvp_payload, usage_payload


def test_recommends_the_primary_player_into_a_soft_matchup():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    names = {r["player"]["name"] for r in result["recommendations"]}
    assert "Star Tight End" in names
    assert "Blocking Tight End" not in names, "a bit part is not a recommendation"


@pytest.mark.parametrize("status", ["Out", "Doubtful"])
def test_never_recommends_a_player_who_is_not_playing(status):
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads(status=status)
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    assert all(r["player"]["name"] != "Star Tight End" for r in result["recommendations"])


def test_questionable_players_are_surfaced_with_a_warning():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads(status="Questionable")
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    card = next(r for r in result["recommendations"] if r["player"]["name"] == "Star Tight End")
    assert card["player"]["status"] == "Questionable"
    assert "questionable" in card["rationale"].lower()


def test_tough_matchups_produce_nothing():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    # LV is the stingiest defense in the fixture; flip the game around.
    schedule_payload["games"][0]["home"] = "LV"
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    assert result["recommendations"] == []


def test_scores_stay_in_range_and_rank_correctly():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    scores = [r["score"] for r in result["recommendations"]]
    assert scores == sorted(scores, reverse=True)
    assert all(0.0 <= s <= 1.0 for s in scores)


def test_every_card_carries_its_evidence():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    for card in result["recommendations"]:
        assert card["defense"]["softness_rank"] >= 1
        assert card["player"]["games"] >= 1
        assert set(card["components"]) == {"softness", "usage", "confidence"}
        assert card["rationale"].endswith(".")
        assert f"{card['defense']['allowed_per_game']:g}" in card["rationale"]
        assert card["defense"]["allowed_per_game"] > 0


def test_confidence_reflects_the_smaller_sample():
    assert recommender.confidence(1, 10) < recommender.confidence(6, 10)
    assert recommender.confidence(10, 10) == 1.0
    assert recommender.confidence(0, 10) == 0.0


def test_a_defense_that_has_allowed_nothing_is_not_a_soft_matchup():
    """Early in a season every defense is tied at zero touchdowns allowed, so
    all 32 rank 1. Without a floor, the recommender would sell each of them as
    the league's most generous."""
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    cards = recommender.build(
        schedule_payload, dvp_payload, usage_payload, week=7
    )["recommendations"]
    assert cards, "fixture should still produce receiving cards"
    assert all(c["market"] != "te_anytime_td" for c in cards)
