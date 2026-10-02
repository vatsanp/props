/**
 * Display formatting. Pure text, no React, so it can be unit tested.
 */

/** Every per-game figure reads to one decimal, so a column of them lines up. */
export function trim(value: number): string {
  return value.toFixed(1);
}

/** The score is stored 0-1 and shown out of 100. */
export function scoreOutOf100(score: number): number {
  return Math.round(score * 100);
}

export function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
}

/**
 * Sharing a line with the matchup leaves roughly sixteen characters for the
 * name on a narrow phone, and a fifth of the league is longer than that. The
 * first name becomes an initial before the surname is allowed to truncate,
 * because the surname is the part that identifies him.
 */
export function shortName(name: string): string {
  if (name.length <= 16) return name;
  const [first, ...rest] = name.split(' ');
  if (rest.length === 0 || !first) return name;
  return `${first[0]}. ${rest.join(' ')}`;
}

/**
 * Kickoffs arrive in UTC, where every night game has already rolled over to
 * the next day. Games are grouped by the local calendar day instead, the same
 * clock their kickoff times are shown in.
 */
export function localDayKey(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A `localDayKey` as a heading: "Thursday, Sep 24". */
export function formatGameDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** "Thu 8:15 PM", in local time. */
export function formatKickoff(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
