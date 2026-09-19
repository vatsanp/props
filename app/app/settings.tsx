import { Pressable, ScrollView, Text, View } from 'react-native';

import { DATA_BASE } from '../src/api/client';
import { useManifest } from '../src/api/queries';
import { Card, Chip, SectionTitle } from '../src/components/common';
import { useSettings } from '../src/settings';
import { useTheme } from '../src/theme';

/** Thresholds, and where the numbers on screen actually came from. */
export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, update, reset } = useSettings();
  const manifest = useManifest();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <SectionTitle>Edge thresholds</SectionTitle>
      <Card>
        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
          An edge is a stat where one team ranks in the top {settings.elite} and the
          other ranks outside the top {settings.weak}. The original script used 10
          and 20; these are a judgement call, not a fact.
        </Text>
      </Card>

      <Stepper
        label="Strong side"
        value={settings.elite}
        detail={`top ${settings.elite} counts as a strength`}
        onChange={(next) => update({ elite: Math.max(1, Math.min(31, next)) })}
      />
      <Stepper
        label="Weak side"
        value={settings.weak}
        detail={`outside the top ${settings.weak} counts as a weakness`}
        onChange={(next) => update({ weak: Math.max(2, Math.min(32, next)) })}
      />

      <Pressable onPress={reset}>
        <Card>
          <Text style={{ color: theme.accent, fontWeight: '600', textAlign: 'center' }}>
            Reset to 10 and 20
          </Text>
        </Card>
      </Pressable>

      <SectionTitle>Where this data comes from</SectionTitle>
      <Card>
        <Row label="Season" value={String(manifest.data?.season ?? '—')} />
        <Row
          label="Week"
          value={
            manifest.data?.in_season ? String(manifest.data?.current_week ?? '—') : 'offseason'
          }
        />
        <Row
          label="Last refreshed"
          value={
            manifest.data?.generated_at
              ? manifest.data.generated_at.replace('T', ' ').replace('Z', ' UTC')
              : '—'
          }
        />
        <Row label="Feed" value={DATA_BASE.replace('https://', '')} />
      </Card>

      <Card>
        <Text style={{ color: theme.faint, fontSize: 11, fontWeight: '700', marginBottom: 8 }}>
          SOURCES
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(manifest.data?.sources ?? {}).map(([name, entry]) => (
            <Chip key={name} text={name} tone={entry.ok ? 'good' : 'bad'} />
          ))}
        </View>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 10, lineHeight: 18 }}>
          Team stats from TeamRankings. Schedule, results and player production from
          nflverse, back to 1999. Injury reports from the weekly nflverse feed.
        </Text>
      </Card>

      <Text
        style={{
          color: theme.faint,
          fontSize: 11,
          textAlign: 'center',
          marginHorizontal: 32,
          marginTop: 10,
          lineHeight: 16,
        }}
      >
        Props shows matchup and usage evidence. It has no betting lines and makes no
        prediction about any individual game.
      </Text>
    </ScrollView>
  );
}

function Stepper({
  label,
  value,
  detail,
  onChange,
}: {
  label: string;
  value: number;
  detail: string;
  onChange: (next: number) => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>{label}</Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{detail}</Text>
        </View>
        <Pressable
          onPress={() => onChange(value - 1)}
          hitSlop={10}
          style={button(theme.card, theme.border)}
        >
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>−</Text>
        </Pressable>
        <Text
          style={{
            color: theme.text,
            fontSize: 18,
            fontWeight: '800',
            width: 42,
            textAlign: 'center',
          }}
        >
          {value}
        </Text>
        <Pressable
          onPress={() => onChange(value + 1)}
          hitSlop={10}
          style={button(theme.card, theme.border)}
        >
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function button(background: string, border: string) {
  return {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: background,
    borderWidth: 1,
    borderColor: border,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 6,
        gap: 12,
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{ color: theme.text, fontSize: 13, fontWeight: '600', flexShrink: 1 }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
