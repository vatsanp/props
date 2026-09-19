import { z } from 'zod';

/**
 * The payloads are validated at the boundary so bad data throws a typed error
 * somewhere we can show a message, rather than rendering a white screen three
 * components deep.
 */

const nullableNumber = z.number().nullable();

export const manifestSchema = z.object({
  schema_version: z.number(),
  generated_at: z.string(),
  season: z.number(),
  current_week: z.number().nullable(),
  season_type: z.string(),
  in_season: z.boolean(),
  next_kickoff: z.string().nullable(),
  files: z.record(
    z.string(),
    z.object({ hash: z.string(), bytes: z.number(), changed: z.boolean().optional() }),
  ),
  sources: z.record(
    z.string(),
    z.object({ ok: z.boolean(), fetched_at: z.string(), error: z.string().optional() }).loose(),
  ),
});

export const teamStatSchema = z.object({
  rank: z.number(),
  tied: z.boolean(),
  pct: z.number(),
  season: nullableNumber,
  last3: nullableNumber,
  last1: nullableNumber,
  home: nullableNumber,
  away: nullableNumber,
  prev_season: nullableNumber,
  prev_rank: z.number().nullable().optional(),
});

export const statsSchema = z.object({
  season: z.number(),
  prev_season: z.number(),
  generated_at: z.string(),
  stats: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      short: z.string(),
      unit: z.string(),
      phrase: z.string(),
      mirror: z.string(),
      higher_is_better: z.boolean(),
      max_rank: z.number(),
      teams: z.record(z.string(), teamStatSchema),
    }),
  ),
});

export const gameSchema = z.object({
  id: z.string(),
  espn_id: z.string().nullable(),
  type: z.string(),
  week: z.number(),
  kickoff: z.string().nullable(),
  away: z.string(),
  home: z.string(),
  away_score: z.number().nullable(),
  home_score: z.number().nullable(),
  status: z.string(),
  neutral: z.boolean(),
  div_game: z.boolean(),
  spread: nullableNumber,
  total: nullableNumber,
  venue: z.string().nullable(),
});

export const scheduleSchema = z.object({
  season: z.number(),
  current_week: z.number().nullable(),
  games: z.array(gameSchema),
  byes: z.record(z.string(), z.array(z.string())),
});

export const recordsSchema = z.object({
  season: z.number(),
  teams: z.record(
    z.string(),
    z.object({
      w: z.number(),
      l: z.number(),
      t: z.number(),
      games: z.number(),
      pf: z.number(),
      pa: z.number(),
      streak: z.string(),
      home: z.string(),
      away: z.string(),
      div: z.string(),
      conf: z.string(),
      last5: z.string(),
    }),
  ),
});

export const h2hSummarySchema = z.object({
  since: z.number(),
  include_relocations: z.boolean(),
  pairs: z.record(
    z.string(),
    z.object({
      teams: z.array(z.string()),
      games: z.number(),
      wins: z.record(z.string(), z.number()),
      ties: z.number(),
      streak: z.string().nullable(),
    }),
  ),
});

const splitSchema = z.object({ w: z.number(), l: z.number(), t: z.number() });

export const h2hTeamSchema = z.object({
  team: z.string(),
  since: z.number(),
  opponents: z.record(
    z.string(),
    z.object({
      games: z.number(),
      wins: z.number(),
      losses: z.number(),
      ties: z.number(),
      streak: z.string().nullable(),
      splits: z.record(z.string(), splitSchema),
      eras: z.array(
        z.object({
          codes: z.array(z.string()),
          wins: z.record(z.string(), z.number()),
          ties: z.number(),
          games: z.number(),
        }),
      ),
      recent: z.array(
        z.object({
          date: z.string(),
          season: z.number(),
          week: z.number(),
          type: z.string(),
          home: z.string(),
          away: z.string(),
          home_score: z.number(),
          away_score: z.number(),
          winner: z.string().nullable(),
          neutral: z.boolean(),
        }),
      ),
    }),
  ),
});

export const propsSchema = z.object({
  week: z.number().nullable(),
  max_softness_rank: z.number(),
  weights: z.record(z.string(), z.number()),
  note: z.string(),
  recommendations: z.array(
    z.object({
      id: z.string(),
      game_id: z.string(),
      week: z.number(),
      kickoff: z.string().nullable(),
      market: z.string(),
      market_label: z.string(),
      metric: z.string(),
      position: z.string(),
      player: z.object({
        id: z.string().nullable(),
        name: z.string(),
        team: z.string(),
        position: z.string(),
        role: z.string(),
        depth: z.number(),
        status: z.string(),
        games: z.number(),
        share: z.number(),
        share_of: z.string(),
        per_game: z.number(),
        unit: z.string(),
      }),
      defense: z.object({
        team: z.string(),
        allowed_per_game: z.number(),
        softness_rank: z.number(),
        games: z.number(),
        blend_weight: z.number(),
        current: nullableNumber,
        prior: nullableNumber,
      }),
      score: z.number(),
      components: z.record(z.string(), z.number()),
      rationale: z.string(),
    }),
  ),
});

/** What a defense allows per game to one position, for one metric. */
export const dvpCellSchema = z.object({
  allowed_per_game: z.number(),
  current: nullableNumber,
  prior: nullableNumber,
  games: z.number(),
  blend_weight: z.number(),
  softness_rank: z.number(),
  softness_pct: z.number(),
});

export const dvpSchema = z.object({
  season: z.number().nullable(),
  prior_season: z.number().nullable(),
  blend_prior_games: z.number(),
  note: z.string(),
  defenses: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), dvpCellSchema)),
  ),
});

export const usageSchema = z.object({
  season: z.number().nullable(),
  week: z.number().nullable(),
  teams: z.record(
    z.string(),
    z.record(
      z.string(),
      z.array(
        z.object({
          id: z.string().nullable(),
          name: z.string(),
          team: z.string(),
          position: z.string(),
          games: z.number(),
          shares: z.record(z.string(), z.number()),
          per_game: z.record(z.string(), z.number()),
          status: z.string(),
          depth: z.record(z.string(), z.number()),
          roles: z.record(z.string(), z.string()),
        }),
      ),
    ),
  ),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Dvp = z.infer<typeof dvpSchema>;
export type DvpCell = z.infer<typeof dvpCellSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type UsagePlayer = Usage['teams'][string][string][number];
export type Stats = z.infer<typeof statsSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Records = z.infer<typeof recordsSchema>;
export type H2HSummary = z.infer<typeof h2hSummarySchema>;
export type H2HTeam = z.infer<typeof h2hTeamSchema>;
export type PropsPayload = z.infer<typeof propsSchema>;
export type Recommendation = PropsPayload['recommendations'][number];
export type TeamStat = z.infer<typeof teamStatSchema>;
