/**
 * Matching sportsbook lines to the app's prop cards.
 *
 * The Worker passes The Odds API's data through nearly raw: games are named by
 * full team name ("Kansas City Chiefs") and players as each book spells them.
 * Matching happens here, on-device, where the team table already lives and the
 * Worker's 10 ms CPU budget is not at stake.
 *
 * Pure -- no React, no network -- so odds.test.ts runs it under plain tsx.
 */

import type { Odds, OddsEvent, Quote, Recommendation } from '../api/schemas';
import { MARKETS } from './markets';
import { TEAMS } from './teams';

/** Display names for the Odds API bookmaker keys the Worker may request. */
export const BOOK_NAMES: Record<string, string> = {
  fanduel: 'FanDuel',
  draftkings: 'DraftKings',
  espnbet: 'theScore Bet',
  betmgm: 'BetMGM',
  fanatics: 'Fanatics',
  williamhill_us: 'Caesars',
  betrivers: 'BetRivers',
  hardrockbet: 'Hard Rock',
};

export const bookName = (key: string): string => BOOK_NAMES[key] ?? key;

export interface BookLine {
  book: string;
  /** Null for anytime TD, which is priced yes/no rather than over/under. */
  line: number | null;
  over: number | null;
  under: number | null;
}

export interface Lines {
  oddsMarket: string;
  isTd: boolean;
  books: BookLine[];
  /** Median line across books. Null for anytime TD. */
  consensus: number | null;
  /** Anytime TD: the books' average no-vig probability of a touchdown. */
  impliedYes: number | null;
  /** Over: the lowest line, then the best price. TD: the best yes price. */
  best: BookLine | null;
  fetchedAt: string | null;
}

// --------------------------------------------------------------------------
// Names

const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)$/;

/** "A.J. Brown" and "AJ Brown", "Amon-Ra St. Brown" and "Amon-Ra St Brown". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[-_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SUFFIX, '');
}

/**
 * The quote for `player` in one book's market. Exact (normalized) first; then
 * the same surname and first initial, but only if exactly one player fits --
 * "Josh Downs" must never pick up "Jalen Downs" when both are listed.
 */
export function findQuote(
  market: Record<string, Quote> | undefined,
  player: string,
): Quote | null {
  if (!market) return null;
  const wanted = normalizeName(player);
  const entries = Object.entries(market).map(([name, quote]) => [normalizeName(name), quote] as const);
  const exact = entries.find(([name]) => name === wanted);
  if (exact) return exact[1];

  const parts = wanted.split(' ');
  const last = parts.slice(1).join(' ');
  const initial = parts[0]?.[0];
  if (!last || !initial) return null;
  const loose = entries.filter(([name]) => {
    const p = name.split(' ');
    return p.slice(1).join(' ') === last && p[0]?.[0] === initial;
  });
  return loose.length === 1 ? loose[0]![1] : null;
}

// --------------------------------------------------------------------------
// Games

const TEAM_BY_NAME = new Map(
  Object.values(TEAMS).map((team) => [team.name.toLowerCase(), team.id]),
);

export function teamIdFromName(name: string): string | undefined {
  return TEAM_BY_NAME.get(name.toLowerCase());
}

/** Two days covers a flexed kickoff without reaching next week's rematch. */
const KICKOFF_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;

export function findEvent(odds: Odds, card: Recommendation): OddsEvent | null {
  const teams = new Set([card.player.team, card.defense.team]);
  const kickoff = card.kickoff ? Date.parse(card.kickoff) : null;
  for (const event of Object.values(odds.events)) {
    const home = teamIdFromName(event.home);
    const away = teamIdFromName(event.away);
    if (!home || !away || !teams.has(home) || !teams.has(away) || home === away) continue;
    if (kickoff !== null && Math.abs(Date.parse(event.commence) - kickoff) > KICKOFF_TOLERANCE_MS) {
      continue;
    }
    return event;
  }
  return null;
}

// --------------------------------------------------------------------------
// Prices

/** -150 -> 0.6, +150 -> 0.4. */
export function americanToProb(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

export function formatAmerican(price: number | null): string {
  if (price === null) return '—';
  return price > 0 ? `+${price}` : `${price}`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** P(yes) with the book's margin removed when both sides are posted. */
function noVigYes(yes: number, no: number | null): number {
  const pYes = americanToProb(yes);
  if (no === null) return pYes;
  const pNo = americanToProb(no);
  return pYes / (pYes + pNo);
}

/**
 * Every book's line for this card, plus the consensus. Null when there is no
 * matching game, the game has started (pregame lines only), or no book quotes
 * this player in this market.
 */
export function linesFor(
  card: Recommendation,
  odds: Odds | undefined | null,
  now: number = Date.now(),
): Lines | null {
  if (!odds) return null;
  const oddsMarket = MARKETS[card.market]?.oddsMarket;
  if (!oddsMarket) return null;
  const event = findEvent(odds, card);
  if (!event || !(Date.parse(event.commence) > now)) return null;

  const isTd = oddsMarket === 'player_anytime_td';
  const books: BookLine[] = [];
  for (const book of odds.books.length ? odds.books : Object.keys(event.books)) {
    const quote = findQuote(event.books[book]?.[oddsMarket], card.player.name);
    if (!quote) continue;
    const [line, over, under] = quote;
    if (isTd ? over === null : line === null) continue;
    books.push({ book, line: isTd ? null : line, over, under });
  }
  if (!books.length) return null;

  let best: BookLine | null = null;
  for (const b of books) {
    if (!best) {
      best = b;
      continue;
    }
    if (isTd) {
      if ((b.over ?? -Infinity) > (best.over ?? -Infinity)) best = b;
    } else if (
      b.line! < best.line! ||
      (b.line === best.line && (b.over ?? -Infinity) > (best.over ?? -Infinity))
    ) {
      best = b;
    }
  }

  const yes = isTd ? books.map((b) => noVigYes(b.over!, b.under)) : [];
  return {
    oddsMarket,
    isTd,
    books,
    consensus: isTd ? null : median(books.map((b) => b.line!)),
    impliedYes: yes.length ? yes.reduce((a, b) => a + b, 0) / yes.length : null,
    best,
    fetchedAt: event.fetched_at,
  };
}

/** "4m ago", for the freshness note under the lines. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
