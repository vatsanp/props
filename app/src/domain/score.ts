/**
 * Folding a sportsbook line into a card's score, on-device.
 *
 * The pipeline publishes the score from three components (softness, usage,
 * confidence). It cannot know the line: lines move every few minutes and
 * arrive through the Worker. So the line is applied here, the same way team
 * matchup edges are computed on-device in mismatch.ts -- because the input
 * changes faster than the pipeline runs.
 *
 *   value      = 0.5 + edge / (2 * value_scale), clamped to [0, 1]
 *   adjustment = line_weight * (2 * value - 1)          in [-line_weight, +line_weight]
 *   score      = pipeline score + adjustment, clamped to [0, 1]
 *
 * `edge` is (projection - line) / line for yardage and count markets, and
 * (model P(TD) - the books' no-vig P(TD)) for anytime TD.
 *
 * It is an adjustment, not a re-weighting, on purpose. Re-weighting gave the
 * line a share of the score, so a perfectly fair line (value 0.5) pulled every
 * strong card toward the middle -- and on the free tier, where only games near
 * kickoff have lines, those cards sank below games with no line at all. Here a
 * fair line changes nothing, and only a real gap moves the score.
 */

import type { PropsPayload, Recommendation } from '../api/schemas';
import type { Lines } from './odds';

export interface LiveScore {
  score: number;
  /** The pipeline's components, plus `value` when a line was folded in. */
  components: Record<string, number>;
  /** The pipeline's weights for its three components. */
  weights: Record<string, number>;
  /** True when a line was available and folded in. */
  withLine: boolean;
  /** Projection minus line (yardage, relative) or model minus book probability (TD). */
  edge: number | null;
  /** What the line added to (or took from) the pipeline score. */
  adjustment: number;
  /** The most the line could have moved it. */
  lineWeight: number;
}

type Weights = Pick<PropsPayload, 'weights' | 'line_weight' | 'value_scale'>;

const DEFAULT_SCALE = 0.25;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** The raw edge, before scaling, or null when there is nothing to compare. */
export function edgeFor(card: Recommendation, lines: Lines | null): number | null {
  if (!lines) return null;
  if (lines.isTd) {
    if (card.td_prob == null || lines.impliedYes === null) return null;
    return card.td_prob - lines.impliedYes;
  }
  if (card.projection == null || lines.consensus === null || lines.consensus <= 0) return null;
  return (card.projection - lines.consensus) / lines.consensus;
}

export function valueComponent(edge: number, scale: number): number {
  return round4(clamp01(0.5 + edge / (2 * (scale > 0 ? scale : DEFAULT_SCALE))));
}

export function liveScore(
  card: Recommendation,
  payload: Weights | undefined,
  lines: Lines | null,
): LiveScore {
  const lineWeight = payload?.line_weight ?? 0;
  const base: LiveScore = {
    score: card.score,
    components: card.components,
    weights: payload?.weights ?? {},
    withLine: false,
    edge: null,
    adjustment: 0,
    lineWeight,
  };
  const edge = edgeFor(card, lines);
  if (!(lineWeight > 0) || edge === null) return base;

  const value = valueComponent(edge, payload?.value_scale ?? DEFAULT_SCALE);
  const adjustment = round4(lineWeight * (2 * value - 1));
  return {
    ...base,
    score: round4(clamp01(card.score + adjustment)),
    components: { ...card.components, value },
    withLine: true,
    edge,
    adjustment,
  };
}
