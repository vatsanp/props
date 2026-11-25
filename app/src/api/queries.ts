import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ODDS_BASE, getJson } from './client';
import {
  dvpSchema,
  h2hSummarySchema,
  h2hTeamSchema,
  manifestSchema,
  oddsSchema,
  propsSchema,
  recordsSchema,
  scheduleSchema,
  statsSchema,
  usageSchema,
  type Dvp,
  type H2HSummary,
  type H2HTeam,
  type Manifest,
  type Odds,
  type PropsPayload,
  type Records,
  type Schedule,
  type Stats,
  type Usage,
} from './schemas';

const MINUTE = 60 * 1000;

/**
 * The manifest is the only thing polled. Every other query keys off the
 * content hash it publishes, so a file that has not changed is never refetched
 * even when the screen remounts.
 *
 * It revalidates on every mount. The cache is persisted to AsyncStorage and
 * survives a relaunch, so without this nothing would ever discover that a new
 * build exists and the app would show the last payload it happened to fetch
 * until someone pulled to refresh. It is ~1 KB and fetched no-store.
 */
export function useManifest(): UseQueryResult<Manifest> {
  return useQuery({
    queryKey: ['manifest'],
    queryFn: () => getJson('manifest.json', manifestSchema, { noStore: true }),
    staleTime: 10 * MINUTE,
    refetchOnMount: 'always',
  });
}

function useVersioned<T>(
  file: string,
  schema: Parameters<typeof getJson<T>>[1],
): UseQueryResult<T> {
  const manifest = useManifest();
  const hash = manifest.data?.files?.[file]?.hash;
  return useQuery({
    queryKey: [file, hash ?? 'unknown'],
    // The hash goes in the URL as well as the key. The key alone only stops
    // react-query reusing its own cached copy; it does nothing about the HTTP
    // cache underneath, which will happily answer a repeat request for the
    // same address with the previous build. See dataUrl in ./url.
    queryFn: () => getJson(file, schema, { version: hash }),
    enabled: manifest.isSuccess,
    staleTime: Infinity, // a new hash means a new key, which is the refresh
  });
}

export const useStats = () => useVersioned<Stats>('stats.json', statsSchema);
export const useSchedule = () => useVersioned<Schedule>('schedule.json', scheduleSchema);
export const useRecords = () => useVersioned<Records>('records.json', recordsSchema);
export const useH2HSummary = () => useVersioned<H2HSummary>('h2h.json', h2hSummarySchema);
export const useProps = () => useVersioned<PropsPayload>('props.json', propsSchema);

// Only the detail screen needs these, so they are not fetched on open.
export const useDvp = () => useVersioned<Dvp>('dvp.json', dvpSchema);
export const useUsage = () => useVersioned<Usage>('usage.json', usageSchema);

/**
 * Per-team head-to-head detail, fetched only when a matchup is opened.
 *
 * These are not listed in the manifest — the pipeline only hashes the
 * top-level payloads — but they are built from the same games data as h2h.json
 * and move with it, so that hash versions them. The Worker caches them under
 * the same hash for the same reason.
 */
export function useH2HTeam(team: string | undefined): UseQueryResult<H2HTeam> {
  const manifest = useManifest();
  const hash = manifest.data?.files?.['h2h.json']?.hash;
  return useQuery({
    queryKey: ['h2h-team', team, hash ?? 'unknown'],
    queryFn: () => getJson(`h2h/${team}.json`, h2hTeamSchema, { version: hash }),
    enabled: Boolean(team),
    staleTime: Infinity, // as above: a new hash is a new key, which is the refresh
  });
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Sportsbook lines. Not manifest-versioned: they move on their own clock, so
 * this polls every minute -- but only while the screen using it is in front
 * and the app is open. Tab screens stay mounted when you leave them, and an
 * interval on a hidden screen would poll all day.
 *
 * Disabled (data stays undefined) when no Worker is configured; callers treat
 * that the same as "no lines yet".
 */
export function useOdds(): UseQueryResult<Odds> {
  const focused = useIsFocused();
  const active = useAppActive();
  const live = focused && active;
  return useQuery({
    queryKey: ['odds'],
    queryFn: () => getJson('odds.json', oddsSchema, { base: ODDS_BASE, noStore: true }),
    enabled: Boolean(ODDS_BASE),
    staleTime: 30 * 1000,
    refetchInterval: live ? MINUTE : false,
    refetchOnMount: true,
    retry: 1,
  });
}

/** True when the published data is old enough to mention during the season. */
export function isStale(manifest: Manifest | undefined): boolean {
  if (!manifest?.in_season) return false;
  const generated = Date.parse(manifest.generated_at);
  if (Number.isNaN(generated)) return false;
  return Date.now() - generated > 36 * 60 * MINUTE;
}

export function failedSources(manifest: Manifest | undefined): string[] {
  if (!manifest) return [];
  return Object.entries(manifest.sources)
    .filter(([, entry]) => !entry.ok)
    .map(([name]) => name);
}
