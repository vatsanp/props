# Props

NFL matchup edges and player prop leads, as a phone app.

Two questions, answered from public data:

1. **Where is this week's game lopsided?** For each of 20 team stats, one side's
   unit is compared against the other side's mirror unit, and the matchup is
   surfaced only when one is top-10 and the other bottom-12.
2. **Which player should I be looking at?** When a defense is among the league's
   most generous against a position, the app names the offense's primary player
   at that position and shows the evidence.

> Cincinnati allows 84.9 receiving yards per game to tight ends (32nd of 32).
> Trey McBride: 72.9 yds per game, 28% target share.

No betting lines are involved. The app tells you where to look and why; the
number you have to beat is still the one in your sportsbook.

## How it fits together

```
teamrankings.com  ─┐
nflverse games.csv ├─► Python pipeline ─► data/v1/*.json ─► git ─┐
nflverse players   ┘     (GitHub Actions)                        │
                                                                 ▼
                              Expo app ◄── KV ◄── Cloudflare Worker
                                                    (hourly cron)
```

There is no database, and nothing is computed at request time. The pipeline
commits static JSON; a Worker mirrors it into KV and serves it from the edge;
the app reads it and caches it for offline use. Matchup edges are calculated
on the phone, not on a server, because the thresholds are user settings.

| Path | What it is |
|---|---|
| `pipeline/props/` | the pipeline: scraping, transforms, the recommender, the CLI |
| `pipeline/tests/` | 1188 tests, including golden parity against the original script |
| `data/v1/` | generated payloads, committed and served to the app |
| `worker/` | the Cloudflare Worker that serves those payloads from KV |
| `app/` | the Expo app: Props, This Week, Compare, Teams, plus matchup and team screens |
| `archive/csv/` | the original CSV archives, 2024-2026 |

## Using it from the terminal

```sh
python -m props show KC DAL        # the matchup table this project started as
python -m props picks --limit 10   # this week's prop leads
python -m props week               # the schedule
python -m props h2h LV KC          # all-time record, era-aware
python -m props build --out data/v1
python -m props validate data/v1
```

## Running the app

Install **Expo Go** on the phone (App Store / Play Store), put the phone on the
same wifi as the laptop, then:

```sh
make phone
```

That serves `data/` and starts Metro with the app pointed at this machine.
Scan the QR code with the iPhone Camera app, or from inside Expo Go on Android.

That is the development loop, and it needs the phone on the same wifi.

Once the Worker is deployed, the data no longer comes from this machine, and
the wifi requirement goes with it:

```sh
make worker-deploy   # once: see worker/README.md
make anywhere        # Metro over a tunnel, data from Cloudflare
```

`make anywhere` works on cellular, in another building. The laptop still has to
be awake, because **Expo Go loads the JavaScript from Metro** and there is no
free way around that on an iPhone:

- EAS Update cannot help. `expo-updates` requires a `runtimeVersion`, and
  ["updates published with the `runtimeVersion` field can't be loaded in Expo
  Go"](https://docs.expo.dev/build/updates/).
- A development build drops Metro, but free Apple provisioning expires after
  seven days.
- TestFlight is permanent and needs the $99/yr Apple Developer Program.

Every dependency here is Expo Go compatible, so keep it that way. On Android
none of this applies: `eas build --profile preview` produces a free APK that
installs permanently and needs nothing running.

### First time: publish the data

Everything downstream reads from GitHub, so the repo has to be pushed and
public before the Worker has anything to mirror:

```sh
git remote add origin https://github.com/<github-user>/props.git
git push -u origin main
```

Then the workflows in `.github/workflows/` start running on their schedules and
commit fresh payloads to `data/v1/`. Replace `<github-user>` in
`worker/wrangler.jsonc` (`ORIGIN_BASE`) and in `app/src/api/client.ts`
(`FALLBACK_BASE`) with the same account.

### Where the app looks for data

In order: `EXPO_PUBLIC_DATA_BASE` (what `make phone` sets), then
`extra.dataBase` in `app.json` (the Worker), then the GitHub raw URL compiled
into `src/api/client.ts`. A URL still containing an unreplaced `<placeholder>`
is skipped, so a half-finished setup falls through to the next source instead
of failing every request.

`make anywhere` sets none of them, so it uses `extra.dataBase` — which is why
that has to hold the real Worker URL before the phone will see live data.

## Development

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -e "./pipeline[dev]"

cd pipeline && python -m pytest -q        # pipeline tests
cd app && npm run typecheck && npm test   # app typecheck and rule parity
cd app && npm run test:payloads           # data/v1 parses against the app schemas
cd app && npm run test:detail             # every prop's detail screen resolves its data

make worker                               # the worker against local data, on :8787
make worker-check                         # and what it serves parses too
```

`test:payloads` proves the pipeline writes what the app expects; `worker-check`
proves the thing *serving* those payloads hands them over intact, with the CORS
and cache headers the app relies on.

The team list, stat definitions and market list live in Python and are
generated into TypeScript:

```sh
python -m props codegen --ts app/src/domain
```

`pipeline/tools/gen_teams.py` regenerates `teams.json` from ESPN and
TeamRankings when a team relocates or rebrands.

## Things worth knowing before changing anything

- **`softness_rank` 1 means a defense allows the *most*.** TeamRankings' rank 1
  means the opposite — best. Mixing them up inverts every recommendation, so the
  two are deliberately never called the same thing.
- **The mismatch rule iterates all 20 stats and keeps all 20.** "Passing Yards
  Per Game" compares team 1's offense to team 2's defense; the mirror compares
  team 1's defense to team 2's offense. Those are different matchups. Do not
  deduplicate them.
- **`--` cells carry `data-sort="0"`.** On TeamRankings a team with no home game
  yet renders `--` in the Home column, and the sort attribute says `0`. The text
  has to be checked first, or "hasn't played at home" becomes "scored zero".
- **Season columns rename themselves every year.** The header is literally
  `2026`. It is parsed, never assumed, which is what retired the annual
  hand-edit.
- **Defense-vs-position is blended with last season** by games played, because
  one September game moves a defense twenty ranks. Player usage is *not*
  blended: a player may have changed teams or lost his job, and last year's
  target share would point at the wrong man.
- **Head-to-head applies franchise continuity.** Oakland-era Raiders games count
  toward LV, with the era split reported separately. History starts in 1999,
  which is where nflverse starts, and the UI says so.

## Data sources

- [TeamRankings](https://www.teamrankings.com/nfl/) — the 20 team stat tables.
- [nflverse](https://github.com/nflverse) — game results and schedule
  (`nfldata/games.csv`), weekly player stats, injury reports. CC-BY 4.0.
- [ESPN](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) —
  team metadata, and live scores if that gets wired up.

Personal project, a handful of requests a day, identifying User-Agent, no ads,
no claim of ownership over any of this data.

## Prior art

The original scraper was a vendored copy of
[TeamRankingsWebScraper](https://github.com/tymiguel/TeamRankingsWebScraper) by
Tyler Miguel (MIT). It has been replaced by `pipeline/props/sources/teamrankings.py`.
