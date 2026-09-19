import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { team as lookupTeam } from '../domain/teams';
import { rankTone, useTheme } from '../theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: theme.radius,
          padding: 14,
          marginHorizontal: 16,
          marginBottom: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function TeamPill({ id, size = 14 }: { id: string; size?: number }) {
  const theme = useTheme();
  const info = lookupTeam(id);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 4,
          height: size + 4,
          borderRadius: 2,
          backgroundColor: info.primary,
        }}
      />
      <Text style={{ color: theme.text, fontSize: size, fontWeight: '600' }}>{id}</Text>
    </View>
  );
}

export function RankPill({ rank, label }: { rank: number; label?: string }) {
  const theme = useTheme();
  const tone = rankTone(rank, theme);
  return (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: tone.fg, fontSize: 12, fontWeight: '700' }}>
        {label ? `${label} ` : ''}
        #{rank}
      </Text>
    </View>
  );
}

export function Chip({
  text,
  tone = 'muted',
}: {
  text: string;
  tone?: 'muted' | 'warn' | 'good' | 'bad';
}) {
  const theme = useTheme();
  const colors = {
    muted: { fg: theme.muted, bg: theme.border },
    warn: { fg: theme.warn, bg: theme.warnBg },
    good: { fg: theme.good, bg: theme.goodBg },
    bad: { fg: theme.bad, bg: theme.badBg },
  }[tone];
  return (
    <View
      style={{
        backgroundColor: colors.bg,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Loading({ what }: { what: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={theme.accent} />
      <Text style={{ color: theme.muted }}>Loading {what}…</Text>
    </View>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center', gap: 6 }}>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
      {detail ? (
        <Text style={{ color: theme.muted, textAlign: 'center' }}>{detail}</Text>
      ) : null}
    </View>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const theme = useTheme();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Card style={{ borderColor: theme.bad }}>
      <Text style={{ color: theme.bad, fontWeight: '600', marginBottom: 4 }}>
        Could not load data
      </Text>
      <Text style={{ color: theme.muted, fontSize: 13 }}>{message}</Text>
      <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
        Anything already downloaded is still shown.
      </Text>
    </Card>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.faint,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginHorizontal: 16,
        marginTop: 18,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}
