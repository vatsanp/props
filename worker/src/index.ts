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
   * The pipeline's content hash for this file (the manifest's own is its
   * `generated_at`). `origin` when the published hash was not known at write
   * time: the next sync sees the mismatch and reconciles it, and it is never
   * sent as an ETag.
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
/** Metadata hash for content whose published hash is not known. Never an ETag. */
const UNKNOWN_HASH = 'origin';
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

/**
 * How to ask origin for a file.
 *
 * GitHub's raw CDN caches every file for five minutes (max-age=300). Fetching a
 * payload at its bare URL right after a data commit can therefore return the
 * *previous* build -- and if that body were stored under the new build's hash,
 * the sync would consider it current and serve it until the build after next.
 *
 * So a payload is fetched at `?v=<hash>`: a new build is a URL the CDN has never
 * seen, which forces a fresh read, while an unchanged one stays cacheable. The
 * manifest, which is how we learn the hashes, is fetched with a time buster.
 */
interface OriginQuery {
  bust?: boolean;
  version?: string;
}

function originUrl(env: Env, path: string, { bust = false, version }: OriginQuery = {}): string {
  const base = env.ORIGIN_BASE.replace(/\/+$/, '');
  if (bust) return `${base}/${path}?t=${Date.now()}`;
  if (version && version !== UNKNOWN_HASH) {
    return `${base}/${path}?v=${encodeURIComponent(version)}`;
  }
  return `${base}/${path}`;
}

/**
 * Read one file from origin. Retries a couple of times because a dropped
 * connection mid-sync would otherwise hold the manifest back for a full hour.
 * A 404 is not retried: that file is genuinely not published.
 */
async function originText(env: Env, path: string, query: OriginQuery = {}): Promise<string> {
  // Caught before the retry loop: an unset ORIGIN_BASE would otherwise surface
  // as three slow 404s against a URL that still says <github-user>.
  if (env.ORIGIN_BASE.includes('<')) {
    throw new Error(`ORIGIN_BASE is still a placeholder -- set it in wrangler.jsonc`);
  }

  let last = '';

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(originUrl(env, path, query), {
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

  const manifestText = await originText(env, MANIFEST, { bust: true });
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
      const body = await originText(env, name, { version: entry.hash });
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
/**
 * If-None-Match is compared *weakly* (RFC 9110 §13.1.2): W/"x" matches "x".
 * That is not a nicety here. Cloudflare's edge rewrites a strong ETag to a weak
 * one whenever it compresses the response, which it does to all of this JSON,
 * so every real client sends back W/"...". An exact comparison never matched,
 * and no 304 was ever served in production.
 */
function etagMatches(header: string | null, etag: string | undefined): boolean {
  if (!header || !etag) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const wanted = opaque(etag);
  return header.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === wanted);
}

/** An ETag only when the hash names the content; `origin` names nothing. */
function etagFor(hash: string | undefined, suffix = ''): string | undefined {
  return hash && hash !== UNKNOWN_HASH ? `"${hash}${suffix}"` : undefined;
}

/**
 * The hash the pipeline published for `path` -- from the manifest in KV, or
 * from origin when a freshly deployed Worker has none yet.
 *
 * Callers read this *before* fetching the payload itself. If a build lands in
 * between, the stored label is then older than the body, never newer, and the
 * next sync sees the mismatch and corrects it. The other order could label an
 * old body with a new hash, which the sync would never revisit.
 */
async function publishedHash(env: Env, path: string): Promise<string> {
  const text =
    (await env.MISMATCH_STORE.get(PAYLOAD_PREFIX + MANIFEST, 'text')) ??
    (await originText(env, MANIFEST, { bust: true }));
  const manifest = JSON.parse(text) as Manifest;
  return manifest.files?.[path]?.hash ?? UNKNOWN_HASH;
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
  const hash = await publishedHash(env, H2H_SUMMARY);
  const cacheKey = `${H2H_PREFIX}${team}@${hash}.json`;
  const etag = etagFor(hash, `-${team}`);

  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return respond(null, { status: 304, etag, method: request.method });
  }

  const cached = await env.MISMATCH_STORE.get(cacheKey, 'text');
  if (cached !== null) {
    return respond(cached, { etag, method: request.method });
  }

  // Versioned for the same reason the sync is: a stale CDN copy stored under
  // this key would otherwise be served for the key's whole 30-day life.
  const body = await originText(env, path, { version: hash });
  ctx.waitUntil(
    env.MISMATCH_STORE.put(cacheKey, body, {
      metadata: meta(hash),
      expirationTtl: H2H_TTL_SECONDS,
    }).catch(() => {}),
  );
  return respond(body, { etag, method: request.method });
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
    const etag = etagFor(stored.metadata?.hash);
    // The manifest changes every build, so revalidating it by etag would only
    // ever miss; the payloads are the ones worth a 304.
    if (!isManifest && etagMatches(request.headers.get('if-none-match'), etag)) {
      return respond(null, { status: 304, cache, etag, method: request.method });
    }
    return respond(stored.value, { cache, etag, method: request.method });
  }

  // A miss: backfill from origin, labelled with the real hash so the ETag is
  // meaningful immediately and the next sync has nothing to rewrite.
  let hash: string;
  let body: string;
  if (isManifest) {
    body = await originText(env, MANIFEST, { bust: true });
    hash = (JSON.parse(body) as Manifest).generated_at ?? UNKNOWN_HASH;
  } else {
    hash = await publishedHash(env, path);
    body = await originText(env, path, { version: hash });
  }
  ctx.waitUntil(
    env.MISMATCH_STORE.put(PAYLOAD_PREFIX + path, body, { metadata: meta(hash) }).catch(
      () => {},
    ),
  );
  return respond(body, { cache, etag: isManifest ? undefined : etagFor(hash), method: request.method });
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
