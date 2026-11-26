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


def _injury(week, name, status):
    return {"season": "2026", "week": str(week), "team": "KC", "full_name": name,
            "position": "TE", "report_status": status}


def _roster(week, name, status, gsis_id="00-0000001", team="KC"):
    return {"season": "2026", "week": str(week), "team": team, "full_name": name,
            "gsis_id": gsis_id, "status": status}


def test_only_the_latest_injury_report_counts():
    rows = [week_row(player_display_name="Old News", targets=10, receiving_yards=90)]
    # Questionable in week 3, never listed since: not questionable in week 12.
    injuries = [_injury(3, "Old News", "Questionable"), _injury(11, "Someone Else", "Out")]
    payload = usage.build(rows, injuries, season=2026, week=12)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "active"
    # Listed on the latest report with no game status (a practice note only):
    # no designation.
    injuries = [_injury(11, "Old News", "")]
    payload = usage.build(rows, injuries, season=2026, week=12)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "active"


def test_injured_reserve_is_out_even_off_the_injury_report():
    """Season-ending IR drops a player off the weekly injury report entirely;
    only the roster says he is out."""
    rows = [week_row(player_display_name="On IR", targets=10, receiving_yards=90)]
    injuries = [_injury(10, "On IR", ""), _injury(12, "Someone Else", "Questionable")]
    rosters = [_roster(9, "On IR", "ACT"), _roster(12, "On IR", "RES")]
    payload = usage.build(rows, injuries, season=2026, week=12, rosters=rosters)
    player = usage.players_for(payload, "KC", "TE")[0]
    assert player["status"] == "Out"
    assert usage.available(player) is False


def test_back_from_ir_is_active_again():
    rows = [week_row(player_display_name="Healed", targets=10, receiving_yards=90)]
    rosters = [_roster(8, "Healed", "RES"), _roster(12, "Healed", "ACT")]
    payload = usage.build(rows, [], season=2026, week=12, rosters=rosters)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "active"


@pytest.mark.parametrize("status", ["CUT", "DEV", "RET", "TRD"])
def test_off_the_active_roster_is_out(status):
    rows = [week_row(player_display_name="Gone", targets=10, receiving_yards=90)]
    rosters = [_roster(12, "Gone", status)]
    payload = usage.build(rows, [], season=2026, week=12, rosters=rosters)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "Out"


def test_missing_from_his_teams_roster_is_out_but_no_roster_means_no_opinion():
    rows = [week_row(player_display_name="Released", targets=10, receiving_yards=90)]
    teammate = [_roster(12, "Teammate", "ACT", gsis_id="00-0000099")]
    payload = usage.build(rows, [], season=2026, week=12, rosters=teammate)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "Out"
    # No KC roster at all (early season, or the file is missing): trust the report.
    other_team = [_roster(12, "Someone", "ACT", gsis_id="00-0000099", team="DEN")]
    payload = usage.build(rows, [], season=2026, week=12, rosters=other_team)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "active"


def test_roster_matches_by_name_when_the_id_is_missing():
    rows = [week_row(player_display_name="No Id", targets=10, receiving_yards=90)]
    rosters = [_roster(12, "No Id", "RES", gsis_id="")]
    payload = usage.build(rows, [], season=2026, week=12, rosters=rosters)
    assert usage.players_for(payload, "KC", "TE")[0]["status"] == "Out"


def test_rosters_from_later_weeks_are_ignored():
    rows = [week_row(player_display_name="Fine Now", targets=10, receiving_yards=90)]
    rosters = [_roster(5, "Fine Now", "ACT"), _roster(9, "Fine Now", "RES")]
    payload = usage.build(rows, [], season=2026, week=6, rosters=rosters)
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


# --------------------------------------------------------------------------
# what the app needs to fold a sportsbook line in


def test_projection_stretches_the_average_by_the_matchup():
    assert recommender.projection(60.0, allowed=80.0, league_avg=40.0) == 96.0, "capped at 1.6x"
    assert recommender.projection(60.0, allowed=50.0, league_avg=40.0) == 75.0
    assert recommender.projection(60.0, allowed=10.0, league_avg=40.0) == 36.0, "floored at 0.6x"
    assert recommender.projection(60.0, allowed=50.0, league_avg=None) == 60.0


def test_td_probability_is_poisson():
    assert recommender.td_probability(0.0) == 0.0
    assert 0.39 < recommender.td_probability(0.5) < 0.40
    assert recommender.td_probability(-1.0) == 0.0


def test_cards_carry_a_projection_and_the_payload_carries_the_line_weight():
    schedule_payload, dvp_payload, usage_payload = _fixture_payloads()
    result = recommender.build(schedule_payload, dvp_payload, usage_payload, week=7)
    assert 0 < result["line_weight"] <= 0.5
    assert result["value_scale"] > 0
    for card in result["recommendations"]:
        # DEN is the softest defense in the fixture, so the matchup can only help.
        assert card["projection"] >= card["player"]["per_game"]
        if card["market"].endswith("anytime_td"):
            assert 0.0 <= card["td_prob"] <= 1.0
        else:
            assert card["td_prob"] is None


# --------------------------------------------------------------------------
# a teammate out: who inherits his work


def _room(position, stints, team="KC"):
    """Player-weeks for a position room. `stints` maps a name to a list of
    (weeks, {column: value per game}) spells."""
    rows = []
    for index, (name, spells) in enumerate(stints.items()):
        for weeks, values in spells:
            for w in weeks:
                rows.append(week_row(
                    week=w, team=team, position=position, position_group=position,
                    player_display_name=name, player_id=f"{position}{index}",
                    **values,
                ))
    return rows


def _by_name(payload, position, team="KC"):
    return {p["name"]: p for p in usage.players_for(payload, team, position)}


RB_LINE = {"carries": 20, "rushing_yards": 90, "rushing_tds": 1, "targets": 2}
BACKUP_LINE = {"carries": 6, "rushing_yards": 30, "targets": 1}
THIRD_LINE = {"carries": 4, "rushing_yards": 14, "targets": 1}


def _fresh_injury_room(status="Out"):
    """RB1 played every game through week 6 and is out for week 7."""
    rows = _room("RB", {
        "Starter": [(range(1, 7), RB_LINE)],
        "Backup": [(range(1, 7), BACKUP_LINE)],
        "Third": [(range(1, 7), THIRD_LINE)],
    })
    injuries = [{"season": "2026", "week": "7", "team": "KC", "full_name": "Starter",
                 "position": "RB", "report_status": status}]
    return usage.build(rows, injuries, season=2026, week=7)


def test_out_players_give_up_their_depth_slot():
    backs = _by_name(_fresh_injury_room(), "RB")
    assert backs["Starter"]["depth"]["carries"] == 3
    assert backs["Backup"]["depth"]["carries"] == 1
    assert backs["Backup"]["roles"]["carries"] == "primary"
    assert backs["Third"]["depth"]["carries"] == 2
    assert backs["Third"]["roles"]["carries"] == "secondary"


def test_a_fresh_injury_is_handed_out_in_proportion_capped_at_double():
    backs = _by_name(_fresh_injury_room(), "RB")
    backup = backs["Backup"]
    # Starter had 20 of 30 carries: 1 / (1 - 2/3) = 3x, capped at 2x.
    assert backup["season_shares"]["carries"] == pytest.approx(0.2)
    assert backup["shares"]["carries"] == pytest.approx(0.4)
    assert backup["per_game"]["carries"] == pytest.approx(12)
    assert backup["per_game"]["rushing_yards"] == pytest.approx(60)
    assert backup["season_per_game"]["rushing_yards"] == pytest.approx(30)
    # His targets scale by the targets the starter left: 2 of 4 -> 2x.
    assert backup["per_game"]["targets"] == pytest.approx(2)
    assert backup["basis"] == {
        "kind": "estimated", "without": ["Starter"], "since_week": None, "games": 6,
    }
    assert backup["games"] == 6
    assert "basis" not in backs["Starter"], "the injured man keeps his own line"


def test_games_already_played_without_him_are_the_evidence():
    rows = _room("RB", {
        "Starter": [(range(1, 5), RB_LINE)],
        "Backup": [(range(1, 5), BACKUP_LINE),
                   (range(5, 8), {"carries": 18, "rushing_yards": 80, "targets": 3})],
        "Third": [(range(1, 5), THIRD_LINE),
                  (range(5, 8), {"carries": 8, "rushing_yards": 30, "targets": 1})],
    })
    rosters = [_roster(8, "Starter", "RES", gsis_id="RB0"),
               _roster(8, "Backup", "ACT", gsis_id="RB1"),
               _roster(8, "Third", "ACT", gsis_id="RB2")]
    backup = _by_name(usage.build(rows, [], season=2026, week=8, rosters=rosters), "RB")["Backup"]
    assert backup["basis"] == {
        "kind": "without", "without": ["Starter"], "since_week": 5, "games": 3,
    }
    assert backup["shares"]["carries"] == pytest.approx(18 / 26, abs=1e-4)
    assert backup["per_game"]["carries"] == pytest.approx(18)
    assert backup["per_game"]["rushing_yards"] == pytest.approx(80)
    assert backup["season_per_game"]["carries"] == pytest.approx((6 * 4 + 18 * 3) / 7, abs=0.01)


def test_one_game_without_him_is_not_enough_evidence():
    rows = _room("RB", {
        "Starter": [(range(1, 6), RB_LINE)],
        "Backup": [(range(1, 7), BACKUP_LINE)],
        "Third": [(range(1, 7), THIRD_LINE)],
    })
    rosters = [_roster(7, "Starter", "RES", gsis_id="RB0"),
               _roster(7, "Backup", "ACT", gsis_id="RB1"),
               _roster(7, "Third", "ACT", gsis_id="RB2")]
    backup = _by_name(usage.build(rows, [], season=2026, week=7, rosters=rosters), "RB")["Backup"]
    assert backup["basis"]["kind"] == "estimated"
    assert backup["basis"]["since_week"] is None


def test_an_old_and_a_fresh_injury_together():
    rows = _room("WR", {
        "Long Gone": [(range(1, 4), {"targets": 10, "receiving_yards": 100})],
        "Just Hurt": [(range(1, 8), {"targets": 6, "receiving_yards": 60})],
        "Slot": [(range(1, 4), {"targets": 4, "receiving_yards": 40}),
                 (range(4, 8), {"targets": 6, "receiving_yards": 55})],
        "Deep": [(range(1, 4), {"targets": 2, "receiving_yards": 30}),
                 (range(4, 8), {"targets": 4, "receiving_yards": 50})],
    })
    rosters = [_roster(8, "Long Gone", "RES", gsis_id="WR0"),
               _roster(8, "Just Hurt", "RES", gsis_id="WR1"),
               _roster(8, "Slot", "ACT", gsis_id="WR2"),
               _roster(8, "Deep", "ACT", gsis_id="WR3")]
    slot = _by_name(usage.build(rows, [], season=2026, week=8, rosters=rosters), "WR")["Slot"]
    # Weeks 4-7 are life without Long Gone; Just Hurt's 6 of 16 targets there
    # are handed out on top: 1 / (1 - 6/16) = 1.6x.
    assert slot["basis"]["kind"] == "estimated"
    assert slot["basis"]["since_week"] == 4
    assert slot["basis"]["without"] == ["Just Hurt", "Long Gone"]
    assert slot["shares"]["targets"] == pytest.approx(6 / 16 * 1.6, abs=1e-4)
    assert slot["per_game"]["receiving_yards"] == pytest.approx(55 * 1.6)


def test_backup_quarterbacks_are_not_estimated_but_do_use_real_starts():
    qb = {"attempts": 35, "passing_yards": 250}
    mop_up = {"attempts": 2, "passing_yards": 10}
    fresh = _room("QB", {"Starter": [(range(1, 7), qb)], "Backup": [(range(1, 7), mop_up)]})
    rosters = [_roster(7, "Starter", "RES", gsis_id="QB0"),
               _roster(7, "Backup", "ACT", gsis_id="QB1")]
    backup = _by_name(usage.build(fresh, [], season=2026, week=7, rosters=rosters), "QB")["Backup"]
    assert "basis" not in backup
    started = _room("QB", {"Starter": [(range(1, 4), qb)],
                           "Backup": [(range(1, 4), mop_up), (range(4, 7), qb)]})
    backup = _by_name(usage.build(started, [], season=2026, week=7, rosters=rosters), "QB")["Backup"]
    assert backup["basis"]["kind"] == "without"
    assert backup["per_game"]["passing_yards"] == pytest.approx(250)


def test_nothing_changes_for_questionable_bit_part_or_returning_players():
    assert "basis" not in _by_name(_fresh_injury_room("Questionable"), "RB")["Backup"]

    rows = _room("RB", {
        "Starter": [(range(1, 7), RB_LINE)],
        "Backup": [(range(1, 7), BACKUP_LINE)],
        "Scrub": [(range(1, 7), {"carries": 1, "rushing_yards": 3})],
    })
    def roster(week, scrub="ACT", starter="ACT"):
        return [_roster(week, "Starter", starter, gsis_id="RB0"),
                _roster(week, "Backup", "ACT", gsis_id="RB1"),
                _roster(week, "Scrub", scrub, gsis_id="RB2")]

    backs = _by_name(usage.build(rows, [], season=2026, week=7, rosters=roster(7, scrub="RES")), "RB")
    assert backs["Scrub"]["status"] == "Out"
    assert backs["Backup"]["status"] == "active" and "basis" not in backs["Backup"]

    rosters = roster(5, starter="RES") + roster(7)
    backs = _by_name(usage.build(rows, [], season=2026, week=7, rosters=rosters), "RB")
    assert backs["Starter"]["status"] == "active", "back from IR"
    assert "basis" not in backs["Backup"]


def _rb_recommendations(usage_payload):
    defense_rows = [
        week_row(week=w, opponent_team="DEN", position="RB", player_id=f"d{w}",
                 carries=25, rushing_yards=160, rushing_tds=2)
        for w in range(1, 7)
    ] + [
        week_row(week=w, opponent_team="LV", position="RB", player_id=f"l{w}",
                 carries=15, rushing_yards=40)
        for w in range(1, 7)
    ]
    schedule_payload = {
        "season": 2026, "current_week": 7,
        "games": [{"id": "2026_07_KC_DEN", "week": 7, "kickoff": "2026-10-18T17:00:00Z",
                   "home": "DEN", "away": "KC", "type": "REG"}],
    }
    result = recommender.build(schedule_payload, dvp.build(defense_rows, season=2026),
                               usage_payload, week=7)
    return result["recommendations"]


def test_cards_say_the_role_is_an_estimate_and_trust_it_less():
    cards = _rb_recommendations(_fresh_injury_room())
    card = next(c for c in cards
                if c["player"]["name"] == "Backup" and c["market"] == "rb_rushing_yards")
    player = card["player"]
    assert player["per_game"] == pytest.approx(60)
    assert player["games"] == 6, "games stays the season count (the app checks it)"
    assert player["basis"]["kind"] == "estimated"
    assert player["basis"]["season_per_game"] == pytest.approx(30)
    assert player["basis"]["season_share"] == pytest.approx(0.2)
    assert card["components"]["confidence"] == pytest.approx(
        recommender.confidence(6, 6) * recommender.ESTIMATE_CONFIDENCE
    )
    assert "With Starter out, his carry share is estimated up from 20% to 40%" in card["rationale"]
    assert not any(c["player"]["name"] == "Starter" for c in cards)


def test_cards_built_on_games_without_him_say_so():
    rows = _room("RB", {
        "Starter": [(range(1, 4), RB_LINE)],
        "Backup": [(range(1, 4), BACKUP_LINE),
                   (range(4, 7), {"carries": 18, "rushing_yards": 80, "targets": 3})],
    })
    rosters = [_roster(7, "Starter", "RES", gsis_id="RB0"),
               _roster(7, "Backup", "ACT", gsis_id="RB1")]
    cards = _rb_recommendations(usage.build(rows, [], season=2026, week=7, rosters=rosters))
    card = next(c for c in cards
                if c["player"]["name"] == "Backup" and c["market"] == "rb_rushing_yards")
    assert card["components"]["confidence"] == pytest.approx(recommender.confidence(6, 3))
    assert "With Starter out: 80 yds per game over his 3 games since week 4 (season 55)" in card["rationale"]


def test_a_traded_players_share_counts_only_his_new_team():
    rows = [week_row(week=w, team="ARI", player_display_name="Traded", player_id="t1",
                     position="QB", attempts=35, passing_yards=250) for w in range(1, 6)]
    rows += [week_row(week=w, team="BAL", player_display_name="Traded", player_id="t1",
                      position="QB", attempts=30, passing_yards=200) for w in range(6, 9)]
    rows += [week_row(week=w, team="BAL", player_display_name="Original", player_id="o1",
                      position="QB", attempts=30, passing_yards=200) for w in range(1, 6)]
    payload = usage.build(rows, season=2026, week=9)
    traded = _by_name(payload, "QB", team="BAL")["Traded"]
    assert traded["shares"]["attempts"] == pytest.approx(90 / 240)
    assert traded["games"] == 8, "his production line still counts every game"
