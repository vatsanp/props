/**
 * The odds poller's scheduling, credit guard and reshaping, with KV and
 * The Odds API faked. No network, no wrangler.
 *
 *   cd worker && npm test        (runs with the app's tsx)
 */

import assert from 'node:assert/strict';

import { ODDS_MARKETS } from '../../app/src/domain/markets';
import {
  ODDS_KEY,
  compactEvent,
  config,
  creditCost,
  dueEvents,
  emptyPayload,
  mergeListing,
  pollOdds,
  selectFetches,
  type OddsEnv,
  type OddsEvent,
  type OddsPayload,
} from '../src/odds';

const MIN = 60_000;
const NOW = Date.parse('2026-11-29T16:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push([name, run]);

function event(kickoffInMin: number, fetchedMinAgo: number | null = null): OddsEvent {
  return {
    home: 'Kansas City Chiefs',
    away: 'Denver Broncos',
    commence: iso(NOW + kickoffInMin * MIN),
    fetched_at: fetchedMinAgo === null ? null : iso(NOW - fetchedMinAgo * MIN),
    books: {},
  };
}

function payloadWith(events: Record<string, OddsEvent>): OddsPayload {
  return { ...emptyPayload(), events };
}

const FREE = config({ ODDS_ENABLED: 'true' } as OddsEnv);
const PAID = config({
  ODDS_ENABLED: 'true',
  ODDS_FAR_MIN: '60',
  ODDS_NEAR_MIN: '5',
  ODDS_NEAR_WINDOW_MIN: '180',
} as OddsEnv);

// --------------------------------------------------------------------------

test('defaults are the free-tier books and one fetch per game', () => {
  assert.deepEqual(FREE.books, ['fanduel', 'draftkings', 'espnbet', 'betmgm']);
  assert.equal(FREE.farMin, 0);
  assert.equal(FREE.nearMin, 0);
  assert.equal(creditCost(FREE), ODDS_MARKETS.length);
  assert.equal(ODDS_MARKETS.length, 7, 'one key per distinct Odds API market');
});

test('free tier: nothing is due until the 90-minute window opens', () => {
  const due = dueEvents(payloadWith({ far: event(600), near: event(80) }), FREE, NOW);
  assert.deepEqual(due.map((d) => d.id), ['near']);
});

test('free tier: a game fetched inside the window is not fetched again', () => {
  const p = payloadWith({ once: event(80, 5) });
  assert.deepEqual(dueEvents(p, FREE, NOW), []);
});

test('a fetch from before the window opened does not count', () => {
  const p = payloadWith({ stale: event(80, 30) }); // fetched at T-110, window opened at T-90
  assert.deepEqual(dueEvents(p, FREE, NOW).map((d) => d.id), ['stale']);
});

test('paid cadence: far games hourly, near games every 5 minutes', () => {
  const p = payloadWith({
    farFresh: event(600, 30),
    farStale: event(600, 61),
    nearFresh: event(60, 2),
    nearStale: event(60, 6),
  });
  assert.deepEqual(dueEvents(p, PAID, NOW).map((d) => d.id).sort(), ['farStale', 'nearStale']);
});

test('started games and games past the horizon are never due', () => {
  const p = payloadWith({ started: event(-1), nextWeek: event(8 * 24 * 60) });
  assert.deepEqual(dueEvents(p, PAID, NOW), []);
});

test('due events come nearest kickoff first and are capped per tick', () => {
  const p = payloadWith({ c: event(85), a: event(10), b: event(40), d: event(89) });
  const ids = selectFetches(dueEvents(p, FREE, NOW), FREE, null);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('credit guard: under the reserve only near games; under one refresh nothing', () => {
  const cfg = { ...PAID, creditReserve: 100 };
  const due = [
    { id: 'near', near: true },
    { id: 'far', near: false },
  ];
  assert.deepEqual(selectFetches(due, cfg, 500), ['near', 'far']);
  assert.deepEqual(selectFetches(due, cfg, 50), ['near']);
  assert.deepEqual(selectFetches(due, cfg, 6), []);
  assert.deepEqual(selectFetches(due, cfg, 7), ['near'], 'exactly one refresh left');
});

test('reshaping: over/under become [line, over, under]', () => {
  const compact = compactEvent(
    {
      id: 'e1',
      commence_time: iso(NOW + 60 * MIN),
      home_team: 'Kansas City Chiefs',
      away_team: 'Denver Broncos',
      bookmakers: [
        {
          key: 'fanduel',
          markets: [
            {
              key: 'player_reception_yds',
              outcomes: [
                { name: 'Over', description: 'Travis Kelce', price: -115, point: 54.5 },
                { name: 'Under', description: 'Travis Kelce', price: -105, point: 54.5 },
              ],
            },
            {
              key: 'player_anytime_td',
              outcomes: [
                { name: 'Yes', description: 'Travis Kelce', price: 150 },
                { name: 'No', description: 'Travis Kelce', price: -200 },
              ],
            },
            { key: 'player_pass_tds', outcomes: [] },
          ],
        },
        { key: 'betmgm', markets: [] },
      ],
    },
    iso(NOW),
  );
  assert.deepEqual(compact.books, {
    fanduel: {
      player_reception_yds: { 'Travis Kelce': [54.5, -115, -105] },
      player_anytime_td: { 'Travis Kelce': [null, 150, -200] },
    },
  });
  assert.equal(compact.fetched_at, iso(NOW));
});

test('a new listing keeps lines already held and drops vanished games', () => {
  const held = payloadWith({ keep: { ...event(60, 1), books: { fanduel: {} } }, gone: event(60) });
  const merged = mergeListing(
    held,
    [
      { id: 'keep', commence_time: iso(NOW + 45 * MIN), home_team: 'A', away_team: 'B' },
      { id: 'new', commence_time: iso(NOW + 300 * MIN), home_team: 'C', away_team: 'D' },
    ],
    NOW,
  );
  assert.deepEqual(Object.keys(merged).sort(), ['keep', 'new']);
  assert.ok(merged.keep!.books.fanduel, 'lines survive a re-list');
  assert.equal(merged.keep!.commence, iso(NOW + 45 * MIN), 'kickoff moves with the listing');
  assert.equal(merged.new!.fetched_at, null);
});

// --------------------------------------------------------------------------
// The tick, end to end, against fakes

function fakeKV(initial?: OddsPayload) {
  const store = new Map<string, string>();
  if (initial) store.set(ODDS_KEY, JSON.stringify(initial));
  let puts = 0;
  const kv = {
    async get(key: string, type?: string) {
      const value = store.get(key) ?? null;
      return value !== null && type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      puts += 1;
      store.set(key, value);
    },
  };
  return {
    kv: kv as unknown as KVNamespace,
    read: () => JSON.parse(store.get(ODDS_KEY)!) as OddsPayload,
    puts: () => puts,
  };
}

function fakeApi(handler: (url: URL) => { status?: number; body: unknown; remaining?: number }) {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const { status = 200, body, remaining = 400 } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'x-requests-remaining': String(remaining) },
    });
  }) as typeof fetch;
  return calls;
}

const listing = [
  { id: 'soon', commence_time: iso(NOW + 60 * MIN), home_team: 'Kansas City Chiefs', away_team: 'Denver Broncos' },
  { id: 'later', commence_time: iso(NOW + 400 * MIN), home_team: 'Buffalo Bills', away_team: 'Miami Dolphins' },
];

test('a tick lists events, fetches only what is due, and writes once', async () => {
  const kv = fakeKV();
  const calls = fakeApi((url) =>
    url.pathname.endsWith('/events')
      ? { body: listing, remaining: 400 }
      : { body: { ...listing[0], bookmakers: [] }, remaining: 393 },
  );
  const env = { MISMATCH_STORE: kv.kv, ODDS_API_KEY: 'k', ODDS_ENABLED: 'true' } as OddsEnv;

  const report = await pollOdds(env, NOW);
  assert.equal(report.listed, true);
  assert.deepEqual(report.fetched, ['soon']);
  assert.equal(kv.puts(), 1);
  assert.equal(kv.read().credits_remaining, 393);

  const oddsCall = calls.find((u) => u.pathname.endsWith('/odds'))!;
  assert.equal(oddsCall.searchParams.get('bookmakers'), 'fanduel,draftkings,espnbet,betmgm');
  assert.equal(oddsCall.searchParams.get('markets'), ODDS_MARKETS.join(','));
  assert.equal(oddsCall.searchParams.get('oddsFormat'), 'american');

  // Five minutes later: nothing is due, the listing is fresh, so no write.
  const again = await pollOdds(env, NOW + 5 * MIN);
  assert.deepEqual(again.fetched, []);
  assert.equal(again.wrote, false);
  assert.equal(kv.puts(), 1);
});

test('a bad key is recorded once, not written every tick', async () => {
  const kv = fakeKV();
  fakeApi(() => ({ status: 401, body: { message: 'invalid key' } }));
  const env = { MISMATCH_STORE: kv.kv, ODDS_API_KEY: 'bad', ODDS_ENABLED: 'true' } as OddsEnv;

  await pollOdds(env, NOW);
  assert.match(kv.read().last_error ?? '', /HTTP 401/);
  assert.doesNotMatch(kv.read().last_error ?? '', /apiKey|bad/, 'the key never lands in state');
  await pollOdds(env, NOW + 5 * MIN);
  assert.equal(kv.puts(), 1);
});

test('off, or without a key, it spends nothing', async () => {
  const calls = fakeApi(() => ({ body: [] }));
  const kv = fakeKV();
  const off = await pollOdds({ MISMATCH_STORE: kv.kv, ODDS_API_KEY: 'k' } as OddsEnv, NOW);
  const keyless = await pollOdds({ MISMATCH_STORE: kv.kv, ODDS_ENABLED: 'true' } as OddsEnv, NOW);
  assert.ok(off.skipped && keyless.skipped);
  assert.equal(calls.length, 0);
});

// --------------------------------------------------------------------------

async function main(): Promise<void> {
  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures ? 1 : 0);
}

void main();
