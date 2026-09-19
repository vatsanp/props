import { Text, View } from 'react-native';

import type { Recommendation } from '../api/schemas';
import { team as lookupTeam } from '../domain/teams';
import { useTheme } from '../theme';
import { Card, Chip } from './common';

/**
 * One recommendation. The claim is always shown with the evidence that
 * produced it — how much the defense allows, where that ranks, how much of the
 * offense's work this player gets, and how many games any of that rests on.
 */
export function PropCard({ card, onPress }: { card: Recommendation; onPress?: () => void }) {
  const theme = useTheme();
  const { player, defense } = card;
  const defenseInfo = lookupTeam(defense.team);

  // softness_rank 1 means "allows the most", which reads as 32nd of 32.
  const worstness = 33 - defense.softness_rank;
  const thin = defense.blend_weight < 0.6;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
            {player.name}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
            {player.team} {player.position} · {card.market_label} · vs {defense.team}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: theme.accent, fontSize: 20, fontWeight: '800' }}>
            {card.score.toFixed(2)}
          </Text>
          <Text style={{ color: theme.faint, fontSize: 10 }}>SCORE</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
        <Stat
          label={`${player.position} ${card.market_label.toLowerCase()}`}
          value={`${format(player.per_game)} ${player.unit}`}
          detail="per game"
        />
        <Stat
          label={`${defenseInfo.location} allows`}
          value={`${format(defense.allowed_per_game)}`}
          detail={`${worstness}${ordinal(worstness)} of 32`}
          emphasis={worstness >= 26 ? theme.bad : undefined}
        />
        <Stat
          label={shareLabel(player.share_of)}
          value={`${Math.round(player.share * 100)}%`}
          detail={player.role}
        />
      </View>

      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 12 }}>
        {card.rationale}
      </Text>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {player.status !== 'active' ? (
          <Chip text={player.status} tone="warn" />
        ) : null}
        {thin ? (
          <Chip
            text={`${defense.games} game${defense.games === 1 ? '' : 's'} + last season`}
            tone="warn"
          />
        ) : null}
        <Chip text={`${player.games} game${player.games === 1 ? '' : 's'} played`} />
      </View>
    </Card>
  );
}

function Stat({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.faint, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: emphasis ?? theme.text, fontSize: 16, fontWeight: '700' }}>
        {value}
      </Text>
      {detail ? (
        <Text style={{ color: theme.muted, fontSize: 11 }}>{detail}</Text>
      ) : null}
    </View>
  );
}

function shareLabel(shareOf: string): string {
  if (shareOf === 'targets') return 'Target share';
  if (shareOf === 'carries') return 'Carry share';
  return 'Pass attempts';
}

export function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
}
