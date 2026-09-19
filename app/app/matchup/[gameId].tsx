import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import {
  useH2HSummary,
  useH2HTeam,
  useProps,
  useSchedule,
  useStats,
} from '../../src/api/queries';
import { Card, Chip, Empty, Loading, SectionTitle } from '../../src/components/common';
import { trim as format } from '../../src/components/PropRow';
import { PropRow } from '../../src/components/PropRow';
import { findEdges, summarize, type Edge } from '../../src/domain/mismatch';
import { STATS } from '../../src/domain/stats';
import { useSettings } from '../../src/settings';
import { team as lookupTeam } from '../../src/domain/teams';
import { rankTone, useTheme } from '../../src/theme';

type Tab = 'props' | 'edges' | 'h2h' | 'stats';

export default function MatchupScreen() {
  const theme = useTheme();
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const [tab, setTab] = useState<Tab>('props');

  const schedule = useSchedule();
  const picks = useProps();
  const stats = useStats();

  const game = useMemo(
    () => schedule.data?.games.find((g) => g.id === gameId),
    [schedule.data, gameId],
  );

  const h2hSummary = useH2HSummary();
  const h2hDetail = useH2HTeam(game?.away);

  if (!game) {
    return schedule.isLoading ? (
      <Loading what="the matchup" />
    ) : (
      <Empty title="Game not found" detail={gameId} />
    );
  }

  const away = lookupTeam(game.away);
  const home = lookupTeam(game.home);

  return (
    <>
      <Stack.Screen options={{ title: `${game.away} @ ${game.home}` }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
                {away.short} at {home.short}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 3 }}>
                Week {game.week}
                {game.venue ? ` · ${game.venue}` : ''}
                {game.neutral ? ' · neutral site' : ''}
              </Text>
            </View>
            {game.home_score != null ? (
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
                {game.away_score}–{game.home_score}
              </Text>
            ) : null}
          </View>
        </Card>

        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          {(['props', 'edges', 'h2h', 'stats'] as Tab[]).map((name) => (
            <Pressable
              key={name}
              onPress={() => setTab(name)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                alignItems: 'center',
                backgroundColor: tab === name ? theme.accent : theme.card,
                borderWidth: 1,
                borderColor: tab === name ? theme.accent : theme.border,
              }}
            >
              <Text
                style={{
                  color: tab === name ? '#FFFFFF' : theme.muted,
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                {{ props: 'Props', edges: 'Edges', h2h: 'H2H', stats: 'Stats' }[name]}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'props' ? (
          <PropsTab gameId={game.id} />
        ) : tab === 'edges' ? (
          <EdgesTab away={game.away} home={game.home} stats={stats.data} />
        ) : tab === 'h2h' ? (
          <H2HTab
            away={game.away}
            home={game.home}
            summary={h2hSummary.data}
            detail={h2hDetail.data}
          />
        ) : (
          <StatsTab away={game.away} home={game.home} stats={stats.data} />
        )}
      </ScrollView>
    </>
  );
}

function PropsTab({ gameId }: { gameId: string }) {
  const picks = useProps();
  const cards = (picks.data?.recommendations ?? []).filter((c) => c.game_id === gameId);
  if (picks.isLoading && !picks.data) return <Loading what="props" />;
  if (!cards.length) {
    return (
      <Empty
        title="No props for this game"
        detail="Neither defense is soft enough against a position whose primary player is available."
      />
    );
  }
  return (
    <>
      {cards.map((card) => (
        <PropRow key={card.id} card={card} />
      ))}
    </>
  );
}

function EdgesTab({
  away,
  home,
  stats,
}: {
  away: string;
  home: string;
  stats: ReturnType<typeof useStats>['data'];
}) {
  const theme = useTheme();
  const { settings } = useSettings();
  if (!stats) return <Loading what="team stats" />;

  const edges = findEdges(stats, away, home, settings.elite, settings.weak);
  const counts = summarize(edges, away, home);

  if (!edges.length) {
    return <Empty title="No standout edges" detail="Both teams are middling in every matchup." />;
  }

  const sections = [away, home].map((team) => ({
    team,
    edges: edges
      .filter((edge) => edge.advantage === team)
      .sort((a, b) => b.severity - a.severity),
  }));

  return (
    <>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          {away} {counts[away]} · {home} {counts[home]}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 3 }}>
          A stat where one side is top-{settings.elite} and the other is outside the
          top {settings.weak}.
        </Text>
      </Card>
      {sections.map(({ team, edges: teamEdges }) =>
        teamEdges.length ? (
          <View key={team}>
            <SectionTitle>
              {lookupTeam(team).location} edges ({teamEdges.length})
            </SectionTitle>
            {teamEdges.map((edge) => (
              <EdgeCard key={`${team}-${edge.statId}`} edge={edge} />
            ))}
          </View>
        ) : null,
      )}
    </>
  );
}

function EdgeCard({ edge }: { edge: Edge }) {
  const theme = useTheme();
  const oneTone = rankTone(edge.team1Rank, theme);
  const twoTone = rankTone(edge.team2Rank, theme);

  return (
    <Card>
      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
        {edge.headline}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
        }}
      >
        <View style={{ alignItems: 'flex-start' }}>
          <Text style={{ color: oneTone.fg, fontSize: 18, fontWeight: '800' }}>
            #{edge.team1Rank}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {edge.team1} {edge.team1Value != null ? format(edge.team1Value) : '--'}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            height: 4,
            marginHorizontal: 14,
            borderRadius: 2,
            backgroundColor: theme.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 4,
              width: `${Math.min(100, (edge.severity / 31) * 100)}%`,
              backgroundColor: theme.accent,
            }}
          />
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: twoTone.fg, fontSize: 18, fontWeight: '800' }}>
            #{edge.team2Rank}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {edge.team2} {edge.team2Value != null ? format(edge.team2Value) : '--'}
          </Text>
        </View>
      </View>
      <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8 }}>
        {STATS[edge.statId].label} vs {STATS[edge.mirrorId].label}
      </Text>
    </Card>
  );
}

function H2HTab({
  away,
  home,
  summary,
  detail,
}: {
  away: string;
  home: string;
  summary: ReturnType<typeof useH2HSummary>['data'];
  detail: ReturnType<typeof useH2HTeam>['data'];
}) {
  const theme = useTheme();
  if (!summary) return <Loading what="head to head" />;

  const opponent = detail?.opponents?.[home];
  const key = [away, home].sort().join('_');
  const pair = summary.pairs[key];

  if (!pair) {
    return (
      <Empty
        title="They have not met"
        detail={`No meetings since ${summary.since}.`}
      />
    );
  }

  return (
    <>
      <Card>
        <Text style={{ color: theme.text, fontSize: 26, fontWeight: '800' }}>
          {pair.wins[away] ?? 0}–{pair.wins[home] ?? 0}
          {pair.ties ? `–${pair.ties}` : ''}
        </Text>
        <Text style={{ color: theme.muted, marginTop: 2 }}>
          {lookupTeam(away).location} vs {lookupTeam(home).location}, {pair.games} meetings
          since {summary.since}
        </Text>
        {pair.streak ? (
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 6 }}>
            <Chip text={`Streak ${pair.streak}`} />
          </View>
        ) : null}
      </Card>

      {opponent?.eras?.length ? (
        <>
          <SectionTitle>By era</SectionTitle>
          {opponent.eras.map((era) => (
            <Card key={era.codes.join('-')}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>
                {era.codes.join(' vs ')}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 3 }}>
                {Object.entries(era.wins)
                  .map(([code, count]) => `${code} ${count}`)
                  .join(' · ')}{' '}
                ({era.games} games)
              </Text>
            </Card>
          ))}
        </>
      ) : null}

      {opponent?.recent?.length ? (
        <>
          <SectionTitle>Recent meetings</SectionTitle>
          {opponent.recent.map((meeting) => (
            <Card key={`${meeting.date}-${meeting.home}`}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between' }}
              >
                <Text style={{ color: theme.muted, fontSize: 13 }}>{meeting.date}</Text>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
                  {meeting.away} {meeting.away_score} @ {meeting.home} {meeting.home_score}
                </Text>
                <Text
                  style={{
                    color: meeting.winner === away ? theme.good : theme.bad,
                    fontSize: 13,
                    fontWeight: '700',
                  }}
                >
                  {meeting.winner ?? 'tie'}
                </Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function StatsTab({
  away,
  home,
  stats,
}: {
  away: string;
  home: string;
  stats: ReturnType<typeof useStats>['data'];
}) {
  const theme = useTheme();
  if (!stats) return <Loading what="team stats" />;

  const byId = new Map(stats.stats.map((stat) => [stat.id, stat]));

  return (
    <>
      <SectionTitle>All 20 comparisons</SectionTitle>
      {stats.stats.map((stat) => {
        const one = stat.teams[away];
        const two = byId.get(stat.mirror)?.teams[home];
        if (!one || !two) return null;
        const oneTone = rankTone(one.rank, theme);
        const twoTone = rankTone(two.rank, theme);
        return (
          <Card key={stat.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 74 }}>
                <Text style={{ color: oneTone.fg, fontWeight: '800' }}>#{one.rank}</Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {one.season != null ? format(one.season) : '--'}
                </Text>
              </View>
              <Text
                style={{
                  flex: 1,
                  color: theme.text,
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                {stat.short}
              </Text>
              <View style={{ width: 74, alignItems: 'flex-end' }}>
                <Text style={{ color: twoTone.fg, fontWeight: '800' }}>#{two.rank}</Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {two.season != null ? format(two.season) : '--'}
                </Text>
              </View>
            </View>
          </Card>
        );
      })}
    </>
  );
}
