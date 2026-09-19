import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { ELITE_RANK, WEAK_RANK } from './domain/mismatch';

/**
 * The thresholds are user-adjustable because they are a judgement call, not a
 * fact: top-10 against bottom-12 is what the original script used, and it is a
 * reasonable default rather than a discovered truth.
 *
 * Stored in AsyncStorage, which is per-device and can fail (a private window,
 * cleared storage), so every read and write is guarded and the defaults stand
 * on their own.
 */

export interface Settings {
  elite: number;
  weak: number;
}

const DEFAULTS: Settings = { elite: ELITE_RANK, weak: WEAK_RANK };
const KEY = 'props-settings-v1';

const SettingsContext = createContext<{
  settings: Settings;
  update: (next: Partial<Settings>) => void;
  reset: () => void;
}>({ settings: DEFAULTS, update: () => {}, reset: () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as Partial<Settings>;
        setSettings({
          elite: clamp(parsed.elite ?? DEFAULTS.elite, 1, 31),
          weak: clamp(parsed.weak ?? DEFAULTS.weak, 2, 32),
        });
      })
      .catch(() => {
        /* storage unavailable: the defaults are fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      settings,
      update: (next: Partial<Settings>) => {
        setSettings((current) => {
          const merged = { ...current, ...next };
          // The bands must not cross, or every stat fires at once.
          if (merged.weak <= merged.elite) merged.weak = merged.elite + 1;
          AsyncStorage.setItem(KEY, JSON.stringify(merged)).catch(() => {});
          return merged;
        });
      },
      reset: () => {
        setSettings(DEFAULTS);
        AsyncStorage.removeItem(KEY).catch(() => {});
      },
    }),
    [settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
