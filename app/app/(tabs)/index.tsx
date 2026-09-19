import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { failedSources, isStale, useManifest, useProps } from '../../src/api/queries';
import type { Recommendation } from '../../src/api/schemas';
import { Card, Chip, Empty, ErrorNote, Loading } from '../../src/components/common';
import { PropRow } from '../../src/components/PropRow';
import { POSITIONS } from '../../src/domain/markets';
import { useTheme } from '../../src/theme';

/**
 * The home screen: this week's recommendations, strongest first.
 */
export default function PropsScreen() {
  const theme = useTheme();
  const manifest = useManifest();
  const picks = useProps();
  const [position, setPosition] = useState<string | null>(null);

  const cards = useMemo(() => {
    const all = picks.data?.recommendations ?? [];
    return position ? all.filter((card) => card.position === position) : all;
  }, [picks.data, position]);

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
          flexWrap: 'wrap',
        }}
      >
        <Filter label="All" active={position === null} onPress={() => setPosition(null)} />
        {POSITIONS.map((pos) => (
          <Filter
            key={pos}
            label={pos}
            active={position === pos}
            onPress={() => setPosition(position === pos ? null : pos)}
          />
        ))}
      </View>

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

function Filter({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: active ? theme.accent : theme.card,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.border,
      }}
    >
      <Text
        style={{
          color: active ? '#FFFFFF' : theme.muted,
          fontWeight: '600',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
