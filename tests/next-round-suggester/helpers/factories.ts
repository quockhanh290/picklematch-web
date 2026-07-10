import { commitCompletedRound } from '../../../lib/next-round-suggester/commit'
import { DEFAULT_SCORING_WEIGHTS } from '../../../lib/next-round-suggester/state'
import { suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import {
  applyFairnessAdjustment,
  correctForFairness,
} from '../../../lib/next-round-suggester/fairness/corrector'
import type {
  Gender,
  GenderPreference,
  Match,
  PlayerSessionState,
  RoundRecord,
  ScoringWeights,
  SessionPairHistoryRow,
  SessionState,
  Team,
} from '../../../lib/next-round-suggester/types'

export type PlayerOptions = Partial<Omit<PlayerSessionState, 'pvna'>> & {
  pvna?: number
}

export type StateOptions = {
  players?: PlayerSessionState[]
  courts?: number
  pvnaTolerance?: number
  weights?: Partial<ScoringWeights>
  currentRound?: number
}

export type SimulationOptions = {
  players: number | PlayerSessionState[]
  courts: number
  rounds: number
  pvnaRange?: [number, number]
  genderMode?: 'none' | 'balanced' | 'mixedPrefs'
  maxRuntimeMs?: number
}

export type SimulationResult = {
  state: SessionState
  rounds: RoundRecord[]
  players: Array<
    PlayerSessionState & {
      max_consecutive_rest: number
      unique_partners: number
    }
  >
  matches_per_player_std: number
}

export function createPlayer(id = 'p1', overrides: PlayerOptions = {}): PlayerSessionState {
  const { pvna, ...rest } = overrides

  return {
    player_id: id,
    pvna: normalizeTestPvna(pvna ?? 3.0),
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
    ...rest,
  }
}

export function createPlayers(count: number, options: PlayerOptions = {}): PlayerSessionState[] {
  return Array.from({ length: count }, (_, index) =>
    createPlayer(`p${String(index + 1).padStart(2, '0')}`, {
      pvna: Number((3.0 + index * 0.04).toFixed(2)),
      ...options,
    }),
  )
}

export function createState(options: StateOptions = {}): SessionState {
  const players = options.players ?? createPlayers(4)

  return {
    session_id: 'session-test',
    current_round: options.currentRound ?? 0,
    status: 'active',
    config: {
      courts: options.courts ?? 1,
      pvna_tolerance: options.pvnaTolerance ?? 0.5,
      weights: {
        ...DEFAULT_SCORING_WEIGHTS,
        ...options.weights,
      },
    },
    players: new Map(players.map((player) => [player.player_id, clonePlayer(player)])),
    rounds: [],
  }
}

export function createMatch(teamA: Team, teamB: Team, courtIdx = 0): Match {
  return {
    court_idx: courtIdx,
    team_a: teamA,
    team_b: teamB,
  }
}

export function setPartnerRepeats(
  playerA: PlayerSessionState,
  playerB: PlayerSessionState,
  count: number,
) {
  playerA.partner_counts.set(playerB.player_id, count)
  playerB.partner_counts.set(playerA.player_id, count)
}

export function setOpponentRepeats(
  playerA: PlayerSessionState,
  playerB: PlayerSessionState,
  count: number,
) {
  playerA.opponent_counts.set(playerB.player_id, count)
  playerB.opponent_counts.set(playerA.player_id, count)
}

export function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      weights: { ...state.config.weights },
    },
    players: new Map([...state.players].map(([id, player]) => [id, clonePlayer(player)])),
    rounds: state.rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => ({
        ...match,
        team_a: [...match.team_a] as Team,
        team_b: [...match.team_b] as Team,
      })),
      resting: [...round.resting],
    })),
  }
}

export function simulateRound(state: SessionState, matches: Match[], resting: string[] = []): SessionState {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: state.current_round,
    status: 'completed',
    matches,
    resting,
    started_at: new Date('2026-05-14T12:00:00.000Z'),
    ended_at: new Date('2026-05-14T12:15:00.000Z'),
  }
  const existingRows = pairRowsFromState(state)
  const committed = commitCompletedRound(state, round, existingRows)
  applyPairRows(committed.players, committed.pairHistory)

  return {
    ...cloneState(state),
    current_round: state.current_round + 1,
    players: committed.players,
    rounds: [...state.rounds, round],
  }
}

export function simulateSession(options: SimulationOptions): SimulationResult {
  const players =
    typeof options.players === 'number'
      ? createSimulationPlayers(options.players, options)
      : options.players.map(clonePlayer)
  let state = createState({ players, courts: options.courts, pvnaTolerance: 0.5 })
  const maxRestByPlayer = new Map(players.map((player) => [player.player_id, 0]))

  for (let roundNo = 0; roundNo < options.rounds; roundNo += 1) {
    const adjustment = correctForFairness(state)
    const suggestion = suggestNextRound(applyFairnessAdjustment(state, adjustment), {
      tier_overrides: adjustment.tier_overrides,
      max_runtime_ms: options.maxRuntimeMs,
    }).alternatives[0]
    if (!suggestion) break
    state = simulateRound(state, suggestion.matches, suggestion.resting)

    for (const player of state.players.values()) {
      maxRestByPlayer.set(
        player.player_id,
        Math.max(maxRestByPlayer.get(player.player_id) ?? 0, player.consecutive_rest),
      )
    }
  }

  const resultPlayers = [...state.players.values()].map((player) => ({
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
    max_consecutive_rest: maxRestByPlayer.get(player.player_id) ?? 0,
    unique_partners: [...player.partner_counts.values()].filter((count) => count > 0).length,
  }))
  const matches = resultPlayers.map((player) => player.matches_played)

  return {
    state,
    rounds: state.rounds,
    players: resultPlayers,
    matches_per_player_std: standardDeviation(matches),
  }
}

function createSimulationPlayers(count: number, options: SimulationOptions): PlayerSessionState[] {
  const [minPvna, maxPvna] = options.pvnaRange ?? [3.0, 4.0]
  const spread = count <= 1 ? 0 : (maxPvna - minPvna) / (count - 1)

  return Array.from({ length: count }, (_, index) => {
    const gender = getGender(index, options.genderMode)
    const prefs = getPrefs(index, gender, options.genderMode)

    return createPlayer(`p${String(index + 1).padStart(2, '0')}`, {
      pvna: normalizeTestPvna(minPvna + spread * index),
      gender,
      ...prefs,
    })
  })
}

function getGender(index: number, mode: SimulationOptions['genderMode']): Gender {
  if (mode === 'balanced' || mode === 'mixedPrefs') return index % 2 === 0 ? 'F' : 'M'
  return null
}

function getPrefs(
  index: number,
  gender: Gender,
  mode: SimulationOptions['genderMode'],
): { partner_gender_pref: GenderPreference; opponent_gender_pref: GenderPreference } {
  if (mode !== 'mixedPrefs') {
    return { partner_gender_pref: 'any', opponent_gender_pref: 'any' }
  }

  return {
    partner_gender_pref: index % 2 === 0 ? 'F' : 'any',
    opponent_gender_pref: gender === 'M' ? 'F' : 'any',
  }
}

function clonePlayer(player: PlayerSessionState): PlayerSessionState {
  return {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }
}

function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()

  for (const player of state.players.values()) {
    for (const [partnerId, partnerCount] of player.partner_counts) {
      const key = [player.player_id, partnerId].sort().join(':')
      const existing = rows.get(key)
      rows.set(key, {
        session_id: state.session_id,
        player_a: key.split(':')[0],
        player_b: key.split(':')[1],
        partner_count: Math.max(existing?.partner_count ?? 0, partnerCount),
        opponent_count: existing?.opponent_count ?? 0,
      })
    }

    for (const [opponentId, opponentCount] of player.opponent_counts) {
      const key = [player.player_id, opponentId].sort().join(':')
      const existing = rows.get(key)
      rows.set(key, {
        session_id: state.session_id,
        player_a: key.split(':')[0],
        player_b: key.split(':')[1],
        partner_count: existing?.partner_count ?? 0,
        opponent_count: Math.max(existing?.opponent_count ?? 0, opponentCount),
      })
    }
  }

  return [...rows.values()]
}

function applyPairRows(players: Map<string, PlayerSessionState>, rows: SessionPairHistoryRow[]) {
  for (const player of players.values()) {
    player.partner_counts = new Map()
    player.opponent_counts = new Map()
  }

  for (const row of rows) {
    const a = players.get(row.player_a)
    const b = players.get(row.player_b)
    if (!a || !b) continue

    a.partner_counts.set(row.player_b, row.partner_count)
    b.partner_counts.set(row.player_a, row.partner_count)
    a.opponent_counts.set(row.player_b, row.opponent_count)
    b.opponent_counts.set(row.player_a, row.opponent_count)
  }
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function normalizeTestPvna(value: number): number {
  if (value <= 10) return Number(value.toFixed(2))
  if (value <= 800) return 2.1
  if (value <= 1000) return Number((2.1 + (value - 800) * (0.5 / 200)).toFixed(2))
  if (value <= 1150) return Number((2.6 + (value - 1000) * (0.5 / 150)).toFixed(2))
  if (value <= 1300) return Number((3.1 + (value - 1150) * (0.5 / 150)).toFixed(2))
  if (value <= 1450) return Number((3.6 + (value - 1300) * (1 / 150)).toFixed(2))
  if (value <= 1600) return Number((4.6 + (value - 1450) * (0.9 / 150)).toFixed(2))
  return Number((5.5 + (value - 1600) * (0.1 / 200)).toFixed(2))
}
