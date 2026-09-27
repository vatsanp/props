/**
 * Serving the app to Expo Go, so it opens without Metro running on a laptop.
 *
 * What Metro hands Expo Go is an ordinary expo-updates manifest: one unsigned
 * JSON document naming a runtime ("exposdk:57.0.0"), the URL of the JavaScript
 * bundle, the images that bundle requires, and the app's config. This builds
 * the same document from the export `make app-bundle` leaves in public/update/,
 * whose files the platform serves as static assets.
 *
 * Protocol: https://docs.expo.dev/technical-specs/expo-updates-1/
 *
 * The response mirrors what Metro sends byte for byte where it matters
 * (multipart/mixed, a single `manifest` part, expo-protocol-version 0), because
 * that is the combination this Expo Go is known to accept.
 */

/** One file the client downloads. */
interface ManifestAsset {
  key: string;
  hash: string;
  contentType: string;
  fileExtension: string;
  url: string;
}

/** What build-update.mjs writes. URLs are paths; the origin is added per request. */
interface ManifestTemplate {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, string>;
  extra: { expoClient: { extra?: Record<string, unknown> } & Record<string, unknown> };
}

export interface ExpoEnv {
  ASSETS: Fetcher;
}

const PLATFORM = 'ios';
const TEMPLATE_PATH = `/update/${PLATFORM}/manifest.json`;

/**
 * Expo Go keys the app's on-device storage (AsyncStorage included) by this.
 * Stable, so the offline cache survives every re-export.
 */
const SCOPE_KEY = '@anonymous/props-worker';

/**
 * The origin the phone used to reach us. Taken from the Host header rather than
 * trusting request.url's host, so it is right both on workers.dev and on a LAN
 * address hitting `wrangler dev`. Every URL in the manifest is built from it.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get('host') ?? url.host}`;
}

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** The template `make app-bundle` produced, or null if it has not been run. */
export async function loadTemplate(
  env: ExpoEnv,
  request: Request,
): Promise<ManifestTemplate | null> {
  const response = await env.ASSETS.fetch(new URL(TEMPLATE_PATH, request.url));
  if (!response.ok) return null;
  return (await response.json()) as ManifestTemplate;
}

function absolute(origin: string, asset: ManifestAsset): ManifestAsset {
  return { ...asset, url: origin + asset.url };
}

/**
 * The manifest Expo Go loads.
 *
 * `devShaped` is the fallback variant: it adds the `extra.expoGo` block Metro
 * includes, in case Expo Go treats a manifest without it as a published
 * project and applies the May 2026 "projects you own" rule to it. Try the plain
 * one first -- a dev-shaped manifest may make Expo Go look for a debugger.
 */
export async function serveManifest(
  request: Request,
  env: ExpoEnv,
  { devShaped = false }: { devShaped?: boolean } = {},
): Promise<Response> {
  const platform = request.headers.get('expo-platform') ?? PLATFORM;
  if (platform !== PLATFORM) {
    return problem(404, `only an ${PLATFORM} bundle is published, not ${platform}`);
  }

  const template = await loadTemplate(env, request);
  if (!template) {
    return problem(503, 'no app bundle has been published -- run `make app-bundle`');
  }

  // When the App Store moves Expo Go to a new SDK, it stops matching this
  // bundle. Say so plainly instead of letting Expo Go fail on a bad bundle.
  const wanted = request.headers.get('expo-runtime-version');
  if (wanted && wanted !== template.runtimeVersion) {
    return problem(
      406,
      `this Expo Go wants ${wanted} but the published bundle is ${template.runtimeVersion} -- ` +
        'upgrade the app to that SDK and re-run `make app-bundle`',
    );
  }

  const origin = publicOrigin(request);
  const expoClient = {
    ...template.extra.expoClient,
    extra: {
      ...template.extra.expoClient.extra,
      // In Expo Go, Constants.expoConfig *is* this object, so this is where
      // app/src/api/client.ts finds its data. Pointing it at our own origin
      // means the bundle reads from whichever Worker served it, with no
      // app.json edit and nothing baked in at export time.
      dataBase: `${origin}/v1`,
    },
  };

  const extra: Record<string, unknown> = { eas: {}, expoClient, scopeKey: SCOPE_KEY };
  if (devShaped) {
    extra.expoGo = {
      debuggerHost: new URL(origin).host,
      developer: { tool: 'expo-cli', projectRoot: '/' },
      packagerOpts: { dev: false },
      mainModuleName: 'node_modules/expo-router/entry',
    };
  }

  const manifest = JSON.stringify({
    id: template.id,
    createdAt: template.createdAt,
    runtimeVersion: template.runtimeVersion,
    launchAsset: absolute(origin, template.launchAsset),
    assets: template.assets.map((asset) => absolute(origin, asset)),
    metadata: template.metadata ?? {},
    extra,
  });

  const headers = new Headers({
    'expo-protocol-version': '0',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
  });

  if (!(request.headers.get('accept') ?? '').includes('multipart/mixed')) {
    headers.set('content-type', 'application/expo+json');
    return new Response(manifest, { headers });
  }

  const boundary = `props-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="manifest"; filename="manifest"\r\n' +
    'Content-Type: application/json\r\n' +
    '\r\n' +
    `${manifest}\r\n` +
    `--${boundary}--\r\n`;
  headers.set('content-type', `multipart/mixed; boundary=${boundary}`);
  return new Response(body, { headers });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * A page to open on the phone. Safari hands an exp:// or exps:// link to Expo
 * Go (exps is the https form), and after the first open Expo Go keeps the
 * project in its recents, so this is only needed once.
 */
export async function serveOpenPage(request: Request, env: ExpoEnv): Promise<Response> {
  const origin = new URL(publicOrigin(request));
  const scheme = origin.protocol === 'https:' ? 'exps' : 'exp';
  const link = `${scheme}://${origin.host}/expo`;
  const fallback = `${link}/dev`;
  const template = await loadTemplate(env, request);
  const built = template
    ? `Bundle ${escapeHtml(template.id.slice(0, 8))}, exported ${escapeHtml(template.createdAt.slice(0, 16).replace('T', ' '))} UTC, for ${escapeHtml(template.runtimeVersion)}.`
    : 'No bundle published yet &mdash; run <code>make app-bundle</code>.';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Props</title>
<style>
  :root { --bg: #fff; --fg: #0b1220; --muted: #5b6475; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b1220; --fg: #e6e9ef; --muted: #98a2b3; --accent: #60a5fa; } }
  body { margin: 0; padding: 32px 16px; background: var(--bg); color: var(--fg);
         font: 16px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 420px; margin: 0 auto; }
  a.button { display: block; text-align: center; padding: 14px; border-radius: 12px;
             background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
  p { color: var(--muted); }
  code { font-size: 13px; }
  .fallback { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Props</h1>
  <p>Needs Expo Go installed. Your laptop does not need to be on.</p>
  <a class="button" href="${escapeHtml(link)}">Open in Expo Go</a>
  <p>${built}</p>
  <p>If Expo Go refuses to open it, try the
    <a class="fallback" href="${escapeHtml(fallback)}">fallback link</a>
    and note the error it shows.</p>
  <p><code>${escapeHtml(link)}</code></p>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
