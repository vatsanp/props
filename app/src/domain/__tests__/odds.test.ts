/**
 * Sportsbook lines: matching them to cards, and folding them into the score.
 *
 *   npm run test:odds
 */

import assert from 'node:assert/strict';

import type { Odds, PropsPayload, Recommendation } from '../../api/schemas';
import {
  americanToProb,
  findQuote,
  formatAmerican,
  linesFor,
  normalizeName,
  teamIdFromName,
} from '../odds';
import { edgeFor, liveScore, valueComponent } from '../score';

const NOW = Date.parse('2026-11-29T16:00:00Z');
const KICKOFF = '2026-11-29T18:00:00Z';

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void) => tests.push([name, run]);

function card(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: '2026_13_DEN_KC~te_receiving_yards~te1',
    game_id: '2026_13_DEN_KC',
    week: 13,
    kickoff: KICKOFF,
    market: 'te_receiving_yards',
    market_label: 'Receiving Yards',
    metric: 'receiving_yards',
    position: 'TE',
    player: {
      id: 'te1', name: 'Travis Kelce', team: 'KC', position: 'TE', role: 'primary',
      depth: 1, status: 'Active', games: 10, share: 0.24, share_of: 'targets',
      per_game: 60, unit: 'yds',
    },
    defense: {
      team: 'DEN', allowed_per_game: 70, softness_rank: 3, games: 10,
      blend_weight: 1, current: 70, prior: null,
    },
    projection: 66,
    td_prob: null,
    score: 0.8,
    components: { softness: 0.9, usage: 0.8, confidence: 0.6 },
    rationale: '.',
    ...overrides,
  };
}

const PAYLOAD: Pick<PropsPayload, 'weights' | 'line_weight' | 'value_scale'> = {
  weights: { softness: 0.45, usage: 0.35, confidence: 0.2 },
  line_weight: 0.2,
  value_scale: 0.25,
};

function odds(events: Odds['events'], books = ['fanduel', 'draftkings', 'espnbet']): Odds {
  return {
    schema_version: 1,
    updated_at: '2026-11-29T15:58:00Z',
    events_listed_at: null,
    credits_remaining: 400,
    last_error: null,
    books,
    events,
  };
}

const GAME: Odds = odds({
  e1: {
    home: 'Kansas City Chiefs',
    away: 'Denver Broncos',
    commence: KICKOFF,
    fetched_at: '2026-11-29T15:58:00Z',
    books: {
      fanduel: {
        player_reception_yds: { 'Travis Kelce': [54.5, -115, -105] },
        player_anytime_td: { 'Travis Kelce': [null, 150, -190] },
      },
      draftkings: {
        player_reception_yds: { 'Travis Kelce': [55.5, -110, -110] },
        player_anytime_td: { 'Travis Kelce': [null, 140, null] },
      },
      espnbet: { player_reception_yds: { 'Travis Kelce': [55.5, -105, -115] } },
    },
  },
});

// --------------------------------------------------------------------------

test('names: punctuation, accents and suffixes do not block a match', () => {
  assert.equal(normalizeName('A.J. Brown'), normalizeName('AJ Brown'));
  assert.equal(normalizeName('Amon-Ra St. Brown'), normalizeName('Amon-Ra St Brown'));
  assert.equal(normalizeName('Kenneth Walker III'), 'kenneth walker');
  assert.equal(normalizeName('Marvin Harrison Jr.'), 'marvin harrison');
  assert.equal(normalizeName('Michael Pittman Jr.'), normalizeName('Michael Pittman'));
  assert.equal(normalizeName('Ja’Marr Chase'), normalizeName("Ja'Marr Chase"));
});

test('names: a loose match needs exactly one candidate', () => {
  const market = { 'Josh Downs': [50.5, -110, -110] as const, 'Jalen Downs': [10.5, -110, -110] as const };
  assert.equal(findQuote({ ...market } as never, 'J. Downs'), null, 'two J. Downses: refuse');
  assert.deepEqual(findQuote({ 'Josh Downs': [50.5, -110, -110] }, 'J. Downs'), [50.5, -110, -110]);
  assert.equal(findQuote({ 'Josh Downs': [50.5, -110, -110] }, 'Tyler Downs'), null);
});

test('teams: Odds API full names map to app team ids', () => {
  assert.equal(teamIdFromName('Kansas City Chiefs'), 'KC');
  assert.equal(teamIdFromName('Los Angeles Rams'), 'LAR');
  assert.equal(teamIdFromName('Washington Commanders'), 'WAS');
  assert.equal(teamIdFromName('San Francisco 49ers'), 'SF');
});

test('prices: American odds to probability', () => {
  assert.equal(americanToProb(-150), 0.6);
  assert.equal(americanToProb(150), 0.4);
  assert.equal(americanToProb(100), 0.5);
  assert.equal(formatAmerican(150), '+150');
  assert.equal(formatAmerican(-110), '-110');
  assert.equal(formatAmerican(null), '—');
});

test('lines: every book, the median, and the lowest line as the best over', () => {
  const lines = linesFor(card(), GAME, NOW)!;
  assert.equal(lines.books.length, 3);
  assert.equal(lines.consensus, 55.5);
  assert.equal(lines.best?.book, 'fanduel', 'the lowest line is the best over');
  assert.equal(lines.isTd, false);
});

test('lines: anytime TD uses the no-vig yes probability, averaged across books', () => {
  const td = card({ market: 'te_anytime_td', td_prob: 0.5, projection: 0.69 });
  const lines = linesFor(td, GAME, NOW)!;
  assert.equal(lines.isTd, true);
  assert.equal(lines.consensus, null);
  assert.equal(lines.best?.book, 'fanduel', '+150 beats +140');
  const fd = 0.4 / (0.4 + 190 / 290);
  const dk = 100 / 240; // no "no" price, so the vig stays in
  assert.ok(Math.abs(lines.impliedYes! - (fd + dk) / 2) < 1e-9);
});

test('lines: none after kickoff, for another game, or with no Worker', () => {
  assert.equal(linesFor(card(), GAME, Date.parse(KICKOFF)), null, 'pregame only');
  assert.equal(linesFor(card({ defense: { ...card().defense, team: 'LV' } }), GAME, NOW), null);
  assert.equal(linesFor(card({ kickoff: '2026-12-13T18:00:00Z' }), GAME, NOW), null, 'the rematch');
  assert.equal(linesFor(card(), undefined, NOW), null);
  assert.equal(
    linesFor(card({ player: { ...card().player, name: 'Noah Gray' } }), GAME, NOW),
    null,
    'a player no book quotes',
  );
});

test('score: with no line it is exactly the pipeline score', () => {
  const live = liveScore(card(), PAYLOAD, null);
  assert.equal(live.score, 0.8);
  assert.equal(live.withLine, false);
  assert.deepEqual(live.weights, PAYLOAD.weights);
});

test('score: an old payload without a line weight ignores the line', () => {
  const lines = linesFor(card(), GAME, NOW);
  const live = liveScore(card(), { weights: PAYLOAD.weights }, lines);
  assert.equal(live.withLine, false);
  assert.equal(live.score, 0.8);
});

test('score: value is 0.5 on the line and saturates at value_scale', () => {
  assert.equal(valueComponent(0, 0.25), 0.5);
  assert.equal(valueComponent(0.25, 0.25), 1);
  assert.equal(valueComponent(0.5, 0.25), 1);
  assert.equal(valueComponent(-0.25, 0.25), 0);
  assert.equal(valueComponent(0.125, 0.25), 0.75);
});

test('score: a fair line leaves the score exactly where it was', () => {
  const lines = linesFor(card(), GAME, NOW); // consensus 55.5
  const fair = liveScore(card({ projection: 55.5 }), PAYLOAD, lines);
  assert.equal(fair.withLine, true);
  assert.equal(fair.components.value, 0.5);
  assert.equal(fair.adjustment, 0);
  assert.equal(fair.score, 0.8, 'a book posting a fair number must not cost the card points');
});

test('score: a projection above the line raises the score, below lowers it', () => {
  const lines = linesFor(card(), GAME, NOW);
  const above = liveScore(card({ projection: 66 }), PAYLOAD, lines); // 55.5 line, +19%
  const below = liveScore(card({ projection: 45 }), PAYLOAD, lines); // -19%
  assert.ok(Math.abs(above.edge! - (66 - 55.5) / 55.5) < 1e-9);
  const value = 0.5 + (66 - 55.5) / 55.5 / 0.5;
  assert.ok(Math.abs(above.adjustment - 0.2 * (2 * value - 1)) < 1e-4);
  assert.ok(Math.abs(above.score - (0.8 + above.adjustment)) < 1e-4);
  assert.ok(Math.abs(below.adjustment + above.adjustment) < 1e-3, 'symmetric');
  assert.ok(above.score > 0.8 && below.score < 0.8);
});

test('score: the line moves it at most line_weight, and never out of range', () => {
  const lines = linesFor(card(), GAME, NOW);
  const way = liveScore(card({ projection: 200, score: 0.95 }), PAYLOAD, lines);
  assert.equal(way.adjustment, 0.2);
  assert.equal(way.score, 1, 'clamped at 100');
  const under = liveScore(card({ projection: 1, score: 0.1 }), PAYLOAD, lines);
  assert.equal(under.adjustment, -0.2);
  assert.equal(under.score, 0, 'clamped at 0');
});

test('score: TD edge is model probability minus the books', () => {
  const td = card({ market: 'te_anytime_td', td_prob: 0.5 });
  const lines = linesFor(td, GAME, NOW)!;
  assert.ok(Math.abs(edgeFor(td, lines)! - (0.5 - lines.impliedYes!)) < 1e-12);
  assert.equal(edgeFor(card({ market: 'te_anytime_td', td_prob: null }), lines), null);
});

// --------------------------------------------------------------------------

let failures = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures ? 1 : 0);
