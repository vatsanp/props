# props-data

The read path for the app. GitHub Actions builds and commits `data/v1/`; this
Worker mirrors it into Cloudflare KV every 15 minutes and serves it from the edge
with CORS, ETags and cache headers.

```
Python pipeline ─► git ─► raw.githubusercontent.com ─► Worker cron ─► KV ─► app
   (Actions)                     (origin)             (every 15 min)  (edge)
```

It computes nothing. Team matchup edges are calculated on-device in
`app/src/domain/mismatch.ts`, because the elite/weak thresholds are settings the
user changes live — precomputing them would break the Compare screen.

## Why it only copies bytes

The Workers free plan allows **10 ms of CPU per invocation, cron triggers
included**. One real refresh parses 6.6 MB of HTML and ~11 MB of CSV, which is
orders of magnitude over that. Running the pipeline here is not possible for
free, so the Worker does the one job that is nearly free: moving bytes.

## The subrequest budget

Free plan: **50 subrequests per invocation**, and KV `get`, `put` and `list`
each count as one alongside every `fetch`. That shapes the design.

| Invocation | Subrequests |
|---|---|
| Cron, nothing changed | 2 (1 list + 1 manifest fetch) |
| Cron, full cold sync | ~17 (1 list + 1 + 7 fetches + 7 puts + 1 put) |
| Serving a payload | 1, or 3 on a KV miss |
| Serving `h2h/<TEAM>.json` | 2, or 4 on a miss |

The 32 `h2h/<TEAM>.json` files are deliberately **not** part of the cron sync —
copying them would add 64 subrequests and blow the limit. They are fetched from
origin on first request and cached under a key carrying `h2h.json`'s content
hash, so a new build supersedes them with no invalidation pass. The app only
asks for one when a matchup is opened.

KV writes are capped at 1,000/day on the free plan. A sync with nothing new writes
**nothing**: every file is gated on the content hash the pipeline publishes in
`manifest.json`, and the manifest itself is gated on its `generated_at`.

## Endpoints

| Path | What |
|---|---|
| `/` | status: origin, how many payloads are held, when the manifest last synced |
| `/v1/manifest.json` | the manifest, always `no-store` |
| `/v1/stats.json` etc. | the payloads, `max-age=300` with an ETag |
| `/v1/h2h/<TEAM>.json` | per-team head-to-head, lazily cached |
| `/v1/odds.json` | sportsbook lines, polled from The Odds API, `max-age=30` with an ETag |

The URL layout mirrors `data/v1/` exactly, so the app only ever changes its base
URL. There is no `/api/mismatches`: edges are not computed server-side.

## Deploying

The pipeline has to be publishing to GitHub first — the Worker reads from there.

```sh
# 1. Log in (opens a browser)
npx wrangler login

# 2. Create the KV namespace, then paste the printed id into wrangler.jsonc
npx wrangler kv namespace create MISMATCH_STORE

# 3. Set ORIGIN_BASE in wrangler.jsonc to your published data URL:
#    https://raw.githubusercontent.com/<github-user>/props/main/data/v1

# 4. Ship it
npx wrangler deploy

# 5. Fill KV now rather than waiting for the next sync (up to 15 minutes). A KV miss falls
#    through to origin and backfills, so one request per file is enough.
#    (/__scheduled only exists under `wrangler dev --test-scheduled`.)
curl -s https://props-data.<your-subdomain>.workers.dev/v1/manifest.json

# 6. Watch the first real cron run
npx wrangler tail
```

There is **one secret**: the Odds API key for sportsbook lines (below). The
pipeline itself needs no key; it scrapes TeamRankings and reads public nflverse
CSVs.

```sh
npx wrangler secret put ODDS_API_KEY     # free key at the-odds-api.com
```

Without it the Worker still serves everything else; `/v1/odds.json` stays empty
and the app shows no lines.

Then point the app at it — `extra.dataBase` in `app/app.json`:

```json
"dataBase": "https://props-data.<your-subdomain>.workers.dev/v1"
```

## Sportsbook lines

`/v1/odds.json` is the one payload this Worker builds itself. A second cron
(`*/5 * * * *`) runs `pollOdds()` in `src/odds.ts`:

1. Every 6 hours, re-read The Odds API's event list. **Free:** it costs no credits.
2. Work out which games are *due* (see the vars below) and fetch up to
   `ODDS_EVENTS_PER_TICK` of them: `/v4/sports/americanfootball_nfl/events/{id}/odds`
   for the 7 markets in `ODDS_MARKETS` (generated from `pipeline/props/markets.py`)
   and the books in `ODDS_BOOKS`.
3. Reshape the results to `[line, over, under]` per book, market and player.
   Drop games that have kicked off: lines are pregame only.
4. Write the whole set back to the single KV key `odds/current`. The write only
   happens if something changed. An unchanged error is never rewritten, so a bad
   key costs no writes.

**Credits.** One refresh of one game costs about 7 credits: unique markets
returned × 1 region, since every 10 books bill as one region. A response with no
data costs nothing. `x-requests-remaining` is stored with every write and shown
at `/`.

| Var | Default (free tier) | $30 (20K) | $59 (100K) |
|---|---|---|---|
| `ODDS_FAR_MIN` | `0` (never) | `180` | `60` |
| `ODDS_NEAR_WINDOW_MIN` | `90` | `120` | `180` |
| `ODDS_NEAR_MIN` | `0` (once, on entry) | `20` | `5` |
| `ODDS_CREDIT_RESERVE` | `0` | `500` | `2000` |
| `ODDS_EVENTS_PER_TICK` | `3` | `3` | `3`, or more on Workers Paid |

On the defaults, each game is fetched once, when it enters the 90 minutes before
kickoff. That is about 16 games × 7 = 112 credits a week, inside 500 a month.
Below `ODDS_CREDIT_RESERVE`, only games inside the window are fetched. With less
than one refresh left, nothing is fetched.

**Books.** `fanduel,draftkings,espnbet,betmgm`. `espnbet` is theScore Bet,
formerly ESPN BET. Bet365 has no US coverage on The Odds API, and PointsBet US
was delisted after Fanatics bought it. `fanatics` and `williamhill_us` (Caesars)
need a paid plan, so add them to `ODDS_BOOKS` after upgrading.

**Why every 5 minutes, not every minute.** KV can take ~60 s to show a write in
every location. A faster tick could read the previous state and pay for the same
game twice.

**Free-plan limits.** One tick costs 1 KV get, at most 1 events fetch,
`ODDS_EVENTS_PER_TICK` odds fetches and at most 1 put. CPU is the tight one
(10 ms): parsing a props response is the cost. After the first real poll, check
`npx wrangler tail` and lower `ODDS_EVENTS_PER_TICK` if a tick goes over.

Locally, `make worker` runs `scripts/mock-odds.mjs` in place of the real API, so
nothing costs credits. It also widens the window to a week, so every game with
cards gets lines:

```sh
curl localhost:8787/__scheduled          # one sync + one odds tick
curl localhost:8787/v1/odds.json
```

The app reads odds only from the Worker: `extra.dataBase` in `app.json`, or
`EXPO_PUBLIC_ODDS_BASE=http://<lan-ip>:8787/v1` alongside `make phone`.

## Developing

```sh
make worker        # from the repo root: serves data/ as origin, worker on :8787
make worker-check  # typecheck, then validate what it serves against app schemas
npm test           # (in worker/) the odds poller's scheduling and credit guard
```

`make worker` points `ORIGIN_BASE` at a local `http.server` over `data/`, so you
can test without anything being published. Useful routes while it runs:

```sh
curl localhost:8787/                      # what is in KV
curl localhost:8787/__scheduled           # force a sync
curl -sI localhost:8787/v1/props.json     # headers, ETag, cache-control
```
