/**
 * The content hash has to reach the URL, not just the react-query key.
 *
 * This is the regression guard for a real bug: the key alone stopped
 * react-query reusing its own cached copy, but every build was still served
 * from the same address, so the HTTP cache underneath answered with the
 * previous week's payload. The app showed week 2 for days with week 3 sitting
 * on the server.
 *
 *   npm run test:url
 */

import assert from 'node:assert/strict';

import { dataUrl } from '../url';

const BASE = 'https://props-data.example.workers.dev/v1';

let checks = 0;
function check(what: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`  ok  ${what}`);
}

check('a versioned payload carries its hash', () => {
  const url = dataUrl(BASE, 'props.json', { version: '0ebf62433cb5' });
  assert.equal(url, `${BASE}/props.json?v=0ebf62433cb5`);
});

check('a new build is a different URL', () => {
  const before = dataUrl(BASE, 'props.json', { version: '63dceea51cdd' });
  const after = dataUrl(BASE, 'props.json', { version: '0ebf62433cb5' });
  assert.notEqual(before, after, 'two builds must not share an address');
});

check('the same build is a stable URL, so it stays cacheable', () => {
  const once = dataUrl(BASE, 'props.json', { version: 'abc123' });
  const twice = dataUrl(BASE, 'props.json', { version: 'abc123' });
  assert.equal(once, twice);
});

check('the manifest is cache-busted, not versioned', () => {
  // It is the signal that everything else changed, so it can never be the
  // thing that is stale.
  const url = dataUrl(BASE, 'manifest.json', { noStore: true }, 1_800_000_000_000);
  assert.equal(url, `${BASE}/manifest.json?t=30000000`);
});

check('the manifest URL moves as time passes', () => {
  const minute = 60_000;
  const now = 1_800_000_000_000;
  assert.notEqual(
    dataUrl(BASE, 'manifest.json', { noStore: true }, now),
    dataUrl(BASE, 'manifest.json', { noStore: true }, now + minute),
  );
});

check('no options means a bare URL', () => {
  assert.equal(dataUrl(BASE, 'stats.json'), `${BASE}/stats.json`);
});

check('a nested path keeps its slash', () => {
  assert.equal(
    dataUrl(BASE, 'h2h/KC.json', { version: 'deadbeef' }),
    `${BASE}/h2h/KC.json?v=deadbeef`,
  );
});

check('a trailing slash on the base does not double up', () => {
  assert.equal(dataUrl(`${BASE}/`, 'stats.json'), `${BASE}/stats.json`);
});

check('a hash needing escaping is encoded', () => {
  assert.equal(
    dataUrl(BASE, 'stats.json', { version: 'a b&c' }),
    `${BASE}/stats.json?v=a%20b%26c`,
  );
});

check('a LAN base works too, which is what make phone uses', () => {
  assert.equal(
    dataUrl('http://192.168.1.4:8000/v1', 'props.json', { version: 'abc' }),
    'http://192.168.1.4:8000/v1/props.json?v=abc',
  );
});

console.log(`\n${checks} url checks passed`);
