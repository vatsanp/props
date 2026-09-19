import Constants from 'expo-constants';
import type { z } from 'zod';

/**
 * Every payload is a static JSON file on a CDN. The manifest is fetched with
 * no-store and carries a content hash per file; those hashes go into the query
 * keys, so an unchanged file costs nothing on a refresh.
 */

const FALLBACK_BASE =
  'https://raw.githubusercontent.com/vatsan/NFL_Stats/main/data/v1';

export const DATA_BASE: string =
  process.env.EXPO_PUBLIC_DATA_BASE ??
  (Constants.expoConfig?.extra?.dataBase as string | undefined) ??
  FALLBACK_BASE;

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

async function fetchJson(path: string, noStore = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${DATA_BASE}/${path}${noStore ? `?t=${Math.floor(Date.now() / 60_000)}` : ''}`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: noStore ? { 'Cache-Control': 'no-store' } : undefined,
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
  noStore = false,
): Promise<T> {
  const raw = await fetchJson(path, noStore);
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
