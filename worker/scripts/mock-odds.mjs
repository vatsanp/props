#!/usr/bin/env node
/**
 * A stand-in for The Odds API, so the odds poller can be run end to end
 * without spending a credit.
 *
 *   node worker/scripts/mock-odds.mjs        (`make worker` starts it on :8112)
 *
 * It invents this week's events from data/v1/props.json: one per game that
 * has cards, at the cards' real kickoff (or 45, 65, 85... minutes from now for
 * a game already played, so stale local data still yields something). The app
 * only matches a game within two days of its kickoff, so real times matter;
 * `make worker` widens ODDS_NEAR_WINDOW_MIN to a week so they are all fetched.
 * Lines sit near each card's
 * projection and differ a little by book; names are occasionally spelled the
 * way books spell them ("AJ Brown" for "A.J. Brown") so on-device matching is
 * exercised too. Deterministic per player, so a re-fetch is stable.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 8112);

const teams = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, 'pipeline/props/data/teams.json'), 'utf8')).teams.map(
    (t) => [t.id, `${t.location} ${t.nickname}`],
  ),
);
const markets = readFileSync(join(ROOT, 'app/src/domain/markets.ts'), 'utf8');
const oddsMarketOf = Object.fromEntries(
  [...markets.matchAll(/"id": "(\w+)",[\s\S]*?"oddsMarket": "(\w+)"/g)].map((m) => [m[1], m[2]]),
);

let credits = 500;

/** A stable number in [0, 1) from a string. */
function noise(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Books hang lines on the half, so there is no push. */
const half = (x) => Math.max(0.5, Math.floor(x) + 0.5);
const american = (p) => (p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100));

function events() {
  const props = JSON.parse(readFileSync(join(ROOT, 'data/v1/props.json'), 'utf8'));
  const games = new Map();
  for (const card of props.recommendations) {
    if (!games.has(card.game_id)) games.set(card.game_id, []);
    games.get(card.game_id).push(card);
  }
  const start = Math.ceil(Date.now() / 60000) * 60000;
  return [...games.entries()].map(([gameId, cards], i) => {
    const [, , away, home] = gameId.split('_');
    const real = cards[0].kickoff ? Date.parse(cards[0].kickoff) : NaN;
    const kickoff = real > Date.now() ? real : start + (45 + i * 20) * 60000;
    return {
      id: `mock${gameId.replace(/_/g, '')}`,
      sport_key: 'americanfootball_nfl',
      commence_time: new Date(kickoff).toISOString().replace('.000', ''),
      home_team: teams[home] ?? home,
      away_team: teams[away] ?? away,
      cards,
    };
  });
}

function bookName(name, book) {
  // One book in three drops the periods, as several do.
  return noise(book + name) < 0.33 ? name.replace(/\./g, '') : name;
}

function eventOdds(event, books) {
  const bookmakers = books.map((book) => {
    const byMarket = {};
    for (const card of event.cards) {
      const key = oddsMarketOf[card.market];
      if (!key) continue;
      const name = bookName(card.player.name, book);
      const r = noise(card.id);
      const outcomes = (byMarket[key] ??= new Map());
      if (outcomes.has(name)) continue;
      if (key === 'player_anytime_td') {
        const p = Math.min(0.85, Math.max(0.08, (card.td_prob ?? 0.3) * (0.8 + 0.4 * r)));
        outcomes.set(name, [
          { name: 'Yes', description: name, price: american(p + 0.03) },
          { name: 'No', description: name, price: american(1 - p + 0.03) },
        ]);
      } else {
        const base = (card.projection ?? card.player.per_game) * (0.85 + 0.3 * r);
        const point = half(base + (noise(book + card.id) - 0.5) * 2);
        const juice = Math.round(-130 + 40 * noise(book + name + key));
        outcomes.set(name, [
          { name: 'Over', description: name, price: juice, point },
          { name: 'Under', description: name, price: -220 - juice, point },
        ]);
      }
    }
    return {
      key: book,
      title: book,
      last_update: new Date().toISOString(),
      markets: Object.entries(byMarket).map(([key, outcomes]) => ({
        key,
        last_update: new Date().toISOString(),
        outcomes: [...outcomes.values()].flat(),
      })),
    };
  });
  return { bookmakers, cost: new Set(bookmakers.flatMap((b) => b.markets.map((m) => m.key))).size };
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'x-requests-remaining': String(credits),
    });
    res.end(JSON.stringify(body));
  };
  if (!url.searchParams.get('apiKey')) return send(401, { message: 'missing apiKey' });

  const list = url.pathname.match(/^\/v4\/sports\/americanfootball_nfl\/events$/);
  const one = url.pathname.match(/^\/v4\/sports\/americanfootball_nfl\/events\/([^/]+)\/odds$/);
  if (list) {
    console.log(`mock-odds: events (free)`);
    return send(200, events().map(({ cards, ...event }) => event));
  }
  if (one) {
    const event = events().find((e) => e.id === one[1]);
    if (!event) return send(404, { message: 'event not found' });
    const books = (url.searchParams.get('bookmakers') ?? 'fanduel').split(',');
    const { bookmakers, cost } = eventOdds(event, books);
    credits -= cost;
    console.log(`mock-odds: ${event.away_team} @ ${event.home_team}, ${cost} credits, ${credits} left`);
    const { cards, ...rest } = event;
    return send(200, { ...rest, bookmakers });
  }
  send(404, { message: `no route ${url.pathname}` });
}).listen(PORT, () => console.log(`mock-odds on http://localhost:${PORT}`));
