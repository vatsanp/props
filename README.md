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
nflverse games.csv ├─► Python pipeline ─► data/v1/*.json ─► git ─► CDN ─► Expo app
nflverse players   ┘     (GitHub Actions)
```

There is no server and no database. The pipeline commits static JSON; the app
reads it and caches it for offline use.

| Path | What it is |
|---|---|
| `pipeline/props/` | the pipeline: scraping, transforms, the recommender, the CLI |
| `pipeline/tests/` | 1188 tests, including golden parity against the original script |
| `data/v1/` | generated payloads, committed and served to the app |
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

```sh
cd app
npm install
npx expo start            # scan the QR code with Expo Go
```

To point it at a local build instead of the published data:

```sh
python -m http.server 8000 --directory data
EXPO_PUBLIC_DATA_BASE=http://<your-lan-ip>:8000/v1 npx expo start
```

Expo Go is the only permanently free way to run this on an iPhone — TestFlight
needs the $99/yr Apple Developer Program, and a free-provisioned development
build expires after seven days. Every dependency here is Expo Go compatible, so
keep it that way. On Android, `eas build --profile preview` produces a free APK
that installs permanently.

## Development

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -e "./pipeline[dev]"

cd pipeline && python -m pytest -q        # pipeline tests
cd app && npm run typecheck && npm test   # app typecheck and rule parity
cd app && npm run test:payloads           # data/v1 parses against the app schemas
```

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
