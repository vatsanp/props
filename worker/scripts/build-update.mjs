#!/usr/bin/env node
/**
 * Export the app as a self-hosted expo-updates bundle the Worker can serve to
 * Expo Go, so opening the app does not need Metro running on a laptop.
 *
 *   make app-bundle        (or: node worker/scripts/build-update.mjs)
 *
 * Writes worker/public/update/ios/:
 *
 *   manifest.json          template; the Worker makes its urls absolute per request
 *   bundle-<md5>.js        the app, as plain JavaScript
 *   assets/<md5>.<ext>     every image the bundle requires
 *
 * Two things Expo Go insists on, and why this looks the way it does:
 *
 *   - Plain JavaScript. Expo Go only accepts Hermes bytecode from EAS Update;
 *     self-hosted updates must be JS, hence --no-bytecode.
 *   - runtimeVersion "exposdk:<sdk>", which is what Metro advertises to it.
 *
 * Asset key/hash follow Expo's reference server (custom-expo-updates-server):
 * key is the MD5 hex the bundle uses to look an asset up, hash is the base64url
 * SHA-256 the client verifies the download against.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'app');
const PLATFORM = 'ios';
const OUT = join(ROOT, 'worker', 'public', 'update', PLATFORM);
/** Where OUT is served from, relative to the Worker's origin. */
const URL_PREFIX = `/update/${PLATFORM}`;

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
};

function fail(message) {
  console.error(`\nbuild-update: ${message}`);
  process.exit(1);
}

function md5(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

function sha256Base64Url(buffer) {
  return createHash('sha256')
    .update(buffer)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 32 hex characters shaped as a UUID, as the reference server does it. */
function uuidFrom(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function run(args, { capture = false } = {}) {
  // EXPO_PUBLIC_* is inlined into the bundle at export time. `make phone` sets
  // this one to the laptop's LAN address, and it must never reach a bundle that
  // is meant to work without the laptop.
  const env = { ...process.env };
  delete env.EXPO_PUBLIC_DATA_BASE;

  const result = spawnSync('npx', args, {
    cwd: APP,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.status !== 0) {
    fail(`\`npx ${args.join(' ')}\` exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

// 1. The app's public config, which Expo Go reads as Constants.expoConfig.
const configText = run(['expo', 'config', '--type', 'public', '--json'], { capture: true });
let expoClient;
try {
  expoClient = JSON.parse(configText.slice(configText.indexOf('{')));
} catch {
  fail('could not parse `expo config` output');
}
if (!expoClient.sdkVersion) fail('expo config has no sdkVersion');
const runtimeVersion = `exposdk:${expoClient.sdkVersion}`;

// 2. Export the bundle as plain JavaScript.
const exported = mkdtempSync(join(tmpdir(), 'props-update-'));
try {
  run([
    'expo',
    'export',
    '--platform',
    PLATFORM,
    '--no-bytecode',
    '--output-dir',
    exported,
  ]);

  const metadata = JSON.parse(readFileSync(join(exported, 'metadata.json'), 'utf8'));
  const files = metadata.fileMetadata?.[PLATFORM];
  if (!files?.bundle) fail(`metadata.json has no ${PLATFORM} bundle`);
  if (files.bundle.endsWith('.hbc')) {
    fail('the export produced Hermes bytecode; Expo Go needs plain JS (--no-bytecode)');
  }

  // 3. Lay it out under worker/public, named by content.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'assets'), { recursive: true });

  const bundle = readFileSync(join(exported, files.bundle));
  const bundleKey = md5(bundle);
  const bundleName = `bundle-${bundleKey}.js`;
  copyFileSync(join(exported, files.bundle), join(OUT, bundleName));

  const launchAsset = {
    key: bundleKey,
    hash: sha256Base64Url(bundle),
    contentType: 'application/javascript',
    fileExtension: '.bundle',
    url: `${URL_PREFIX}/${bundleName}`,
  };

  // The same image can be listed more than once; the manifest needs it once.
  const seen = new Set();
  const assets = [];
  for (const asset of files.assets ?? []) {
    const body = readFileSync(join(exported, asset.path));
    const key = md5(body);
    if (seen.has(key)) continue;
    seen.add(key);

    const ext = String(asset.ext).toLowerCase();
    const name = `${key}.${ext}`;
    copyFileSync(join(exported, asset.path), join(OUT, 'assets', name));
    assets.push({
      key,
      hash: sha256Base64Url(body),
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      fileExtension: `.${ext}`,
      url: `${URL_PREFIX}/assets/${name}`,
    });
  }

  // A new id whenever anything Expo Go would load changes: the code, any
  // asset, the config, or the SDK. Expo Go re-downloads when the id moves.
  const identity = createHash('sha256')
    .update(launchAsset.hash)
    .update(assets.map((asset) => asset.hash).join(','))
    .update(JSON.stringify(expoClient))
    .update(runtimeVersion)
    .digest('hex');

  const manifest = {
    id: uuidFrom(identity),
    createdAt: new Date().toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient },
  };
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);

  const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(`\nupdate ${manifest.id}`);
  console.log(`  runtime  ${runtimeVersion}`);
  console.log(`  bundle   ${bundleName} (${kb(bundle.length)})`);
  console.log(`  assets   ${assets.length}`);
  console.log(`  written  ${OUT}`);
} finally {
  rmSync(exported, { recursive: true, force: true });
}
