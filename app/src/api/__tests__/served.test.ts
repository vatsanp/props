/**
 * The same schema check as payloads.test.ts, but over HTTP against a running
 * data source instead of the files on disk. `npm run test:payloads` proves the
 * pipeline writes what the app expects; this proves whatever is *serving* those
 * payloads hands them over intact, with the headers the app relies on.
 *
 *   npm run test:served                               # local wrangler dev
 *   DATA_BASE=https://props-data.<you>.workers.dev/v1 npm run test:served
 */

import assert from 'node:assert/strict';

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

const BASE = (process.env.DATA_BASE ?? 'http://localhost:8787/v1').replace(/\/+$/, '');

type Schema = { safeParse: (value: unknown) => { success: boolean; error?: unknown } };

const files: Array<[string, Schema]> = [
  ['manifest.json', manifestSchema],
  ['stats.json', statsSchema],
  ['schedule.json', scheduleSchema],
  ['records.json', recordsSchema],
  ['h2h.json', h2hSummarySchema],
  ['props.json', propsSchema],
];

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`  FAIL ${message}`);
}

async function get(path: string): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { response, body: await response.json() };
}

async function main(): Promise<void> {
  console.log(`checking ${BASE}\n`);

  for (const [name, schema] of files) {
    try {
      const { response, body } = await get(name);

      // Without this header the payload is unreadable from Expo web.
      assert.equal(
        response.headers.get('access-control-allow-origin'),
        '*',
        `${name} is missing its CORS header`,
      );

      const result = schema.safeParse(body);
      if (!result.success) {
        fail(`${name} does not match its schema:`);
        console.error(JSON.stringify(result.error, null, 2).slice(0, 1200));
      } else {
        console.log(`  ok  ${name}`);
      }
    } catch (error) {
      fail(`${name}: ${String(error)}`);
    }
  }

  // Every team's head-to-head file has to resolve; a missing one is a screen
  // that fails only when someone opens that particular matchup. These are
  // served lazily from origin, so this also proves the lazy path works.
  const before = failures;
  for (const team of TEAM_IDS) {
    try {
      const { body } = await get(`h2h/${team}.json`);
      if (!h2hTeamSchema.safeParse(body).success) {
        fail(`h2h/${team}.json does not match its schema`);
      }
    } catch (error) {
      fail(`h2h/${team}.json: ${String(error)}`);
    }
  }
  if (failures === before) console.log(`  ok  h2h/*.json (${TEAM_IDS.length} teams)`);

  // The manifest must never be cached: it is how the app discovers that
  // anything else has changed.
  try {
    const { response } = await get('manifest.json');
    assert.match(
      response.headers.get('cache-control') ?? '',
      /no-store/,
      'manifest.json must be served no-store',
    );
    console.log('  ok  manifest.json is served no-store');
  } catch (error) {
    fail(`manifest cache-control: ${String(error)}`);
  }

  // A payload carries its content hash as an ETag, so an unchanged file costs a
  // 304 rather than a re-download on every app launch.
  try {
    const first = await fetch(`${BASE}/props.json`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'props.json is missing an ETag');
    const second = await fetch(`${BASE}/props.json`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304, `expected 304, got ${second.status}`);
    console.log('  ok  props.json revalidates to 304');
  } catch (error) {
    fail(`ETag revalidation: ${String(error)}`);
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nthe served payloads match the app schemas');
}

void main();
