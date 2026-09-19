import { useColorScheme } from 'react-native';

/**
 * One palette, resolved per colour scheme. Rank colours are deliberately not
 * a red/green pair alone: the rank number is always shown next to the pill, so
 * the colour is reinforcement rather than the only signal.
 */

const shared = {
  radius: 12,
  gap: 12,
  good: '#16A34A',
  bad: '#DC2626',
  warn: '#D97706',
};

const light = {
  ...shared,
  bg: '#F6F7F9',
  card: '#FFFFFF',
  border: '#E3E6EA',
  text: '#0B1220',
  muted: '#5C6675',
  faint: '#8B95A3',
  accent: '#1D4ED8',
  goodBg: '#DCFCE7',
  badBg: '#FEE2E2',
  warnBg: '#FEF3C7',
};

const dark = {
  ...shared,
  bg: '#0B1220',
  card: '#151D2C',
  border: '#243044',
  text: '#F3F5F8',
  muted: '#9AA6B8',
  faint: '#6B7788',
  accent: '#60A5FA',
  good: '#22C55E',
  bad: '#F87171',
  warn: '#FBBF24',
  goodBg: '#14321F',
  badBg: '#3A1A1A',
  warnBg: '#3A2E12',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Top-10 is a strength, bottom-12 a weakness, the middle is unremarkable. */
export function rankTone(rank: number, theme: Theme): { fg: string; bg: string } {
  if (rank <= 10) return { fg: theme.good, bg: theme.goodBg };
  if (rank > 20) return { fg: theme.bad, bg: theme.badBg };
  return { fg: theme.muted, bg: theme.border };
}
