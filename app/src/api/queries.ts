import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getJson } from './client';
import {
  h2hSummarySchema,
  h2hTeamSchema,
  manifestSchema,
  propsSchema,
  recordsSchema,
  scheduleSchema,
  statsSchema,
  type H2HSummary,
  type H2HTeam,
  type Manifest,
  type PropsPayload,
  type Records,
  type Schedule,
  type Stats,
} from './schemas';

const MINUTE = 60 * 1000;

/**
 * The manifest is the only thing polled. Every other query keys off the
 * content hash it publishes, so a file that has not changed is never refetched
 * even when the screen remounts.
 */
export function useManifest(): UseQueryResult<Manifest> {
  return useQuery({
    queryKey: ['manifest'],
    queryFn: () => getJson('manifest.json', manifestSchema, true),
    staleTime: 10 * MINUTE,
    refetchOnMount: false,
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
    queryFn: () => getJson(file, schema),
    enabled: manifest.isSuccess,
    staleTime: Infinity, // a new hash means a new key, which is the refresh
  });
}

export const useStats = () => useVersioned<Stats>('stats.json', statsSchema);
export const useSchedule = () => useVersioned<Schedule>('schedule.json', scheduleSchema);
export const useRecords = () => useVersioned<Records>('records.json', recordsSchema);
export const useH2HSummary = () => useVersioned<H2HSummary>('h2h.json', h2hSummarySchema);
export const useProps = () => useVersioned<PropsPayload>('props.json', propsSchema);

/** Per-team head-to-head detail, fetched only when a matchup is opened. */
export function useH2HTeam(team: string | undefined): UseQueryResult<H2HTeam> {
  return useQuery({
    queryKey: ['h2h-team', team],
    queryFn: () => getJson(`h2h/${team}.json`, h2hTeamSchema),
    enabled: Boolean(team),
    staleTime: 60 * MINUTE,
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
