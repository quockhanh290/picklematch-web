import seedrandom from 'seedrandom'
import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads } from '../../lib/next-round-suggester/live-preview'
import type { SessionLiveMatchRow, SessionState } from '../../lib/next-round-suggester/types'
import { generatePlayers, initState } from '../../tests/next-round-suggester/simulation/generators'

const PVNA = [3.2, 3.3, 3.1, 3.4,  3.0, 3.5, 3.2, 3.3,  4.7, 4.6, 2.0, 2.1]
const players = generatePlayers({ n_players: 12, courts: 3, rounds: 5, pvna_distribution: 'wide', gender_ratio: 0.5, gender_pref_rate: 0, group_count: 0, group_size_range: [0, 0], use_corrector: true, seed: 1 } as any, seedrandom('cf'))
players.forEach((p, i) => { p.pvna = PVNA[i]; (p as any).effective_pvna = PVNA[i] })
const state: SessionState = initState(players, { courts: 3, pvna_tolerance: 0.5 })
const ids = [...state.players.keys()]
const A = ids[8], B = ids[9]
// A & B đã đối đầu 2 lần → trận này là lần 3
state.players.get(A)!.opponent_counts.set(B, 2)
state.players.get(B)!.opponent_counts.set(A, 2)

const liveRows: SessionLiveMatchRow[] = [
  { id: 'l0', session_id: state.session_id, sequence_no: 0, round_no: 1, cycle_no: 1, court_idx: 0, status: 'live', team_a: [ids[0], ids[1]] as any, team_b: [ids[2], ids[3]] as any, resting: [], score_a: 0, score_b: 0, suggested_at: new Date(0).toISOString(), started_at: new Date(0).toISOString(), ended_at: null },
  { id: 'l1', session_id: state.session_id, sequence_no: 1, round_no: 1, cycle_no: 1, court_idx: 1, status: 'live', team_a: [ids[4], ids[5]] as any, team_b: [ids[6], ids[7]] as any, resting: [], score_a: 0, score_b: 0, suggested_at: new Date(0).toISOString(), started_at: new Date(0).toISOString(), ended_at: null },
]

const out = buildSuggestedMatchPayloads({
  count: 1, sessionId: state.session_id, courtCount: 3, state,
  rows: { liveMatchRows: liveRows, liveStateVersion: 2 },
  completingLiveMatchIds: new Set(),
  fairnessAdjustment: correctForFairness(state),
  fairnessWarnings: detectFairnessIssues(state),
  playersById: new Map(ids.map((id, i) => [id, { name: `P${i}` }])),
  pvnaTolerance: 0.5,
  options: { courtIdxs: [2], deferExtremeTightPool: true, blowoutRescue: true } as any,
})
const m = out[0]
console.log('seated:', m ? [...m.team_a, ...m.team_b].map(id => `P${ids.indexOf(id)}`).join(' ') : 'RỖNG')
console.log('degraded_reason:', m?.degraded_reason)
console.log('explanations:', JSON.stringify(m?.match_explanations, null, 0))
