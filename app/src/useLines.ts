import { useMemo } from 'react';

import { useOdds } from './api/queries';
import type { PropsPayload, Recommendation } from './api/schemas';
import { linesFor, type Lines } from './domain/odds';
import { liveScore, type LiveScore } from './domain/score';

export interface LiveCard {
  card: Recommendation;
  lines: Lines | null;
  live: LiveScore;
}

/**
 * Every card paired with its sportsbook lines and its line-aware score.
 *
 * Recomputed on each odds fetch (`dataUpdatedAt`), not only when the payload
 * changes, so a game's lines drop away once it kicks off even if the odds
 * themselves did not move.
 */
export function useLiveCards(payload: PropsPayload | undefined) {
  const odds = useOdds();
  const cards = useMemo<LiveCard[]>(() => {
    const now = Date.now();
    return (payload?.recommendations ?? []).map((card) => {
      const lines = linesFor(card, odds.data, now);
      return { card, lines, live: liveScore(card, payload, lines) };
    });
  }, [payload, odds.data, odds.dataUpdatedAt]);

  const withLines = cards.filter((c) => c.lines).length;
  return { cards, odds, withLines };
}
