import type {
  PlayerSessionState,
  ScoringWeights,
  SessionState,
} from '../lib/next-round-suggester/types.ts'

export const weights: ScoringWeights = {
  elo: 1,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
}

export function makePlayer(
  id: string,
  overrides: Partial<PlayerSessionState> = {},
): PlayerSessionState {
  return {
    player_id: id,
    elo: 1000,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00.000Z'),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: null,
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
    ...overrides,
  }
}

export function makeState(
  players: PlayerSessionState[],
  eloTolerance = 150,
  courts = 1,
): SessionState {
  return {
    session_id: 'session-1',
    current_round: 0,
    status: 'active',
    config: {
      courts,
      elo_tolerance: eloTolerance,
      weights,
    },
    players: new Map(players.map((player) => [player.player_id, player])),
    rounds: [],
  }
}
