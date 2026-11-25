/**
 * Sportsbook player-prop lines, polled from The Odds API on a cron and served
 * as one payload at /v1/odds.json.
 *
 * Lines move every few minutes, so they cannot ride the pipeline -> git -> KV
 * path the rest of the data takes. Instead a cron here asks The Odds API for
 * the events that are *due*, reshapes each response into a compact form, and
 * writes the whole set back as a single KV value.
 *
 * ## Credits, not requests, are the budget
 *
 * The /events listing is free. Each event's props cost
 * `unique markets returned x regions`, and every 10 bookmakers count as one
 * region, so one refresh of one game is about 7 credits. Which events are due
 * is therefore entirely driven by config (see `OddsConfig`), so moving from
 * the free tier to a paid one is a change of vars, not code. A credit guard
 * stops polling before the quota runs dry.
 *
 * ## The free-plan limits this is shaped around
 *
 *   - 10 ms CPU per invocation: JSON.parse of a props response is the cost, so
 *     at most `ODDS_EVENTS_PER_TICK` events are fetched per tick.
 *   - 1,000 KV writes a day: state *is* the payload, one key, written only when
 *     something was fetched or changed.
 *   - KV is eventually consistent (~60 s). The cron runs every 5 minutes, so a
 *     tick always sees the previous tick's write and never pays twice for the
 *     same event.
 */

import { ODDS_MARKETS } from '../../app/src/domain/markets';

export interface OddsEnv {
  MISMATCH_STORE: KVNamespace;
  /** `wrangler secret put ODDS_API_KEY`. Polling is off without it. */
  ODDS_API_KEY?: string;
  /** Overridden by `make worker` to point at scripts/mock-odds.mjs. */
  ODDS_API_BASE?: string;
  ODDS_ENABLED?: string;
  ODDS_BOOKS?: string;
  ODDS_FAR_MIN?: string;
  ODDS_NEAR_MIN?: string;
  ODDS_NEAR_WINDOW_MIN?: string;
  ODDS_EVENTS_PER_TICK?: string;
  ODDS_CREDIT_RESERVE?: string;
}

export interface OddsConfig {
  enabled: boolean;
  books: string[];
  /** Refresh interval far from kickoff, minutes. 0 = never. */
  farMin: number;
  /** Refresh interval inside the near window, minutes. 0 = once, on entry. */
  nearMin: number;
  /** How long before kickoff the near window opens, minutes. */
  nearWindowMin: number;
  eventsPerTick: number;
  /** Below this many credits, only near-window fetches go ahead. */
  creditReserve: number;
}

/** [line, over price, under price]. Anytime TD: [null, yes price, no price]. */
export type Quote = [number | null, number | null, number | null];

export interface OddsEvent {
  home: string;
  away: string;
  commence: string;
  /** When this event's props were last fetched. Null until the first fetch. */
  fetched_at: string | null;
  /** book -> market -> player name (as the book spells it) -> quote */
  books: Record<string, Record<string, Record<string, Quote>>>;
}

export interface OddsPayload {
  schema_version: 1;
  /** Last time anything in this payload changed. Also the ETag. */
  updated_at: string | null;
  events_listed_at: string | null;
  credits_remaining: number | null;
  last_error: string | null;
  books: string[];
  events: Record<string, OddsEvent>;
}

export interface PollReport {
  skipped?: string;
  listed: boolean;
  fetched: string[];
  failed: string[];
  wrote: boolean;
  credits: number | null;
}

export const ODDS_KEY = 'odds/current';
const SPORT = 'americanfootball_nfl';
const DEFAULT_API_BASE = 'https://api.the-odds-api.com';
/** The free events listing is re-read this often, to pick up flexed games. */
const LIST_EVERY_MS = 6 * 60 * 60 * 1000;
/** Only this week's games: a line a week out is not worth the credits. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * Free-tier-safe defaults: every game fetched exactly once, when it enters the
 * 90-minute window before kickoff. ~16 games x 7 credits a week fits in 500 a
 * month. Bet365 has no US coverage and PointsBet US is delisted; Fanatics is
 * paid-plan only, so add it to ODDS_BOOKS after upgrading.
 */
const DEFAULTS = {
  books: 'fanduel,draftkings,espnbet,betmgm',
  farMin: 0,
  nearMin: 0,
  nearWindowMin: 90,
  eventsPerTick: 3,
  creditReserve: 0,
};

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function config(env: OddsEnv): OddsConfig {
  return {
    enabled: env.ODDS_ENABLED === 'true',
    books: (env.ODDS_BOOKS || DEFAULTS.books)
      .split(',')
      .map((book) => book.trim())
      .filter(Boolean),
    farMin: int(env.ODDS_FAR_MIN, DEFAULTS.farMin),
    nearMin: int(env.ODDS_NEAR_MIN, DEFAULTS.nearMin),
    nearWindowMin: int(env.ODDS_NEAR_WINDOW_MIN, DEFAULTS.nearWindowMin),
    eventsPerTick: Math.max(1, int(env.ODDS_EVENTS_PER_TICK, DEFAULTS.eventsPerTick)),
    creditReserve: int(env.ODDS_CREDIT_RESERVE, DEFAULTS.creditReserve),
  };
}

export function emptyPayload(books: string[] = []): OddsPayload {
  return {
    schema_version: 1,
    updated_at: null,
    events_listed_at: null,
    credits_remaining: null,
    last_error: null,
    books,
    events: {},
  };
}

/** What one refresh of one event costs: markets x (bookmakers / 10, rounded up). */
export function creditCost(cfg: OddsConfig): number {
  return ODDS_MARKETS.length * Math.max(1, Math.ceil(cfg.books.length / 10));
}

// --------------------------------------------------------------------------
// Scheduling: which events are due
// --------------------------------------------------------------------------

export interface Due {
  id: string;
  near: boolean;
}

export function isNear(event: OddsEvent, cfg: OddsConfig, now: number): boolean {
  return Date.parse(event.commence) - now <= cfg.nearWindowMin * MINUTE;
}

/**
 * Due events, nearest kickoff first.
 *
 * Inside the near window an event is due if it has never been fetched, was
 * last fetched before the window opened, or (with `nearMin` > 0) is older than
 * `nearMin`. Outside it, only when `farMin` > 0 and it is older than that.
 */
export function dueEvents(payload: OddsPayload, cfg: OddsConfig, now: number): Due[] {
  const due: Due[] = [];
  for (const [id, event] of Object.entries(payload.events)) {
    const kickoff = Date.parse(event.commence);
    if (!(kickoff > now) || kickoff - now > HORIZON_MS) continue;

    const fetched = event.fetched_at ? Date.parse(event.fetched_at) : null;
    const near = isNear(event, cfg, now);
    let isDue: boolean;
    if (near) {
      const windowOpened = kickoff - cfg.nearWindowMin * MINUTE;
      isDue =
        fetched === null ||
        fetched < windowOpened ||
        (cfg.nearMin > 0 && now - fetched >= cfg.nearMin * MINUTE);
    } else {
      isDue = cfg.farMin > 0 && (fetched === null || now - fetched >= cfg.farMin * MINUTE);
    }
    if (isDue) due.push({ id, near });
  }
  due.sort(
    (a, b) =>
      Date.parse(payload.events[a.id]!.commence) - Date.parse(payload.events[b.id]!.commence),
  );
  return due;
}

/**
 * Apply the credit guard and the per-tick cap. With credits below the reserve
 * only near-window events go ahead; with less than one refresh left, nothing.
 */
export function selectFetches(due: Due[], cfg: OddsConfig, credits: number | null): string[] {
  const cost = creditCost(cfg);
  let allowed = due;
  if (credits !== null) {
    if (credits < cost) return [];
    if (credits < cfg.creditReserve) allowed = due.filter((d) => d.near);
    allowed = allowed.slice(0, Math.floor(credits / cost));
  }
  return allowed.slice(0, cfg.eventsPerTick).map((d) => d.id);
}

// --------------------------------------------------------------------------
// Reshaping The Odds API responses
// --------------------------------------------------------------------------

interface ApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface ApiOutcome {
  name: string;
  description?: string;
  price?: number;
  point?: number;
}

interface ApiEventOdds extends ApiEvent {
  bookmakers?: {
    key: string;
    markets?: { key: string; outcomes?: ApiOutcome[] }[];
  }[];
}

/** Over/Yes fill slot 1, Under/No slot 2. The anytime-TD shape is not
 * documented, so both spellings are accepted. */
const SIDE: Record<string, 1 | 2> = { over: 1, yes: 1, under: 2, no: 2 };

export function compactEvent(api: ApiEventOdds, fetchedAt: string): OddsEvent {
  const books: OddsEvent['books'] = {};
  for (const bookmaker of api.bookmakers ?? []) {
    const markets: Record<string, Record<string, Quote>> = {};
    for (const market of bookmaker.markets ?? []) {
      const players: Record<string, Quote> = {};
      for (const outcome of market.outcomes ?? []) {
        const side = SIDE[outcome.name.toLowerCase()];
        const player = outcome.description;
        if (!side || !player) continue;
        const quote = (players[player] ??= [null, null, null]);
        quote[side] = outcome.price ?? null;
        // A book can post the over and under at different points for the same
        // player (alternate lines). Keep the over's point: it is the headline.
        if (typeof outcome.point === 'number' && (side === 1 || quote[0] === null)) {
          quote[0] = outcome.point;
        }
      }
      if (Object.keys(players).length) markets[market.key] = players;
    }
    if (Object.keys(markets).length) books[bookmaker.key] = markets;
  }
  return {
    home: api.home_team,
    away: api.away_team,
    commence: api.commence_time,
    fetched_at: fetchedAt,
    books,
  };
}

/**
 * Fold a fresh /events listing into the payload: new events appear unfetched,
 * moved kickoffs are updated, and events no longer listed (or out of the
 * horizon) are dropped. Lines already held are kept.
 */
export function mergeListing(
  payload: OddsPayload,
  listing: ApiEvent[],
  now: number,
): Record<string, OddsEvent> {
  const events: Record<string, OddsEvent> = {};
  for (const item of listing) {
    const kickoff = Date.parse(item.commence_time);
    if (!(kickoff > now) || kickoff - now > HORIZON_MS) continue;
    const held = payload.events[item.id];
    events[item.id] = {
      home: item.home_team,
      away: item.away_team,
      commence: item.commence_time,
      fetched_at: held?.fetched_at ?? null,
      books: held?.books ?? {},
    };
  }
  return events;
}

// --------------------------------------------------------------------------
// The tick
// --------------------------------------------------------------------------

class ApiError extends Error {}

async function api<T>(
  env: OddsEnv,
  path: string,
  params: Record<string, string>,
): Promise<{ body: T; remaining: number | null }> {
  const url = new URL(`${(env.ODDS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')}${path}`);
  url.searchParams.set('apiKey', env.ODDS_API_KEY ?? '');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  const header = response.headers.get('x-requests-remaining');
  const remaining = header !== null && header !== '' ? Number(header) : null;
  if (!response.ok) {
    // Never echo the URL: it carries the key.
    const detail = (await response.text()).slice(0, 200);
    throw new ApiError(`${path.split('/').slice(-1)[0]}: HTTP ${response.status} ${detail}`);
  }
  return { body: (await response.json()) as T, remaining: Number.isFinite(remaining) ? remaining : null };
}

function dropStarted(events: Record<string, OddsEvent>, now: number): boolean {
  let dropped = false;
  for (const [id, event] of Object.entries(events)) {
    if (!(Date.parse(event.commence) > now)) {
      delete events[id];
      dropped = true;
    }
  }
  return dropped;
}

export async function readOdds(env: OddsEnv): Promise<OddsPayload | null> {
  return env.MISMATCH_STORE.get<OddsPayload>(ODDS_KEY, 'json');
}

export async function pollOdds(env: OddsEnv, now = Date.now()): Promise<PollReport> {
  const cfg = config(env);
  const report: PollReport = { listed: false, fetched: [], failed: [], wrote: false, credits: null };
  if (!cfg.enabled) return { ...report, skipped: 'ODDS_ENABLED is not "true"' };
  if (!env.ODDS_API_KEY) return { ...report, skipped: 'no ODDS_API_KEY secret' };

  const payload = (await readOdds(env)) ?? emptyPayload(cfg.books);
  const before = payload.last_error;
  let changed = payload.books.join() !== cfg.books.join();
  payload.books = cfg.books;
  const stamp = new Date(now).toISOString();
  const errors: string[] = [];

  const listedAt = payload.events_listed_at ? Date.parse(payload.events_listed_at) : 0;
  if (now - listedAt >= LIST_EVERY_MS) {
    try {
      const { body, remaining } = await api<ApiEvent[]>(env, `/v4/sports/${SPORT}/events`, {});
      payload.events = mergeListing(payload, body, now);
      payload.events_listed_at = stamp;
      if (remaining !== null) payload.credits_remaining = remaining;
      report.listed = true;
      changed = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (dropStarted(payload.events, now)) changed = true;

  const ids = selectFetches(dueEvents(payload, cfg, now), cfg, payload.credits_remaining);
  for (const id of ids) {
    try {
      const { body, remaining } = await api<ApiEventOdds>(
        env,
        `/v4/sports/${SPORT}/events/${encodeURIComponent(id)}/odds`,
        {
          markets: ODDS_MARKETS.join(','),
          bookmakers: cfg.books.join(','),
          oddsFormat: 'american',
        },
      );
      payload.events[id] = compactEvent(body, stamp);
      if (remaining !== null) payload.credits_remaining = remaining;
      report.fetched.push(id);
      changed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed.push(`${id}: ${message}`);
      errors.push(message);
    }
  }

  // An error is only written when it differs from the last one: a bad key
  // would otherwise burn a KV write every tick.
  payload.last_error = errors.length ? errors.join('; ') : null;
  if (payload.last_error !== before) changed = true;

  if (changed) {
    payload.updated_at = stamp;
    await env.MISMATCH_STORE.put(ODDS_KEY, JSON.stringify(payload));
    report.wrote = true;
  }
  report.credits = payload.credits_remaining;
  return report;
}
