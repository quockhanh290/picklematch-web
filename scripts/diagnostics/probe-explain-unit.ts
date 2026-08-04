import seedrandom from 'seedrandom'
import { explainMatchOptimality } from '../../lib/next-round-suggester/live-preview'
import type { SessionState, Team } from '../../lib/next-round-suggester/types'
import { generatePlayers, initState } from '../../tests/next-round-suggester/simulation/generators'

const players = generatePlayers({ n_players: 5, courts: 1, rounds: 5, pvna_distribution: 'tight', gender_ratio: 0.5, gender_pref_rate: 0, group_count: 0, group_size_range: [0, 0], use_corrector: true, seed: 1 } as any, seedrandom('u'))
players.forEach(p => { p.pvna = 3.0; (p as any).effective_pvna = 3.0 })
const state: SessionState = initState(players, { courts: 1, pvna_tolerance: 0.5 })
const ids = [...state.players.keys()]
const [A, B, C, D, E] = ids
// A & B đã đối đầu 2 lần → lần 3 nếu lại đối; E mới 0 trận (ít nhất), còn lại 3 trận
state.players.get(A)!.opponent_counts.set(B, 2)
state.players.get(B)!.opponent_counts.set(A, 2)
;[A, B, C, D].forEach(id => { state.players.get(id)!.matches_played = 3 })
state.players.get(E)!.matches_played = 0

const nm = (id: string) => ({ [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D', [E]: 'E' } as any)[id]
const alternatives: any = [
  { matches: [{ team_a: [A, C], team_b: [B, E] }], resting: [D], score: 0, warnings: [], stats: {} }, // seated: A vs B (lần 3), plays E
  { matches: [{ team_a: [A, B], team_b: [C, D] }], resting: [E], score: 1, warnings: [], stats: {} }, // avoiding: A-B partners, benches E (0 trận)
]

const out = explainMatchOptimality({
  teamA: [A, C] as Team, teamB: [B, E] as Team,
  alternatives, state,
  playersById: new Map(ids.map(id => [id, { name: nm(id) }])),
  pvnaTolerance: 0.5,
})
console.log('fallback explanation:', JSON.stringify(out))
