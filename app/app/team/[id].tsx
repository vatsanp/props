import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { useProps, useRecords, useSchedule, useStats } from '../../src/api/queries';
import { Card, Chip, Empty, Loading, SectionTitle } from '../../src/components/common';
import { PropCard, format } from '../../src/components/PropCard';
import { STAT_ORDER, STATS } from '../../src/domain/stats';
import { team as lookupTeam } from '../../src/domain/teams';
import { rankTone, useTheme } from '../../src/theme';

/** One team: record, next game, this week's props, and all 20 stats. */
export default function TeamScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = String(id);

  const stats = useStats();
  const records = useRecords();
  const schedule = useSchedule();
  const picks = useProps();

  const info = lookupTeam(teamId);
  const record = records.data?.teams?.[teamId];
  const next = schedule.data?.games
    .filter((g) => (g.home === teamId || g.away === teamId) && g.status !== 'final')
    .sort((a, b) => (a.kickoff ?? '').localeCompare(b.kickoff ?? ''))[0];
  const teamPicks = (picks.data?.recommendations ?? []).filter(
    (card) => card.player.team === teamId,
  );

  if (stats.isLoading && !stats.data) return <Loading what={info.name} />;

  return (
    <>
      <Stack.Screen options={{ title: info.short }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 8,
                height: 44,
                borderRadius: 4,
                backgroundColor: info.primary,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                {info.name}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13 }}>{info.division}</Text>
            </View>
            {record ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                  {record.w}-{record.l}
                  {record.t ? `-${record.t}` : ''}
                </Text>
                <Text style={{ color: theme.faint, fontSize: 12 }}>{record.streak}</Text>
              </View>
            ) : null}
          </View>

          {record ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              <Chip text={`Home ${record.home}`} />
              <Chip text={`Away ${record.away}`} />
              <Chip text={`Div ${record.div}`} />
              <Chip text={`${record.pf} for · ${record.pa} against`} />
            </View>
          ) : null}
        </Card>

        {next ? (
          <Pressable onPress={() => router.push(`/matchup/${next.id}`)}>
            <Card>
              <Text style={{ color: theme.faint, fontSize: 11, fontWeight: '700' }}>
                NEXT GAME
              </Text>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 4 }}>
                {next.away === teamId ? `at ${next.home}` : `vs ${next.away}`} · Week {next.week}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
                {next.kickoff
                  ? new Date(next.kickoff).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Kickoff to be announced'}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        {teamPicks.length ? (
          <>
            <SectionTitle>This week's props</SectionTitle>
            {teamPicks.map((card, index) => (
              <PropCard key={`${card.market}-${card.player.id ?? index}`} card={card} />
            ))}
          </>
        ) : null}

        <SectionTitle>Offense</SectionTitle>
        <StatList teamId={teamId} stats={stats.data} unit="offense" />

        <SectionTitle>Defense</SectionTitle>
        <StatList teamId={teamId} stats={stats.data} unit="defense" />

        <SectionTitle>Special teams</SectionTitle>
        <StatList teamId={teamId} stats={stats.data} unit="special" />
      </ScrollView>
    </>
  );
}

function StatList({
  teamId,
  stats,
  unit,
}: {
  teamId: string;
  stats: ReturnType<typeof useStats>['data'];
  unit: string;
}) {
  const theme = useTheme();
  if (!stats) return null;

  const byId = new Map(stats.stats.map((stat) => [stat.id, stat]));
  const rows = STAT_ORDER.filter((id) => STATS[id].unit === unit);
  if (!rows.length) return <Empty title="Nothing here" />;

  return (
    <Card>
      {rows.map((statId, index) => {
        const stat = byId.get(statId);
        const row = stat?.teams[teamId];
        if (!stat || !row) return null;
        const tone = rankTone(row.rank, theme);
        return (
          <View
            key={statId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 9,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.border,
            }}
          >
            <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>{stat.short}</Text>
            <Text style={{ width: 62, textAlign: 'right', color: theme.text, fontWeight: '600' }}>
              {row.season != null ? format(row.season) : '--'}
            </Text>
            <Text style={{ width: 54, textAlign: 'right', color: theme.faint, fontSize: 12 }}>
              {row.last3 != null ? format(row.last3) : '--'}
            </Text>
            <View style={{ width: 44, alignItems: 'flex-end' }}>
              <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 13 }}>
                #{row.rank}
              </Text>
            </View>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <Text style={{ flex: 1 }} />
        <Text style={{ width: 62, textAlign: 'right', color: theme.faint, fontSize: 10 }}>
          season
        </Text>
        <Text style={{ width: 54, textAlign: 'right', color: theme.faint, fontSize: 10 }}>
          last 3
        </Text>
        <Text style={{ width: 44, textAlign: 'right', color: theme.faint, fontSize: 10 }}>
          rank
        </Text>
      </View>
    </Card>
  );
}
