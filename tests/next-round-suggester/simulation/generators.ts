import seedrandom from 'seedrandom'

import { DEFAULT_SCORING_WEIGHTS } from '../../../lib/next-round-suggester/state'
import type {
  Gender,
  GenderPreference,
  PlayerSessionState,
  ScoringWeights,
  SessionState,
} from '../../../lib/next-round-suggester/types'
import type { SimulationConfig } from './runner'

export function generatePlayers(
  config: SimulationConfig,
  rng: seedrandom.PRNG,
): PlayerSessionState[] {
  const pvnas = generatePvnas(config.n_players, config.pvna_distribution, rng)
  const genders = generateGenders(config.n_players, config.gender_ratio, rng)
  const groupAssignments = generateGroups(
    config.n_players,
    config.group_count,
    config.group_size_range,
    rng,
  )
  const prefs = generateGenderPrefs(config.n_players, config.gender_pref_rate, rng)
  const checkedInAt = new Date('2026-05-15T12:00:00.000Z')

  return Array.from({ length: config.n_players }, (_, index) => ({
    player_id: `player_${String(index + 1).padStart(2, '0')}`,
    pvna: pvnas[index],
    gender: genders[index],
    group_id: groupAssignments[index],
    partner_gender_pref: prefs[index].partner,
    opponent_gender_pref: prefs[index].opponent,
    checked_in_at: checkedInAt,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_play: 0,
    consecutive_rest: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    rounds_available: 0,
  }))
}

export function initState(
  players: PlayerSessionState[],
  options: {
    courts: number
    pvna_tolerance?: number
    weights?: ScoringWeights
  },
): SessionState {
  return {
    session_id: 'simulation-session',
    current_round: 1,
    status: 'active',
    config: {
      courts: options.courts,
      pvna_tolerance: options.pvna_tolerance ?? 0.5,
      weights: options.weights ?? DEFAULT_SCORING_WEIGHTS,
    },
    players: new Map(players.map((player) => [player.player_id, clonePlayer(player)])),
    rounds: [],
  }
}

export function generatePvnas(
  n: number,
  distribution: SimulationConfig['pvna_distribution'],
  rng: seedrandom.PRNG,
): number[] {
  switch (distribution) {
    case 'tight':
      return Array.from({ length: n }, () => roundPvna(3.3 + (rng.quick() - 0.5) * 1.0))
    case 'wide':
      return Array.from({ length: n }, () => roundPvna(3.5 + (rng.quick() - 0.5) * 2.0))
    case 'extreme':
      return Array.from({ length: n }, () => roundPvna(3.5 + (rng.quick() - 0.5) * 3.0))
    case 'bimodal':
      return Array.from({ length: n }, () =>
        rng.quick() < 0.5 ? roundPvna(2.7 + rng.quick() * 0.35) : roundPvna(4.0 + rng.quick() * 0.45),
      )
  }
}

function roundPvna(value: number): number {
  return Number(value.toFixed(2))
}

export function generateGenders(
  n: number,
  femaleRatio: number,
  rng: seedrandom.PRNG,
): Gender[] {
  return Array.from({ length: n }, () => {
    if (rng.quick() < 0.05) return null
    return rng.quick() < femaleRatio ? 'F' : 'M'
  })
}

export function generateGroups(
  n: number,
  count: number,
  sizeRange: [number, number],
  rng: seedrandom.PRNG,
): Array<string | null> {
  const assignments: Array<string | null> = new Array(n).fill(null)
  if (count <= 0) return assignments

  const indices = Array.from({ length: n }, (_, index) => index)
  shuffle(indices, rng)

  let cursor = 0
  for (let groupIndex = 0; groupIndex < count; groupIndex += 1) {
    const size =
      Math.floor(rng.quick() * (sizeRange[1] - sizeRange[0] + 1)) + sizeRange[0]
    if (cursor + size > n) break

    const groupId = `group_${groupIndex + 1}`
    for (let member = 0; member < size; member += 1) {
      assignments[indices[cursor + member]] = groupId
    }
    cursor += size
  }

  return assignments
}

export function generateGenderPrefs(
  n: number,
  rate: number,
  rng: seedrandom.PRNG,
): Array<{ partner: GenderPreference; opponent: GenderPreference }> {
  const choices: GenderPreference[] = ['M', 'F', 'any']

  return Array.from({ length: n }, () => {
    if (rng.quick() >= rate) {
      return { partner: 'any', opponent: 'any' }
    }

    return {
      partner: choices[Math.floor(rng.quick() * choices.length)],
      opponent:
        rng.quick() < 0.3 ? choices[Math.floor(rng.quick() * choices.length)] : 'any',
    }
  })
}

function shuffle<T>(items: T[], rng: seedrandom.PRNG): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.quick() * (index + 1))
    const current = items[index]
    items[index] = items[swapIndex]
    items[swapIndex] = current
  }
}

function clonePlayer(player: PlayerSessionState): PlayerSessionState {
  return {
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }
}
