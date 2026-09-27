/**
 * props-data — the read path for the Props app.
 *
 * The pipeline (pipeline/props/, Python) scrapes and builds the payloads, and
 * GitHub Actions commits them to data/v1/. This Worker does not repeat any of
 * that: an hourly cron mirrors the *bytes* of any changed payload into KV, and
 * the fetch handler serves them from the edge with CORS and cache headers.
 *
 * Serving rather than computing is deliberate. The free plan allows 10 ms of
 * CPU per invocation, cron triggers included, and one real refresh parses
 * 6.6 MB of HTML plus ~11 MB of CSV. Byte pass-through costs almost nothing.
 *
 * Note that team matchup edges are NOT computed here. They are computed
 * on-device in app/src/domain/mismatch.ts, because the elite/weak thresholds
 * are settings the user changes live. Precomputing them would break that.
 *
 * URL layout mirrors data/v1/ exactly -- /v1/stats.json, /v1/h2h/KC.json --
 * so the app only ever has to change its base URL.
 *
 * ## The subrequest budget, which shapes everything below
 *
 * On the free plan a Worker gets 50 subrequests per invocation, and KV get(),
 * put() and list() each count as one alongside every fetch(). That is why the
 * cron syncs only the 7 payloads the manifest lists -- 1 list + 1 manifest
 * fetch + 7 fetches + 7 puts + 1 manifest put, about 17 at worst.
 *
 * The 32 h2h/<TEAM>.json files are deliberately NOT part of that sync: copying
 * them would add 64 subrequests and blow the limit. They are fetched from
 * origin on first request and cached in KV under a key that includes h2h.json's
 * content hash, so a new build silently supersedes them with no invalidation
 * pass. The app only asks for one when a matchup is opened.
 */

import { loadTemplate, serveManifest, serveOpenPage, type ExpoEnv } from './expo';

export interface Env extends ExpoEnv {
  /** Every payload. Binding name is fixed by wrangler.jsonc. */
  MISMATCH_STORE: KVNamespace;
  /** Base URL the payloads are published at, e.g. the raw.githubusercontent URL. */
  ORIGIN_BASE: string;
}

/** Stored beside each payload so a sync can skip what has not changed. */
interface PayloadMeta {
  /**
   * The pipeline's content hash for this file. A payload pulled in by the
   * fetch fallback carries `origin`, so the next cron reconciles it.
   */
  hash: string;
  /** When this key was last written, ISO-8601. */
  syncedAt: string;
}

/** The subset of manifest.json this Worker depends on. */
interface Manifest {
  generated_at?: string;
  files?: Record<string, { hash: string; bytes: number; changed: boolean }>;
}

interface SyncReport {
  startedAt: string;
  checked: number;
  wrote: string[];
  failed: string[];
}

/** Top-level payloads: `v1/stats.json`. Listed by the cron, synced by hash. */
const PAYLOAD_PREFIX = 'v1/';
/**
 * Per-team head-to-head: `h2h/KC@<hash>.json`. A separate prefix so the cron's
 * list() only ever sees the handful of keys it manages, however many cached
 * team files have accumulated.
 */
const H2H_PREFIX = 'h2h/';

const MANIFEST = 'manifest.json';
const H2H_SUMMARY = 'h2h.json';

/** Superseded team files are never read again; this is just the bin collection. */
const H2H_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Origin hiccups shouldn't cost an hour's freshness. Cheap, given the budget. */
const FETCH_ATTEMPTS = 3;
/** Gentle on origin, and irrelevant to CPU since these are all waiting on IO. */
const CONCURRENCY = 4;

const USER_AGENT = 'props-data-worker (Cloudflare Worker; personal project)';

/** React Native ignores CORS, but Expo web and `curl -i` do not. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'content-type, cache-control, if-none-match',
  'access-control-max-age': '86400',
};

/** The app cache-busts the manifest itself; never let an edge hold onto it. */
const MANIFEST_CACHE = 'no-store';
/**
 * Payloads are addressed by a stable name, not a hashed one, so they cannot be
 * immutable. Five minutes at the edge with a day of stale-while-revalidate
 * keeps a cold app fast without ever showing genuinely old data: the app keys
 * its own cache off the manifest hash regardless.
 */
const PAYLOAD_CACHE = 'public, max-age=300, stale-while-revalidate=86400';

/** `stats.json`, or `h2h/KC.json`. Nothing else, and never a traversal. */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
/** The `h2h/KC.json` form, whose team id we need to build a cache key. */
const H2H_TEAM_PATH = /^h2h\/([A-Za-z0-9]{2,4})\.json$/;

function meta(hash: string): PayloadMeta {
  return { hash, syncedAt: new Date().toISOString() };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Origin
// --------------------------------------------------------------------------

function originUrl(env: Env, path: string, bust = false): string {
  const base = env.ORIGIN_BASE.replace(/\/+$/, '');
  return `${base}/${path}${bust ? `?t=${Date.now()}` : ''}`;
}

/**
 * Read one file from origin. Retries a couple of times because a dropped
 * connection mid-sync would otherwise hold the manifest back for a full hour.
 * A 404 is not retried: that file is genuinely not published.
 */
async function originText(env: Env, path: string, bust = false): Promise<string> {
  // Caught before the retry loop: an unset ORIGIN_BASE would otherwise surface
  // as three slow 404s against a URL that still says <github-user>.
  if (env.ORIGIN_BASE.includes('<')) {
    throw new Error(`ORIGIN_BASE is still a placeholder -- set it in wrangler.jsonc`);
  }

  let last = '';

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(originUrl(env, path, bust), {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      });
      if (response.status === 404) {
        throw new NotPublished(path);
      }
      if (!response.ok) {
        last = `origin returned HTTP ${response.status}`;
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof NotPublished) throw error;
      last = describe(error);
    }
    if (attempt < FETCH_ATTEMPTS) await sleep(150 * attempt);
  }

  throw new Error(`${path}: ${last}`);
}

class NotPublished extends Error {
  constructor(path: string) {
    super(`${path} is not published`);
    this.name = 'NotPublished';
  }
}

// --------------------------------------------------------------------------
// Sync: origin -> KV, gated on the manifest's content hashes
// --------------------------------------------------------------------------

/**
 * The top-level payloads we already hold, with their metadata. `list` returns
 * metadata without transferring any values, so this is one subrequest rather
 * than one per file.
 */
async function storedMeta(env: Env): Promise<Map<string, PayloadMeta | undefined>> {
  const held = new Map<string, PayloadMeta | undefined>();
  let cursor: string | undefined;

  for (;;) {
    const page = await env.MISMATCH_STORE.list<PayloadMeta>({
      prefix: PAYLOAD_PREFIX,
      cursor,
    });
    for (const entry of page.keys) {
      held.set(entry.name, entry.metadata);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return held;
}

/** Run `work` over `items`, a few at a time, so origin is not hit all at once. */
async function pool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const item = items[next++];
      if (item === undefined) return;
      await work(item);
    }
  });
  await Promise.all(workers);
}

export async function sync(env: Env): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  const wrote: string[] = [];
  const failed: string[] = [];

  const manifestText = await originText(env, MANIFEST, true);
  const manifest = JSON.parse(manifestText) as Manifest;
  const files = manifest.files ?? {};
  if (Object.keys(files).length === 0) {
    throw new Error('manifest listed no files -- refusing to sync');
  }

  const held = await storedMeta(env);
  const stale = Object.entries(files).filter(
    ([name, entry]) => held.get(PAYLOAD_PREFIX + name)?.hash !== entry.hash,
  );

  await pool(stale, CONCURRENCY, async ([name, entry]) => {
    try {
      const body = await originText(env, name);
      await env.MISMATCH_STORE.put(PAYLOAD_PREFIX + name, body, {
        metadata: meta(entry.hash),
      });
      wrote.push(name);
    } catch (error) {
      failed.push(`${name}: ${describe(error)}`);
    }
  });

  // The manifest lands last, and only if everything else did. The app discovers
  // payloads through it, so publishing it early would advertise hashes for
  // files that are not in KV yet. Held back, the app keeps using the previous
  // manifest, which still describes a complete and coherent set -- and the next
  // run retries whatever failed, because those hashes still will not match.
  //
  // `generated_at` stands in as the manifest's own hash: it moves on every
  // build, so comparing it makes an idle hour write nothing at all.
  const generatedAt = manifest.generated_at ?? startedAt;
  const manifestChanged = held.get(PAYLOAD_PREFIX + MANIFEST)?.hash !== generatedAt;
  if (failed.length === 0 && (manifestChanged || wrote.length > 0)) {
    await env.MISMATCH_STORE.put(PAYLOAD_PREFIX + MANIFEST, manifestText, {
      metadata: meta(generatedAt),
    });
    wrote.push(MANIFEST);
  }

  return { startedAt, checked: Object.keys(files).length, wrote, failed };
}

// --------------------------------------------------------------------------
// Serving
// --------------------------------------------------------------------------

function respond(
  body: BodyInit | null,
  {
    status = 200,
    cache = PAYLOAD_CACHE,
    etag,
    method = 'GET',
  }: { status?: number; cache?: string; etag?: string; method?: string } = {},
): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache,
    ...CORS_HEADERS,
  });
  if (etag) headers.set('etag', etag);
  return new Response(method === 'HEAD' ? null : body, { status, headers });
}

function problem(status: number, message: string, method = 'GET'): Response {
  return respond(JSON.stringify({ error: message }), { status, cache: 'no-store', method });
}

/** The current h2h.json hash, which per-team cache keys hang off. */
async function h2hHash(env: Env): Promise<string> {
  const manifestText = await env.MISMATCH_STORE.get(PAYLOAD_PREFIX + MANIFEST, 'text');
  if (manifestText === null) return 'origin';
  const manifest = JSON.parse(manifestText) as Manifest;
  return manifest.files?.[H2H_SUMMARY]?.hash ?? 'origin';
}

/**
 * Per-team head-to-head, cached under a key carrying h2h.json's hash. A new
 * build changes that hash, so the old entry is simply never looked up again
 * and expires on its own -- no invalidation pass, and no subrequests spent
 * refreshing 32 files most people will never open.
 */
async function serveH2HTeam(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  team: string,
): Promise<Response> {
  const hash = await h2hHash(env);
  const cacheKey = `${H2H_PREFIX}${team}@${hash}.json`;

  const cached = await env.MISMATCH_STORE.get(cacheKey, 'text');
  if (cached !== null) {
    return respond(cached, { etag: `"${hash}-${team}"`, method: request.method });
  }

  const body = await originText(env, path);
  ctx.waitUntil(
    env.MISMATCH_STORE.put(cacheKey, body, {
      metadata: meta(hash),
      expirationTtl: H2H_TTL_SECONDS,
    }).catch(() => {}),
  );
  return respond(body, { etag: `"${hash}-${team}"`, method: request.method });
}

/**
 * Serve one of the manifest's payloads. A miss falls through to origin and
 * backfills KV, so the Worker is useful the moment it deploys rather than
 * after the first cron, and heals itself if a key is ever lost.
 */
async function servePayload(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const isManifest = path === MANIFEST;
  const cache = isManifest ? MANIFEST_CACHE : PAYLOAD_CACHE;

  const stored = await env.MISMATCH_STORE.getWithMetadata<PayloadMeta>(
    PAYLOAD_PREFIX + path,
    'text',
  );

  if (stored.value !== null) {
    const etag = stored.metadata?.hash ? `"${stored.metadata.hash}"` : undefined;
    // The manifest changes every build, so revalidating it by etag would only
    // ever miss; the payloads are the ones worth a 304.
    if (!isManifest && etag && request.headers.get('if-none-match') === etag) {
      return respond(null, { status: 304, cache, etag, method: request.method });
    }
    return respond(stored.value, { cache, etag, method: request.method });
  }

  const body = await originText(env, path, isManifest);
  ctx.waitUntil(
    env.MISMATCH_STORE.put(PAYLOAD_PREFIX + path, body, { metadata: meta('origin') }).catch(
      () => {},
    ),
  );
  return respond(body, { cache, method: request.method });
}

/** A quick look at what the Worker is holding, for when something looks stale. */
async function serveStatus(request: Request, env: Env): Promise<Response> {
  const held = await storedMeta(env);
  const update = await loadTemplate(env, request);
  return respond(
    JSON.stringify(
      {
        service: 'props-data',
        origin: env.ORIGIN_BASE,
        payloads: held.size,
        manifest: held.get(PAYLOAD_PREFIX + MANIFEST) ?? null,
        app: update
          ? { id: update.id, createdAt: update.createdAt, runtimeVersion: update.runtimeVersion }
          : null,
        note: 'Matchup edges are computed on-device, not here.',
        endpoints: [
          '/open',
          '/expo',
          `/v1/${MANIFEST}`,
          '/v1/props.json',
          '/v1/stats.json',
          '/v1/h2h/KC.json',
        ],
      },
      null,
      2,
    ),
    { cache: 'no-store', method: request.method },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return problem(405, `${request.method} is not allowed`);
    }

    const { pathname } = new URL(request.url);

    // The app itself, for Expo Go. Metro serves its manifest at the root, so a
    // request there that identifies as Expo Go gets one too, in case the path
    // in the exps:// link is ever dropped.
    if (pathname === '/expo' || (pathname === '/' && request.headers.has('expo-platform'))) {
      return serveManifest(request, env);
    }
    if (pathname === '/expo/dev') {
      return serveManifest(request, env, { devShaped: true });
    }
    if (pathname === '/open') {
      return serveOpenPage(request, env);
    }

    if (pathname === '/' || pathname === '') {
      return serveStatus(request, env);
    }

    if (!pathname.startsWith('/v1/')) {
      return problem(404, `no route for ${pathname}`, request.method);
    }

    const path = pathname.slice('/v1/'.length);
    if (!SAFE_PATH.test(path) || !path.endsWith('.json')) {
      return problem(400, 'not a payload path', request.method);
    }

    try {
      const team = H2H_TEAM_PATH.exec(path)?.[1];
      return team
        ? await serveH2HTeam(request, env, ctx, path, team)
        : await servePayload(request, env, ctx, path);
    } catch (error) {
      if (error instanceof NotPublished) {
        return problem(404, error.message, request.method);
      }
      return problem(502, `${path}: ${describe(error)}`, request.method);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sync(env)
        .then((report) => {
          const wrote = report.wrote.length
            ? `wrote ${report.wrote.length} (${report.wrote.join(', ')})`
            : 'nothing to write';
          const failed = report.failed.length
            ? ` -- FAILED ${report.failed.join('; ')}`
            : '';
          console.log(`sync: checked ${report.checked}, ${wrote}${failed}`);
        })
        .catch((error: unknown) => {
          console.error(`sync failed: ${describe(error)}`);
        }),
    );
  },
};
