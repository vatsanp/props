# props-data

The read path for the app. GitHub Actions builds and commits `data/v1/`; this
Worker mirrors it into Cloudflare KV once an hour and serves it from the edge
with CORS, ETags and cache headers.

```
Python pipeline ─► git ─► raw.githubusercontent.com ─► Worker cron ─► KV ─► app
   (Actions)                     (origin)              (hourly)      (edge)
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

KV writes are capped at 1,000/day on the free plan. A steady hour writes
**nothing**: every file is gated on the content hash the pipeline publishes in
`manifest.json`, and the manifest itself is gated on its `generated_at`.

## Endpoints

| Path | What |
|---|---|
| `/` | status: origin, how many payloads are held, when the manifest last synced |
| `/v1/manifest.json` | the manifest, always `no-store` |
| `/v1/stats.json` etc. | the payloads, `max-age=300` with an ETag |
| `/v1/h2h/<TEAM>.json` | per-team head-to-head, lazily cached |

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

# 5. Fill KV now rather than waiting for the top of the hour. A KV miss falls
#    through to origin and backfills, so one request per file is enough.
#    (/__scheduled only exists under `wrangler dev --test-scheduled`.)
curl -s https://props-data.<your-subdomain>.workers.dev/v1/manifest.json

# 6. Watch the first real cron run
npx wrangler tail
```

There is **no `wrangler secret put`**. This project has no API key: the pipeline
scrapes TeamRankings and reads public nflverse CSVs, and the Worker only reads
public GitHub content. Nothing here is secret.

Then point the app at it — `extra.dataBase` in `app/app.json`:

```json
"dataBase": "https://props-data.<your-subdomain>.workers.dev/v1"
```

## Developing

```sh
make worker        # from the repo root: serves data/ as origin, worker on :8787
make worker-check  # typecheck, then validate what it serves against app schemas
```

`make worker` points `ORIGIN_BASE` at a local `http.server` over `data/`, so you
can test without anything being published. Useful routes while it runs:

```sh
curl localhost:8787/                      # what is in KV
curl localhost:8787/__scheduled           # force a sync
curl -sI localhost:8787/v1/props.json     # headers, ETag, cache-control
```
