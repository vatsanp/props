/**
 * The app's schemas are written by hand and the payloads are written by the
 * Python pipeline, so nothing guarantees they agree except this check. It
 * parses whatever is currently in data/v1 with the real schemas.
 *
 *   npm run test:payloads
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  h2hSummarySchema,
  h2hTeamSchema,
  manifestSchema,
  propsSchema,
  recordsSchema,
  scheduleSchema,
  statsSchema,
} from '../schemas';
import { TEAM_IDS } from '../../domain/teams';

const DATA = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'v1');

const files: Array<[string, { safeParse: (value: unknown) => { success: boolean; error?: unknown } }]> = [
  ['manifest.json', manifestSchema],
  ['stats.json', statsSchema],
  ['schedule.json', scheduleSchema],
  ['records.json', recordsSchema],
  ['h2h.json', h2hSummarySchema],
  ['props.json', propsSchema],
];

let failures = 0;

for (const [name, schema] of files) {
  const path = join(DATA, name);
  if (!existsSync(path)) {
    console.error(`missing ${name} — run \`python -m props build --out data/v1\``);
    failures += 1;
    continue;
  }
  const result = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.success) {
    failures += 1;
    console.error(`${name} does not match its schema:`);
    console.error(JSON.stringify(result.error, null, 2).slice(0, 1200));
  } else {
    console.log(`  ok  ${name}`);
  }
}

// Every team's head-to-head file has to exist and parse; a missing one is a
// screen that fails only when someone opens that particular matchup.
for (const team of TEAM_IDS) {
  const path = join(DATA, 'h2h', `${team}.json`);
  if (!existsSync(path)) {
    console.error(`missing h2h/${team}.json`);
    failures += 1;
    continue;
  }
  const result = h2hTeamSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.success) {
    failures += 1;
    console.error(`h2h/${team}.json does not match its schema`);
  }
}
console.log(`  ok  h2h/*.json (${TEAM_IDS.length} teams)`);

// The identifiers the app indexes by have to be the ones it knows about.
const schedule = scheduleSchema.parse(
  JSON.parse(readFileSync(join(DATA, 'schedule.json'), 'utf8')),
);
for (const game of schedule.games) {
  assert.ok(TEAM_IDS.includes(game.home), `unknown home team ${game.home}`);
  assert.ok(TEAM_IDS.includes(game.away), `unknown away team ${game.away}`);
}

const stats = statsSchema.parse(JSON.parse(readFileSync(join(DATA, 'stats.json'), 'utf8')));
for (const stat of stats.stats) {
  assert.equal(
    Object.keys(stat.teams).length,
    32,
    `${stat.id} does not cover all 32 teams`,
  );
}

if (failures) {
  console.error(`\n${failures} payload(s) failed`);
  process.exit(1);
}
console.log('\npayloads match the app schemas');
