#!/usr/bin/env node
/**
 * Ask a running Worker for the app the way Expo Go does, and check everything
 * Expo Go would check before it runs a line of it.
 *
 *   make worker-check                      (needs `make worker` running)
 *   WORKER_URL=https://props-data.<you>.workers.dev node worker/scripts/check-update.mjs
 *
 * This cannot prove Expo Go will accept the project -- only a phone can, see
 * "Opening the app without a laptop" in the README -- but it rules out
 * everything that would fail for a boring reason first.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = (process.env.WORKER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

/** What Metro's manifest carries at the top level, captured from `expo start`. */
const METRO_KEYS = ['assets', 'createdAt', 'extra', 'id', 'launchAsset', 'metadata', 'runtimeVersion'];

const sdkMajor = JSON.parse(
  readFileSync(join(ROOT, 'app', 'node_modules', 'expo', 'package.json'), 'utf8'),
).version.split('.')[0];
const RUNTIME = `exposdk:${sdkMajor}.0.0`;

/** The headers Expo Go sends for a project on this SDK. */
const EXPO_GO = {
  'expo-platform': 'ios',
  'expo-protocol-version': '1',
  'expo-runtime-version': RUNTIME,
  accept: 'multipart/mixed,application/expo+json,application/json',
};

let failures = 0;
async function check(what, run) {
  try {
    await run();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${what}: ${error.message}`);
  }
}

function md5(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

function sha256Base64Url(buffer) {
  return createHash('sha256').update(buffer).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `manifest` part of a multipart/mixed response. */
function manifestPart(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  assert.ok(boundary, `no boundary in ${contentType}`);
  for (const part of body.split(`--${boundary}`)) {
    if (!/name="manifest"/.test(part)) continue;
    const start = part.indexOf('\r\n\r\n');
    assert.ok(start >= 0, 'manifest part has no header/body separator (CRLF CRLF)');
    return JSON.parse(part.slice(start + 4).replace(/\r\n$/, ''));
  }
  throw new Error('no part named "manifest"');
}

async function getManifest(path, headers = EXPO_GO) {
  const response = await fetch(BASE + path, { headers });
  const body = await response.text();
  assert.equal(response.status, 200, `${path}: HTTP ${response.status} ${body.slice(0, 200)}`);
  return { response, manifest: manifestPart(response.headers.get('content-type') ?? '', body) };
}

console.log(`checking ${BASE}/expo as Expo Go (${RUNTIME})\n`);

let manifest;
await check('the manifest is served multipart, as Metro serves it', async () => {
  const got = await getManifest('/expo');
  manifest = got.manifest;
  assert.match(got.response.headers.get('content-type'), /^multipart\/mixed; boundary=/);
  assert.equal(got.response.headers.get('expo-protocol-version'), '0');
  assert.equal(got.response.headers.get('expo-sfv-version'), '0');
});

if (!manifest) {
  console.error('\nno manifest -- has `make app-bundle` been run, and is the Worker up?');
  process.exit(1);
}

await check('it has exactly the top-level fields Metro sends', () => {
  assert.deepEqual(Object.keys(manifest).sort(), METRO_KEYS);
});

await check(`runtimeVersion is ${RUNTIME}`, () => {
  assert.equal(manifest.runtimeVersion, RUNTIME);
});

await check('id is a UUID', () => {
  assert.match(manifest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

await check('the app reads its data from this same Worker', async () => {
  const dataBase = manifest.extra?.expoClient?.extra?.dataBase;
  assert.equal(dataBase, `${BASE}/v1`);
  const response = await fetch(`${dataBase}/manifest.json`);
  assert.equal(response.status, 200, `data manifest: HTTP ${response.status}`);
});

await check('it carries a stable scopeKey and no dev-server block', () => {
  assert.equal(manifest.extra.scopeKey, '@anonymous/props-worker');
  assert.equal(manifest.extra.expoGo, undefined);
});

await check('the bundle is plain JavaScript, not Hermes bytecode', async () => {
  const { launchAsset } = manifest;
  assert.equal(launchAsset.contentType, 'application/javascript');
  assert.equal(launchAsset.fileExtension, '.bundle');
  const response = await fetch(launchAsset.url);
  assert.equal(response.status, 200, `bundle: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  // Hermes bytecode starts with this magic number; Expo Go refuses it here.
  assert.notEqual(body.subarray(0, 8).toString('hex'), 'c61fbc03c103191f', 'bundle is HBC');
  assert.equal(md5(body), launchAsset.key, 'bundle md5 != key');
  assert.equal(sha256Base64Url(body), launchAsset.hash, 'bundle sha256 != hash');
});

await check(`all ${manifest.assets.length} assets download and match their hashes`, async () => {
  assert.ok(manifest.assets.length > 0, 'no assets listed');
  for (const asset of manifest.assets) {
    assert.ok(asset.url.startsWith(`${BASE}/`), `${asset.url} is not absolute on this origin`);
    const response = await fetch(asset.url);
    assert.equal(response.status, 200, `${asset.url}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(md5(body), asset.key, `${asset.url}: md5 != key`);
    assert.equal(sha256Base64Url(body), asset.hash, `${asset.url}: sha256 != hash`);
    assert.match(asset.fileExtension, /^\.\w+$/);
  }
});

await check('the root serves the same manifest to Expo Go, as Metro does', async () => {
  const { manifest: root } = await getManifest('/');
  assert.equal(root.id, manifest.id);
});

await check('the root still serves the status page to everyone else', async () => {
  const response = await fetch(`${BASE}/`);
  const status = await response.json();
  assert.equal(status.app?.id, manifest.id);
});

await check('the fallback variant adds a Metro-style expoGo block', async () => {
  const { manifest: dev } = await getManifest('/expo/dev');
  assert.equal(dev.id, manifest.id);
  assert.equal(dev.extra.expoGo?.packagerOpts?.dev, false);
});

await check('a client that cannot take multipart gets plain JSON', async () => {
  const response = await fetch(`${BASE}/expo`, {
    headers: { ...EXPO_GO, accept: 'application/expo+json' },
  });
  assert.equal(response.headers.get('content-type'), 'application/expo+json');
  assert.equal((await response.json()).id, manifest.id);
});

await check('an Expo Go on a different SDK is told why, not handed a bad bundle', async () => {
  const response = await fetch(`${BASE}/expo`, {
    headers: { ...EXPO_GO, 'expo-runtime-version': 'exposdk:99.0.0' },
  });
  assert.equal(response.status, 406);
  assert.match((await response.json()).error, /exposdk:99\.0\.0/);
});

await check('Android is refused clearly, since only iOS is published', async () => {
  const response = await fetch(`${BASE}/expo`, { headers: { ...EXPO_GO, 'expo-platform': 'android' } });
  assert.equal(response.status, 404);
});

await check('the /open page links to Expo Go on this host', async () => {
  const response = await fetch(`${BASE}/open`);
  const html = await response.text();
  const scheme = BASE.startsWith('https:') ? 'exps' : 'exp';
  assert.ok(html.includes(`${scheme}://${new URL(BASE).host}/expo`), 'link missing');
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nthe Worker serves the app the way Metro does');
