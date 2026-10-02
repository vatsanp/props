import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useManifest, useRecords, useSchedule } from '../../src/api/queries';
import type { Game } from '../../src/api/schemas';
import { Card, Empty, ErrorNote, Loading, SectionTitle, TeamPill } from '../../src/components/common';
import { formatGameDay, localDayKey } from '../../src/format';
import { useTheme } from '../../src/theme';

/** This week's games, grouped by day, each tappable through to the matchup. */
export default function WeekScreen() {
  const theme = useTheme();
  const router = useRouter();
  const schedule = useSchedule();
  const records = useRecords();
  const manifest = useManifest();

  const [week, setWeek] = useState<number | null>(null);
  const currentWeek = week ?? schedule.data?.current_week ?? manifest.data?.current_week ?? 1;

  const byDay = useMemo(() => {
    const games = (schedule.data?.games ?? []).filter((g) => g.week === currentWeek);
    const groups = new Map<string, Game[]>();
    for (const game of games) {
      const day = game.kickoff ? localDayKey(game.kickoff) : 'TBD';
      groups.set(day, [...(groups.get(day) ?? []), game]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [schedule.data, currentWeek]);

  if (schedule.isLoading && !schedule.data) return <Loading what="the schedule" />;
  if (schedule.error && !schedule.data) return <ErrorNote error={schedule.error} />;

  const maxWeek = Math.max(...(schedule.data?.games ?? []).map((g) => g.week), 1);
  const byes = schedule.data?.byes?.[String(currentWeek)] ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Stepper label="‹" onPress={() => setWeek(Math.max(1, currentWeek - 1))} />
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
          Week {currentWeek}
        </Text>
        <Stepper label="›" onPress={() => setWeek(Math.min(maxWeek, currentWeek + 1))} />
      </View>

      {byDay.length === 0 ? (
        <Empty title="No games this week" />
      ) : (
        byDay.map(([day, games]) => (
          <View key={day}>
            <SectionTitle>{formatDay(day)}</SectionTitle>
            {games.map((game) => (
              <Pressable key={game.id} onPress={() => router.push(`/matchup/${game.id}`)}>
                <Card>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View style={{ gap: 8 }}>
                      <Side
                        id={game.away}
                        score={game.away_score}
                        record={records.data?.teams?.[game.away]}
                      />
                      <Side
                        id={game.home}
                        score={game.home_score}
                        record={records.data?.teams?.[game.home]}
                      />
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={{ color: theme.muted, fontSize: 12 }}>
                        {game.status === 'final' ? 'Final' : formatTime(game.kickoff)}
                      </Text>
                      {game.spread != null ? (
                        <Text style={{ color: theme.faint, fontSize: 11 }}>
                          {game.home} {game.spread > 0 ? `-${game.spread}` : `+${-game.spread}`}
                        </Text>
                      ) : null}
                      {game.neutral ? (
                        <Text style={{ color: theme.faint, fontSize: 11 }}>neutral site</Text>
                      ) : null}
                      {game.div_game ? (
                        <Text style={{ color: theme.faint, fontSize: 11 }}>division</Text>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        ))
      )}

      {byes.length ? (
        <>
          <SectionTitle>On bye</SectionTitle>
          <Text style={{ color: theme.muted, marginHorizontal: 16 }}>{byes.join(' · ')}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function Side({
  id,
  score,
  record,
}: {
  id: string;
  score: number | null;
  record?: { w: number; l: number; t: number };
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TeamPill id={id} size={16} />
      {record ? (
        <Text style={{ color: theme.faint, fontSize: 12 }}>
          {record.w}-{record.l}
          {record.t ? `-${record.t}` : ''}
        </Text>
      ) : null}
      {score != null ? (
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{score}</Text>
      ) : null}
    </View>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function formatDay(day: string): string {
  return day === 'TBD' ? 'Time to be announced' : formatGameDay(day);
}

function formatTime(kickoff: string | null): string {
  if (!kickoff) return 'TBD';
  return new Date(kickoff).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
