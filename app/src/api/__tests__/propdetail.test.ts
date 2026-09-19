/**
 * Every recommendation has to be openable: the detail screen looks up the
 * defense's profile in dvp.json and the player's production in usage.json, and
 * a miss is a blank section that only shows up when someone taps that one card.
 *
 *   npm run test:detail
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dvpSchema, propsSchema, usageSchema } from '../schemas';

const DATA = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'v1');
const read = (name: string) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

const picks = propsSchema.parse(read('props.json'));
const dvp = dvpSchema.parse(read('dvp.json'));
const usage = usageSchema.parse(read('usage.json'));

const ids = new Set<string>();
let missingDvp = 0;
let missingPlayer = 0;

for (const card of picks.recommendations) {
  assert.ok(!ids.has(card.id), `duplicate card id ${card.id}`);
  ids.add(card.id);

  // The id has to survive a round trip through a URL path segment.
  assert.equal(decodeURIComponent(encodeURIComponent(card.id)), card.id);

  const cell = dvp.defenses[card.defense.team]?.[card.position]?.[card.metric];
  if (!cell) {
    missingDvp += 1;
    console.error(`no dvp cell: ${card.defense.team}/${card.position}/${card.metric}`);
  } else {
    assert.equal(cell.softness_rank, card.defense.softness_rank, `${card.id} rank disagrees`);
    assert.equal(
      cell.allowed_per_game,
      card.defense.allowed_per_game,
      `${card.id} allowed disagrees`,
    );
  }

  const squad = usage.teams[card.player.team]?.[card.player.position] ?? [];
  const player = squad.find((p) =>
    card.player.id ? p.id === card.player.id : p.name === card.player.name,
  );
  if (!player) {
    missingPlayer += 1;
    console.error(`no usage entry: ${card.player.team} ${card.player.name}`);
  } else {
    assert.equal(player.games, card.player.games, `${card.id} games disagree`);
    assert.ok(
      Object.values(player.per_game).some((value) => value > 0),
      `${card.player.name} has an empty production line`,
    );
  }
}

console.log(
  `${picks.recommendations.length} cards: ${missingDvp} missing defensive profiles, ` +
    `${missingPlayer} missing production lines`,
);
if (missingDvp || missingPlayer) process.exit(1);
console.log('every prop detail screen can render');
