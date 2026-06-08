import type { Gender, GenderPreference, PlayerSessionState, SessionState } from '../../../lib/next-round-suggester/types'
import { createPlayer, createPlayers, createState, simulateRound } from './factories'

export type RandomScenario = {
  name: string
  state: SessionState
}

export function lateJoinScenario(): SessionState {
  let state = createState({ players: createPlayers(8), courts: 2 })
  state = simulateRound(state, [
    { court_idx: 0, team_a: ['p01', 'p08'], team_b: ['p02', 'p07'] },
    { court_idx: 1, team_a: ['p03', 'p06'], team_b: ['p04', 'p05'] },
  ])
  state.players.set('p09', createPlayer('p09', { pvna: 3.12 }))
  return state
}

export function earlyLeaveScenario(): SessionState {
  const players = createPlayers(8)
  players[2].checked_out_at = new Date('2026-05-14T12:30:00.000Z')
  return createState({ players, courts: 2 })
}

export function groupedScenario(): SessionState {
  return createState({
    courts: 2,
    players: [
      createPlayer('p01', { pvna: 3.0, group_id: 'g1' }),
      createPlayer('p02', { pvna: 3.08, group_id: 'g1' }),
      createPlayer('p03', { pvna: 3.04, group_id: 'g2' }),
      createPlayer('p04', { pvna: 3.12, group_id: 'g2' }),
      createPlayer('p05', { pvna: 3.16 }),
      createPlayer('p06', { pvna: 3.2 }),
      createPlayer('p07', { pvna: 3.24 }),
      createPlayer('p08', { pvna: 3.28 }),
    ],
  })
}

export function genderPreferenceScenario(): SessionState {
  return createState({
    players: [
      createPlayer('p01', { pvna: 3.2, gender: 'M', partner_gender_pref: 'M' }),
      createPlayer('p02', { pvna: 3.2, gender: 'M' }),
      createPlayer('p03', { pvna: 3.0, gender: 'F' }),
      createPlayer('p04', { pvna: 3.0, gender: 'F' }),
    ],
  })
}

export function generateRandomScenarios(count: number): RandomScenario[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `seed-${index}`,
    state: createRandomState(index + 1000),
  }))
}

function createRandomState(seed: number): SessionState {
  const random = seededRandom(seed)
  const playerCount = 4 + Math.floor(random() * 13)
  const courts = 1 + Math.floor(random() * 4)
  const players: PlayerSessionState[] = []

  for (let index = 0; index < playerCount; index += 1) {
    const gender = pick(random, [null, 'M', 'F'] as Gender[])
    players.push(
      createPlayer(`p${String(index + 1).padStart(2, '0')}`, {
        pvna: Number((2.7 + random() * 1.8).toFixed(2)),
        checked_out_at: random() < 0.08 ? new Date('2026-05-14T12:45:00.000Z') : null,
        matches_played: Math.floor(random() * 10),
        last_played_round: Math.floor(random() * 10) - 1,
        consecutive_rest: Math.floor(random() * 2),
        consecutive_play: Math.floor(random() * 3),
        opted_rest: random() < 0.08,
        gender,
        partner_gender_pref: pick(random, ['any', 'M', 'F'] as GenderPreference[]),
        opponent_gender_pref: pick(random, ['any', 'M', 'F'] as GenderPreference[]),
        group_id: random() < 0.15 ? `g${Math.floor(random() * 3)}` : null,
      }),
    )
  }

  return createState({
    players,
    courts,
    pvnaTolerance: 0.5,
  })
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, values: T[]): T {
  return values[Math.floor(random() * values.length)]
}
