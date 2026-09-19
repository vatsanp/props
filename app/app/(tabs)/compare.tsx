import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useStats } from '../../src/api/queries';
import { Card, Empty, Loading, SectionTitle } from '../../src/components/common';
import { trim as format } from '../../src/components/PropRow';
import { findEdges, summarize } from '../../src/domain/mismatch';
import { STATS } from '../../src/domain/stats';
import { TEAMS, TEAM_IDS, team as lookupTeam } from '../../src/domain/teams';
import { useSettings } from '../../src/settings';
import { rankTone, useTheme } from '../../src/theme';

/**
 * Any two teams, whether or not they play each other — the direct successor to
 * `python main.py KC DAL`.
 */
export default function CompareScreen() {
  const theme = useTheme();
  const stats = useStats();
  const { settings } = useSettings();

  const [team1, setTeam1] = useState<string>('KC');
  const [team2, setTeam2] = useState<string>('DAL');
  const [picking, setPicking] = useState<1 | 2 | null>(null);

  if (stats.isLoading && !stats.data) return <Loading what="team stats" />;
  if (!stats.data) return <Empty title="No stats yet" />;

  const edges =
    team1 === team2 ? [] : findEdges(stats.data, team1, team2, settings.elite, settings.weak);
  const counts = summarize(edges, team1, team2);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
        <Picker id={team1} onPress={() => setPicking(picking === 1 ? null : 1)} />
        <View style={{ justifyContent: 'center' }}>
          <Text style={{ color: theme.faint, fontWeight: '700' }}>vs</Text>
        </View>
        <Picker id={team2} onPress={() => setPicking(picking === 2 ? null : 2)} />
      </View>

      {picking ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            paddingHorizontal: 12,
            paddingBottom: 10,
          }}
        >
          {TEAM_IDS.map((id) => (
            <Pressable
              key={id}
              onPress={() => {
                if (picking === 1) setTeam1(id);
                else setTeam2(id);
                setPicking(null);
              }}
              style={{ width: '16.66%', padding: 3 }}
            >
              <View
                style={{
                  backgroundColor: theme.card,
                  borderWidth: 1,
                  borderColor: TEAMS[id].primary,
                  borderRadius: 8,
                  paddingVertical: 8,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>{id}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {team1 === team2 ? (
        <Empty title="Pick two different teams" />
      ) : (
        <>
          <Card>
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              {team1} {counts[team1]} · {team2} {counts[team2]}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12, marginTop: 3 }}>
              Stats where one side is top-{settings.elite} and the other outside the
              top {settings.weak}.
            </Text>
          </Card>

          {edges.length === 0 ? (
            <Empty
              title="No standout edges"
              detail="Neither side is at an extreme where the other is weak."
            />
          ) : (
            <>
              <SectionTitle>Edges</SectionTitle>
              {edges
                .slice()
                .sort((a, b) => b.severity - a.severity)
                .map((edge) => {
                  const oneTone = rankTone(edge.team1Rank, theme);
                  const twoTone = rankTone(edge.team2Rank, theme);
                  return (
                    <Card key={edge.statId}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                        {edge.headline}
                      </Text>
                      <Text style={{ color: theme.accent, fontSize: 12, marginTop: 2 }}>
                        edge {lookupTeam(edge.advantage).location}
                      </Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginTop: 10,
                        }}
                      >
                        <View>
                          <Text style={{ color: oneTone.fg, fontWeight: '800', fontSize: 17 }}>
                            #{edge.team1Rank}
                          </Text>
                          <Text style={{ color: theme.muted, fontSize: 12 }}>
                            {edge.team1}{' '}
                            {edge.team1Value != null ? format(edge.team1Value) : '--'}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: twoTone.fg, fontWeight: '800', fontSize: 17 }}>
                            #{edge.team2Rank}
                          </Text>
                          <Text style={{ color: theme.muted, fontSize: 12 }}>
                            {edge.team2}{' '}
                            {edge.team2Value != null ? format(edge.team2Value) : '--'}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8 }}>
                        {STATS[edge.statId].label} vs {STATS[edge.mirrorId].label}
                      </Text>
                    </Card>
                  );
                })}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Picker({ id, onPress }: { id: string; onPress: () => void }) {
  const theme = useTheme();
  const info = lookupTeam(id);
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: theme.radius,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <View
        style={{ width: 6, height: 30, borderRadius: 3, backgroundColor: info.primary }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>{id}</Text>
        <Text style={{ color: theme.faint, fontSize: 11 }} numberOfLines={1}>
          {info.short}
        </Text>
      </View>
      <Text style={{ color: theme.faint }}>▾</Text>
    </Pressable>
  );
}
