import Constants from 'expo-constants';
import type { z } from 'zod';

import { dataUrl, type FetchOptions } from './url';

/**
 * Every payload is a static JSON file on a CDN. The manifest is fetched with
 * no-store and carries a content hash per file; those hashes go into the query
 * keys *and* into the payload URLs, so an unchanged file costs nothing on a
 * refresh and a changed one can never be served from a stale cache.
 *
 * Three sources, in order of preference:
 *
 *   1. EXPO_PUBLIC_DATA_BASE   - what `make phone` sets, pointing at the laptop
 *   2. extra.dataBase          - the Cloudflare Worker, set in app.json
 *   3. FALLBACK_BASE           - the GitHub raw URL the Worker itself reads
 *
 * The Worker adds edge caching, real cache headers and CORS on top of (3), but
 * (3) still serves the same bytes, so a Worker problem is not an outage.
 */

const FALLBACK_BASE = 'https://raw.githubusercontent.com/vatsanp/props/main/data/v1';

/**
 * A URL still carrying an unreplaced <placeholder> is not configured. Falling
 * through beats failing every request against an address that cannot resolve.
 */
function configured(value: string | undefined): string | undefined {
  return value && !value.includes('<') ? value : undefined;
}

export const DATA_BASE: string =
  configured(process.env.EXPO_PUBLIC_DATA_BASE) ??
  configured(Constants.expoConfig?.extra?.dataBase as string | undefined) ??
  FALLBACK_BASE;

/**
 * Sportsbook lines exist only on the Worker, which polls for them itself; the
 * laptop server and GitHub raw have none. So odds have their own base, and
 * with no Worker configured the app simply shows no lines.
 *
 *   EXPO_PUBLIC_ODDS_BASE=http://<lan-ip>:8787/v1   (with `make worker` running)
 */
export const ODDS_BASE: string | undefined =
  configured(process.env.EXPO_PUBLIC_ODDS_BASE) ??
  configured(Constants.expoConfig?.extra?.dataBase as string | undefined);

const TIMEOUT_MS = 10_000;

export class DataError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DataError';
  }
}

interface GetOptions extends FetchOptions {
  /** Defaults to DATA_BASE. */
  base?: string;
}

async function fetchJson(path: string, options: GetOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = dataUrl(options.base ?? DATA_BASE, path, options);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: options.noStore ? { 'Cache-Control': 'no-store' } : undefined,
    });
    if (!response.ok) {
      throw new DataError(`${path}: HTTP ${response.status}`, path);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof DataError) throw error;
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new DataError(
      aborted ? `${path}: timed out` : `${path}: ${String(error)}`,
      path,
      error,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: GetOptions = {},
): Promise<T> {
  const raw = await fetchJson(path, options);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DataError(
      `${path}: unexpected shape — ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      path,
      parsed.error,
    );
  }
  return parsed.data;
}
