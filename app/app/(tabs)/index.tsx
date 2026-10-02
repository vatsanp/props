import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { failedSources, isStale, useManifest, useProps, useSchedule } from '../../src/api/queries';
import type { Recommendation } from '../../src/api/schemas';
import { Card, Chip, Empty, ErrorNote, Loading } from '../../src/components/common';
import { FilterButton, PickerSheet, type PickerOption } from '../../src/components/PickerSheet';
import { PropRow } from '../../src/components/PropRow';
import { POSITIONS } from '../../src/domain/markets';
import { formatKickoff } from '../../src/format';
import { useTheme } from '../../src/theme';

/**
 * The home screen: this week's recommendations, strongest first.
 */
export default function PropsScreen() {
  const theme = useTheme();
  const manifest = useManifest();
  const picks = useProps();
  const schedule = useSchedule();
  const [position, setPosition] = useState<string | null>(null);
  const [pickedGame, setPickedGame] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'position' | 'game' | null>(null);

  // Only games with at least one prop, in kickoff order.
  const games = useMemo(() => {
    const byId = new Map<string, { kickoff: string | null; count: number }>();
    for (const card of picks.data?.recommendations ?? []) {
      const seen = byId.get(card.game_id);
      byId.set(card.game_id, { kickoff: card.kickoff, count: (seen?.count ?? 0) + 1 });
    }
    const scheduled = new Map((schedule.data?.games ?? []).map((g) => [g.id, g]));
    return [...byId.entries()]
      .sort(([, a], [, b]) => (a.kickoff ?? '').localeCompare(b.kickoff ?? ''))
      .map(([id, { kickoff, count }]) => {
        const game = scheduled.get(id);
        return {
          id,
          label: game ? `${game.away} @ ${game.home}` : id,
          detail: `${formatKickoff(kickoff)} · ${count} prop${count === 1 ? '' : 's'}`,
        };
      });
  }, [picks.data, schedule.data]);

  // A pick from last week's slate quietly falls back to every game.
  const gameId = games.some((g) => g.id === pickedGame) ? pickedGame : null;

  const cards = useMemo(() => {
    const all = picks.data?.recommendations ?? [];
    return all.filter(
      (card) =>
        (!position || card.position === position) && (!gameId || card.game_id === gameId),
    );
  }, [picks.data, position, gameId]);

  const positionOptions: PickerOption<string | null>[] = [
    { value: null, label: 'All positions' },
    ...POSITIONS.map((pos) => ({ value: pos, label: pos })),
  ];
  const gameOptions: PickerOption<string | null>[] = [
    { value: null, label: 'All games' },
    ...games.map((g) => ({ value: g.id, label: g.label, detail: g.detail })),
  ];

  const stale = isStale(manifest.data);
  const failed = failedSources(manifest.data);

  if (picks.isLoading && !picks.data) return <Loading what="this week's props" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={picks.isFetching || manifest.isFetching}
          onRefresh={() => {
            manifest.refetch();
            picks.refetch();
          }}
          tintColor={theme.muted}
        />
      }
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>
          {manifest.data?.in_season
            ? `Week ${picks.data?.week ?? manifest.data?.current_week ?? '—'}`
            : 'Offseason'}
        </Text>
        <Text style={{ color: theme.muted, marginTop: 2 }}>
          {cards.length} matchup{cards.length === 1 ? '' : 's'} worth a look
        </Text>
      </View>

      {stale ? (
        <Card style={{ borderColor: theme.warn }}>
          <Text style={{ color: theme.warn, fontWeight: '600' }}>Data is over a day old</Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>
            Last refreshed {manifest.data?.generated_at?.replace('T', ' ').replace('Z', ' UTC')}.
          </Text>
        </Card>
      ) : null}

      {failed.length ? (
        <Card style={{ borderColor: theme.warn }}>
          <Text style={{ color: theme.warn, fontWeight: '600' }}>
            Some sources failed to refresh
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>
            {failed.join(', ')} — showing the last good numbers.
          </Text>
        </Card>
      ) : null}

      {picks.error ? <ErrorNote error={picks.error} /> : null}

      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <FilterButton
          label="Game"
          value={games.find((g) => g.id === gameId)?.label ?? 'All'}
          active={gameId !== null}
          onPress={() => setSheet('game')}
        />
        <FilterButton
          label="Position"
          value={position ?? 'All'}
          active={position !== null}
          onPress={() => setSheet('position')}
        />
      </View>

      <PickerSheet
        title="Position"
        visible={sheet === 'position'}
        options={positionOptions}
        selected={position}
        onSelect={setPosition}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        title="Game"
        visible={sheet === 'game'}
        options={gameOptions}
        selected={gameId}
        onSelect={setPickedGame}
        onClose={() => setSheet(null)}
      />

      {cards.length === 0 ? (
        <Empty
          title={manifest.data?.in_season ? 'No standout matchups' : 'Season complete'}
          detail={
            manifest.data?.in_season
              ? 'No defense is soft enough against a position whose primary player is healthy.'
              : `Next kickoff ${manifest.data?.next_kickoff ?? 'to be announced'}.`
          }
        />
      ) : (
        cards.map((card: Recommendation) => <PropRow key={card.id} card={card} />)
      )}

      <Text
        style={{
          color: theme.faint,
          fontSize: 11,
          textAlign: 'center',
          marginTop: 16,
          marginHorizontal: 32,
          lineHeight: 16,
        }}
      >
        Matchup and usage evidence only — no betting lines. Check the number in your book.
      </Text>
    </ScrollView>
  );
}
