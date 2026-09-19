import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Recommendation } from '../api/schemas';
import { ordinal, scoreOutOf100, shortName, trim } from '../format';
import { team as lookupTeam } from '../domain/teams';
import { rankTone, useTheme } from '../theme';

/**
 * A recommendation in a list: who, what prop, and the one number that says why
 * it is here. Everything else — the defense's full profile, his usage, how the
 * score was arrived at — lives on the detail screen a tap away.
 */
export function PropRow({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const router = useRouter();
  const { player, defense } = card;

  // softness_rank 1 = allows the most, which reads as 32nd of 32.
  const worstness = 33 - defense.softness_rank;
  const tone = rankTone(33 - worstness, theme);

  return (
    <Pressable
      onPress={() => router.push(`/prop/${encodeURIComponent(card.id)}`)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        backgroundColor: theme.card,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      })}
    >
      <View
        style={{
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: lookupTeam(player.team).primary,
        }}
      />

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text
            style={{ color: theme.text, fontSize: 16, fontWeight: '700', flexShrink: 1 }}
            numberOfLines={1}
          >
            {shortName(player.name)}
          </Text>
          {/* Never shrinks: a name without its matchup says very little. */}
          <Text style={{ color: theme.muted, fontSize: 11, flexShrink: 0 }} numberOfLines={1}>
            {player.team} {player.position} · vs {defense.team}
          </Text>
        </View>

        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
            {card.market_label}
          </Text>
          <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>
            {trim(player.per_game)}
          </Text>
          {player.status !== 'active' ? (
            <Text style={{ color: theme.warn, fontSize: 11, fontWeight: '700' }}>
              {player.status.toUpperCase()}
            </Text>
          ) : null}
        </View>

        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>
          {defense.team} allows{' '}
          <Text style={{ color: tone.fg, fontWeight: '700' }}>
            {trim(defense.allowed_per_game)}
          </Text>
          {' · '}
          <Text style={{ color: tone.fg, fontWeight: '700' }}>
            {worstness}
            {ordinal(worstness)}
          </Text>
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>
          {scoreOutOf100(card.score)}
        </Text>
        <Text style={{ color: theme.faint, fontSize: 10 }}>/ 100</Text>
      </View>

      <Text style={{ color: theme.faint, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}
