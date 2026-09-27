/**
 * Building the URL for a payload.
 *
 * Kept apart from client.ts, which imports expo-constants and so cannot be
 * loaded outside a React Native runtime. This module is pure, which is what
 * lets url.test.ts run it under plain node.
 */

export interface FetchOptions {
  /**
   * Bypass every cache. Only the manifest uses this: it is the signal that
   * anything else has changed, so a cached copy defeats the whole scheme.
   */
  noStore?: boolean;
  /**
   * The payload's content hash, from the manifest. It goes in the URL so that
   * each build is a distinct resource.
   */
  version?: string;
}

/**
 * A payload's address.
 *
 * The content hash has to be in the URL, not just in the react-query key.
 * Without it every build is served from the same address, and an HTTP cache is
 * free to answer from its own copy — which is exactly what happens on iOS: a
 * response carrying `Last-Modified` but no `Cache-Control` gets *heuristic*
 * freshness (roughly 10% of its age), so a file that was already days old when
 * it was first fetched stays cached for hours. `python -m http.server`, which
 * `make phone` uses, sends no cache headers at all.
 *
 * With the hash in the URL a new build is a new resource, so there is nothing
 * stale to hand back, and an unchanged one stays perfectly cacheable.
 */
export function dataUrl(
  base: string,
  path: string,
  options: FetchOptions = {},
  now: number = Date.now(),
): string {
  const root = base.replace(/\/+$/, '');

  if (options.noStore) {
    // Changing once a minute is enough to defeat a cache without making every
    // single launch a guaranteed miss.
    return `${root}/${path}?t=${Math.floor(now / 60_000)}`;
  }
  if (options.version) {
    return `${root}/${path}?v=${encodeURIComponent(options.version)}`;
  }
  return `${root}/${path}`;
}
