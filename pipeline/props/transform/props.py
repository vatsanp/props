"""Turn a soft matchup plus a busy player into a recommendation.

The rule mirrors the team-level mismatch rule this project started with: only
surface the extremes. A defense has to be bottom-third against the position,
the player has to be someone who actually gets the ball, and he has to be
playing. Everything else is noise dressed up as a pick.

The score is a weighted sum of three published components rather than a fitted
model, because every card has to be explainable in one sentence:

    score = 0.45*softness + 0.35*usage + 0.20*confidence

No sportsbook lines are involved. The output says who to look at and why; the
number in your app is still the number you have to beat.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .. import teams as registry
from ..markets import MARKETS, MARKET_ORDER, Market, share_column_for
from . import dvp as dvp_module
from . import usage as usage_module

#: A defense must be at least this soft (rank 1 = softest of 32).
MAX_SOFTNESS_RANK = 10

#: Games of evidence at which confidence saturates.
CONFIDENCE_GAMES = 6.0

WEIGHTS = {"softness": 0.45, "usage": 0.35, "confidence": 0.20}


def confidence(defense_games: int, player_games: int) -> float:
    """Driven by whichever side has seen fewer games. Capped at 1."""
    games = min(defense_games, player_games)
    return round(min(games / CONFIDENCE_GAMES, 1.0), 4) if games > 0 else 0.0


def score(softness_pct: float, usage_pct: float, conf: float) -> float:
    return round(
        WEIGHTS["softness"] * softness_pct
        + WEIGHTS["usage"] * usage_pct
        + WEIGHTS["confidence"] * min(conf, 1.0),
        4,
    )


def build(
    schedule_payload: dict,
    dvp_payload: dict,
    usage_payload: dict,
    week: Optional[int] = None,
    max_rank: int = MAX_SOFTNESS_RANK,
) -> dict:
    week = week if week is not None else schedule_payload.get("current_week")
    games = [
        game
        for game in schedule_payload["games"]
        if week is not None and game["week"] == week
    ]

    # Expressed as "bottom `max_rank` of 32", but applied as a percentile so a
    # metric with fewer than 32 ranked defenses does not quietly let a stingy
    # defense through on a compressed scale.
    threshold = (32 - max_rank) / 31

    usage_pcts = _usage_percentiles(usage_payload)
    recommendations: List[dict] = []

    for game in games:
        for offense, defense in ((game["home"], game["away"]), (game["away"], game["home"])):
            for market_id in MARKET_ORDER:
                market = MARKETS[market_id]
                cell = dvp_module.lookup(
                    dvp_payload, defense, market.position, market.metric
                )
                if cell is None or cell["softness_pct"] < threshold:
                    continue
                # A defense that has allowed none of this is not a soft
                # matchup. Early in a season most defenses are tied at zero for
                # the touchdown markets, and every one of them would otherwise
                # rank 1 and be sold as the league's weakest.
                if cell["allowed_per_game"] <= 0:
                    continue

                for player in usage_module.players_for(
                    usage_payload, offense, market.position
                ):
                    card = _card(game, market, offense, defense, cell, player, usage_pcts)
                    if card is not None:
                        recommendations.append(card)

    recommendations.sort(key=lambda r: (-r["score"], r["player"]["name"], r["market"]))
    return {
        "week": week,
        "max_softness_rank": max_rank,
        "weights": WEIGHTS,
        "note": "informational: matchup and usage evidence, not betting lines",
        "recommendations": recommendations,
    }


def _card(
    game: dict,
    market: Market,
    offense: str,
    defense: str,
    cell: dict,
    player: dict,
    usage_pcts: Dict[str, Dict[str, float]],
) -> Optional[dict]:
    if not usage_module.available(player):
        return None

    # The share and depth chart that make this market's claim true: targets for
    # a receiving prop, carries for a rushing one.
    share_column = share_column_for(market)
    role = player["roles"][share_column]
    if role == "committee":
        return None

    produced = sum(player["per_game"].get(column, 0.0) for column in market.columns)
    if produced < market.min_per_game:
        return None

    share = player["shares"][share_column]
    usage_pct = usage_pcts.get(market.position, {}).get(share_column, {}).get(
        _player_key(player), 0.0
    )
    conf = confidence(cell["games"], player["games"])
    total = score(cell["softness_pct"], usage_pct, conf)

    return {
        "game_id": game["id"],
        "week": game["week"],
        "kickoff": game["kickoff"],
        "market": market.id,
        "market_label": market.label,
        "position": market.position,
        "player": {
            "id": player["id"],
            "name": player["name"],
            "team": offense,
            "position": market.position,
            "role": role,
            "depth": player["depth"][share_column],
            "status": player["status"],
            "games": player["games"],
            "share": share,
            "share_of": share_column,
            "per_game": round(produced, 2),
            "unit": market.unit,
        },
        "defense": {
            "team": defense,
            "allowed_per_game": cell["allowed_per_game"],
            "softness_rank": cell["softness_rank"],
            "games": cell["games"],
            "blend_weight": cell["blend_weight"],
            "current": cell["current"],
            "prior": cell["prior"],
        },
        "score": total,
        "components": {
            "softness": cell["softness_pct"],
            "usage": usage_pct,
            "confidence": min(conf, 1.0),
        },
        "rationale": _rationale(
            market, defense, cell, player, produced, share, share_column
        ),
    }


SHARE_NOUN = {
    "targets": "target share",
    "carries": "carry share",
    "attempts": "of the team's pass attempts",
}


def _rationale(
    market: Market,
    defense: str,
    cell: dict,
    player: dict,
    produced: float,
    share: float,
    share_column: str,
) -> str:
    defense_name = registry.get(defense).location
    ordinal = _ordinal(33 - cell["softness_rank"])
    share_text = (
        f", {round(share * 100)}% {SHARE_NOUN[share_column]}" if share else ""
    )
    sentence = (
        f"{defense_name} allows {cell['allowed_per_game']:g} {market.noun} per game "
        f"to {market.position}s ({ordinal} of 32). "
        f"{player['name']}: {produced:g} {market.unit} per game{share_text}."
    )
    if cell["blend_weight"] < 0.6 and cell["prior"] is not None:
        sentence += (
            f" Based on {cell['games']} game{'s' if cell['games'] != 1 else ''} this"
            " season, blended with last season."
        )
    if player["status"] in usage_module.WARN_STATUSES:
        sentence += f" Listed {player['status'].lower()}."
    return sentence


def _ordinal(number: int) -> str:
    if 10 <= number % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def _player_key(player: dict) -> str:
    return player["id"] or f"{player['team']}:{player['name']}"


def _usage_percentiles(usage_payload: dict) -> Dict[str, Dict[str, Dict[str, float]]]:
    """Where each player's share sits among everyone at his position.

    Keyed by position and then by share column, because a back's standing among
    receiving backs is a different number from his standing among ball carriers.
    """
    buckets: Dict[str, Dict[str, List[tuple]]] = {}
    for positions in usage_payload["teams"].values():
        for position, players in positions.items():
            for player in players:
                for share_column, share in player["shares"].items():
                    buckets.setdefault(position, {}).setdefault(share_column, []).append(
                        (_player_key(player), share)
                    )

    out: Dict[str, Dict[str, Dict[str, float]]] = {}
    for position, by_column in buckets.items():
        for share_column, entries in by_column.items():
            entries.sort(key=lambda kv: kv[1])
            total = len(entries)
            for index, (key, _share) in enumerate(entries):
                out.setdefault(position, {}).setdefault(share_column, {})[key] = (
                    round(index / (total - 1), 4) if total > 1 else 1.0
                )
    return out
