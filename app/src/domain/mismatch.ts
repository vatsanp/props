import type { Stats } from '../api/schemas';
import { STATS, STAT_ORDER } from './stats';
import { team as lookupTeam } from './teams';

/**
 * The team-level matchup rule, ported from pipeline/props/mismatch.py.
 *
 * Both implementations are asserted against the same golden fixture
 * (pipeline/tests/golden/edges_2025.json), which is what stops them drifting.
 *
 * All 20 stats are compared and all 20 are kept: iterating "Passing Yards Per
 * Game" reads team1's passing offense against team2's pass defense, and
 * iterating the mirror reads team1's pass defense against team2's passing
 * offense. Different matchups, not the same one twice.
 */

export const ELITE_RANK = 10;
export const WEAK_RANK = 20;

export interface Edge {
  statId: string;
  mirrorId: string;
  team1: string;
  team1Rank: number;
  team1Value: number | null;
  team2: string;
  team2Rank: number;
  team2Value: number | null;
  advantage: string;
  severity: number;
  headline: string;
}

export function findEdges(
  stats: Stats,
  team1: string,
  team2: string,
  elite: number = ELITE_RANK,
  weak: number = WEAK_RANK,
): Edge[] {
  const byId = new Map(stats.stats.map((stat) => [stat.id, stat]));
  const edges: Edge[] = [];

  for (const statId of STAT_ORDER) {
    const mirrorId = STATS[statId].mirror;
    const one = byId.get(statId)?.teams[team1];
    const two = byId.get(mirrorId)?.teams[team2];
    if (!one || !two) continue;

    const fires =
      (one.rank <= elite && two.rank > weak) || (one.rank > weak && two.rank <= elite);
    if (!fires) continue;

    edges.push({
      statId,
      mirrorId,
      team1,
      team1Rank: one.rank,
      team1Value: one.season,
      team2,
      team2Rank: two.rank,
      team2Value: two.season,
      // Rank 1 is best for every stat on TeamRankings, so the top-10 side is
      // the side that benefits.
      advantage: one.rank <= elite ? team1 : team2,
      severity: Math.abs(one.rank - two.rank),
      headline: `${lookupTeam(team1).location} ${STATS[statId].phrase} vs ${
        lookupTeam(team2).location
      } ${STATS[mirrorId].phrase}`,
    });
  }

  return edges;
}

export function summarize(edges: Edge[], team1: string, team2: string) {
  return {
    [team1]: edges.filter((edge) => edge.advantage === team1).length,
    [team2]: edges.filter((edge) => edge.advantage === team2).length,
  };
}
