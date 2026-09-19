import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useDvp, useProps, useSchedule, useUsage } from '../../src/api/queries';
import type { Recommendation, UsagePlayer } from '../../src/api/schemas';
import { Card, Chip, Empty, Loading, SectionTitle } from '../../src/components/common';
import { ordinal, trim } from '../../src/components/PropRow';
import { MARKETS } from '../../src/domain/markets';
import { team as lookupTeam } from '../../src/domain/teams';
import { rankTone, useTheme } from '../../src/theme';

/**
 * The case for one recommendation: what the defense gives up across every
 * metric for the position, what this player actually does, and how the three
 * score components combined. A pick you cannot interrogate is a pick you
 * should not act on.
 */
export default function PropDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const picks = useProps();

  const card = picks.data?.recommendations.find((c) => c.id === decodeURIComponent(String(id)));

  if (!card) {
    return picks.isLoading ? (
      <Loading what="this prop" />
    ) : (
      <Empty
        title="This prop is no longer listed"
        detail="The data refreshed and this matchup dropped off. Go back for the current list."
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: card.player.name }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Headline card={card} />
        <TheMatchup card={card} />
        <HisUsage card={card} />
        <TheScore card={card} />
        <Caveats card={card} />
        <GameLink card={card} />
      </ScrollView>
    </>
  );
}

function Headline({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const { player, defense } = card;
  const worstness = 33 - defense.softness_rank;

  return (
    <Card>
      <Text style={{ color: theme.muted, fontSize: 13 }}>
        {lookupTeam(player.team).name} {player.position} · vs {lookupTeam(defense.team).short}
      </Text>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800', marginTop: 2 }}>
        {player.name}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          marginTop: 14,
        }}
      >
        <Text style={{ color: theme.accent, fontSize: 38, fontWeight: '800', lineHeight: 42 }}>
          {trim(player.per_game)}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15, marginBottom: 6 }}>
          {player.unit} per game
        </Text>
      </View>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
        {card.market_label} · {player.position}
      </Text>

      <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 12 }}>
        {card.rationale}
      </Text>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <Chip
          text={`${lookupTeam(defense.team).short} ${worstness}${ordinal(worstness)} vs ${player.position}`}
          tone={worstness >= 26 ? 'bad' : 'muted'}
        />
        <Chip text={player.role} />
        {player.status !== 'active' ? <Chip text={player.status} tone="warn" /> : null}
      </View>
    </Card>
  );
}

/** Everything the defense gives up to this position, not just this one metric. */
function TheMatchup({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const dvp = useDvp();
  const { defense } = card;
  const position = card.position;
  const market = MARKETS[card.market];

  const metrics = dvp.data?.defenses?.[defense.team]?.[position];

  return (
    <>
      <SectionTitle>
        What {lookupTeam(defense.team).location} gives up to {position}s
      </SectionTitle>
      <Card>
        {!metrics ? (
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            {dvp.isLoading ? 'Loading the defensive profile…' : 'No profile available.'}
          </Text>
        ) : (
          Object.entries(metrics).map(([metric, cell], index) => {
            const worstness = 33 - cell.softness_rank;
            const tone = rankTone(cell.softness_rank, theme);
            const isThisProp = metric === card.metric;
            return (
              <View
                key={metric}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 9,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    color: isThisProp ? theme.text : theme.muted,
                    fontSize: 13,
                    fontWeight: isThisProp ? '700' : '400',
                  }}
                >
                  {metricLabel(metric)}
                  {isThisProp ? '  ←' : ''}
                </Text>
                <Text
                  style={{
                    width: 64,
                    textAlign: 'right',
                    color: theme.text,
                    fontWeight: '600',
                  }}
                >
                  {trim(cell.allowed_per_game)}
                </Text>
                <Text
                  style={{
                    width: 58,
                    textAlign: 'right',
                    color: tone.fg,
                    fontWeight: '700',
                    fontSize: 13,
                  }}
                >
                  {worstness}
                  {ordinal(worstness)}
                </Text>
              </View>
            );
          })
        )}
        <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
          Per game allowed, and where that ranks among 32 defenses. 32nd means no
          defense in the league gives up more.
        </Text>
      </Card>

      {defense.prior != null && defense.current != null ? (
        <Card>
          <Text style={{ color: theme.faint, fontSize: 11, fontWeight: '700' }}>
            HOW THIS NUMBER WAS REACHED
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}>
            <Figure
              label={`This season (${defense.games}g)`}
              value={trim(defense.current)}
            />
            <Figure label="Last season" value={trim(defense.prior)} />
            <Figure
              label={`Blend (${Math.round(defense.blend_weight * 100)}% current)`}
              value={trim(defense.allowed_per_game)}
              emphasis
            />
          </View>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
            {market?.noun ?? 'Production'} allowed early in a season swings wildly on one
            game, so this season is weighted against last season by how much has
            actually been played.
          </Text>
        </Card>
      ) : null}
    </>
  );
}

/** His full production line, not only the metric this prop is about. */
function HisUsage({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const usage = useUsage();
  const { player } = card;

  const entry: UsagePlayer | undefined = usage.data?.teams?.[player.team]?.[
    player.position
  ]?.find((p) => (player.id ? p.id === player.id : p.name === player.name));

  return (
    <>
      <SectionTitle>{player.name}'s season</SectionTitle>
      <Card>
        {!entry ? (
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            {usage.isLoading ? 'Loading his production…' : 'No production data available.'}
          </Text>
        ) : (
          <>
            {Object.entries(entry.per_game)
              .filter(([, value]) => value > 0)
              .map(([column, value], index) => (
                <View
                  key={column}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 7,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <Text style={{ flex: 1, color: theme.muted, fontSize: 13 }}>
                    {metricLabel(column)}
                  </Text>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>{trim(value)}</Text>
                </View>
              ))}

            <View style={{ flexDirection: 'row', gap: 16, marginTop: 14 }}>
              <Figure
                label={shareLabel(player.share_of)}
                value={`${Math.round(player.share * 100)}%`}
              />
              <Figure
                label="Depth chart"
                value={`${player.position}${player.depth}`}
              />
              <Figure label="Games" value={String(entry.games)} />
            </View>
            <Text style={{ color: theme.faint, fontSize: 11, marginTop: 10, lineHeight: 16 }}>
              Per game this season. Usage is never blended with last season — a player
              may have changed teams or lost his job, and last year's share would point
              at the wrong man.
            </Text>
          </>
        )}
      </Card>
    </>
  );
}

/** The score, decomposed, so it is arithmetic rather than an oracle. */
function TheScore({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const picks = useProps();
  const weights = picks.data?.weights ?? {};

  const parts = [
    {
      key: 'softness',
      label: 'Matchup',
      detail: 'how generous this defense is to the position',
    },
    { key: 'usage', label: 'Usage', detail: "his share among everyone at the position" },
    {
      key: 'confidence',
      label: 'Confidence',
      detail: 'how many games either side rests on',
    },
  ];

  return (
    <>
      <SectionTitle>Why it scored {card.score.toFixed(2)}</SectionTitle>
      <Card>
        {parts.map((part, index) => {
          const value = card.components[part.key] ?? 0;
          const weight = weights[part.key] ?? 0;
          return (
            <View
              key={part.key}
              style={{
                paddingVertical: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: theme.text, fontWeight: '600' }}>
                  {part.label}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {value.toFixed(2)} × {weight.toFixed(2)} ={' '}
                </Text>
                <Text style={{ color: theme.text, fontWeight: '700', width: 44, textAlign: 'right' }}>
                  {(value * weight).toFixed(3)}
                </Text>
              </View>
              <View
                style={{
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.border,
                  marginTop: 7,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: 5,
                    width: `${Math.min(100, value * 100)}%`,
                    backgroundColor: theme.accent,
                  }}
                />
              </View>
              <Text style={{ color: theme.faint, fontSize: 11, marginTop: 5 }}>
                {part.detail}
              </Text>
            </View>
          );
        })}
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingTop: 10,
            marginTop: 4,
          }}
        >
          <Text style={{ flex: 1, color: theme.text, fontWeight: '700' }}>Total</Text>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>
            {card.score.toFixed(2)}
          </Text>
        </View>
      </Card>
    </>
  );
}

function Caveats({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const { player, defense } = card;
  const notes: string[] = [];

  if (defense.blend_weight < 0.6) {
    notes.push(
      `The defense has played ${defense.games} game${defense.games === 1 ? '' : 's'}, so its number leans on last season.`,
    );
  }
  if (player.games <= 2) {
    notes.push(
      `${player.name} has played ${player.games} game${player.games === 1 ? '' : 's'}; his per-game figures can move a lot.`,
    );
  }
  if (player.status !== 'active') {
    notes.push(`He is listed ${player.status.toLowerCase()} — check before kickoff.`);
  }
  notes.push('No betting line is involved. Compare this against the number in your book.');

  return (
    <>
      <SectionTitle>Worth knowing</SectionTitle>
      <Card>
        {notes.map((note) => (
          <Text
            key={note}
            style={{ color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 6 }}
          >
            · {note}
          </Text>
        ))}
      </Card>
    </>
  );
}

function GameLink({ card }: { card: Recommendation }) {
  const theme = useTheme();
  const router = useRouter();
  const schedule = useSchedule();
  const game = schedule.data?.games.find((g) => g.id === card.game_id);

  return (
    <Pressable onPress={() => router.push(`/matchup/${card.game_id}`)}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              {game ? `${game.away} at ${game.home}` : 'The full matchup'}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
              Team edges, head to head, and every stat
            </Text>
          </View>
          <Text style={{ color: theme.faint, fontSize: 18 }}>›</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.faint, fontSize: 11 }} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={{
          color: emphasis ? theme.accent : theme.text,
          fontSize: 18,
          fontWeight: '700',
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function metricLabel(metric: string): string {
  return (
    {
      receiving_yards: 'Receiving yards',
      receptions: 'Receptions',
      targets: 'Targets',
      rushing_yards: 'Rushing yards',
      rushing_tds: 'Rushing TDs',
      receiving_tds: 'Receiving TDs',
      carries: 'Carries',
      attempts: 'Pass attempts',
      passing_yards: 'Passing yards',
      passing_tds: 'Passing TDs',
      rushing_tds_receiving_tds: 'Touchdowns',
    }[metric] ?? metric.replace(/_/g, ' ')
  );
}

function shareLabel(shareOf: string): string {
  if (shareOf === 'targets') return 'Target share';
  if (shareOf === 'carries') return 'Carry share';
  return 'Pass attempts';
}
