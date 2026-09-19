/** npm run test:format */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ordinal, scoreOutOf100, shortName, trim } from '../format';

// Per-game figures always carry one decimal so columns align.
assert.equal(trim(2), '2.0');
assert.equal(trim(31), '31.0');
assert.equal(trim(72.94), '72.9');
assert.equal(trim(0), '0.0');

assert.equal(scoreOutOf100(0.8409), 84);
assert.equal(scoreOutOf100(0.835), 84);
assert.equal(scoreOutOf100(1), 100);
assert.equal(scoreOutOf100(0), 0);

assert.equal(ordinal(1), 'st');
assert.equal(ordinal(2), 'nd');
assert.equal(ordinal(3), 'rd');
assert.equal(ordinal(4), 'th');
assert.equal(ordinal(11), 'th');
assert.equal(ordinal(12), 'th');
assert.equal(ordinal(13), 'th');
assert.equal(ordinal(21), 'st');
assert.equal(ordinal(32), 'nd');

// Short names are left alone; long ones lose the first name, never the surname.
assert.equal(shortName('Trey McBride'), 'Trey McBride');
assert.equal(shortName('Antonio Williams'), 'Antonio Williams'); // exactly 16
assert.equal(shortName('Christian McCaffrey'), 'C. McCaffrey');
assert.equal(shortName('Rhamondre Stevenson'), 'R. Stevenson');
assert.equal(shortName('Jacory Croskey-Merritt'), 'J. Croskey-Merritt');
assert.equal(shortName('Kenneth Walker III'), 'K. Walker III');
assert.equal(shortName('Amon-Ra St. Brown'), 'A. St. Brown');
// A single token cannot be abbreviated without losing the whole name.
assert.equal(shortName('Supercalifragilistic'), 'Supercalifragilistic');

// Nothing in the real data ends up longer than the row can hold.
const DATA = join(import.meta.dirname, '..', '..', '..', 'data', 'v1', 'props.json');
const cards = JSON.parse(readFileSync(DATA, 'utf8')).recommendations as Array<{
  player: { name: string };
}>;
const longest = cards
  .map((card) => shortName(card.player.name))
  .reduce((a, b) => (b.length > a.length ? b : a), '');
assert.ok(longest.length <= 18, `"${longest}" is still ${longest.length} characters`);

console.log(`format ok — longest displayed name is "${longest}" (${longest.length} chars)`);
