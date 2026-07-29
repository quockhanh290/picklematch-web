import seedrandom from 'seedrandom'
import { correctForFairness } from '../../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads } from '../../lib/next-round-suggester/live-preview'
import { getEffectivePvna } from '../../lib/next-round-suggester/state'
import type { SessionLiveMatchRow, SessionState, Team } from '../../lib/next-round-suggester/types'
import { generatePlayers, initState } from '../../tests/next-round-suggester/simulation/generators'

// 12 players, 3 courts. Force a skewed available pool for court 2.
const PVNA = [3.2, 3.3, 3.1, 3.4,   3.0, 3.5, 3.2, 3.3,   4.8, 4.6, 4.7, 2.0]
//            court0 live (mid)      court1 live (mid)     court2 available (3 high + 1 low → blowout)

const rng = seedrandom('forced')
const players = generatePlayers({ n_players: 12, courts: 3, rounds: 5, pvna_distribution: 'wide', gender_ratio: 0.5, gender_pref_rate: 0, group_count: 0, group_size_range: [0, 0], use_corrector: true, seed: 1 } as any, rng)
players.forEach((p, i) => { p.pvna = PVNA[i]; (p as any).effective_pvna = PVNA[i] })
const state: SessionState = initState(players, { courts: 3, pvna_tolerance: 0.5 })
const ids = [...state.players.keys()]

const liveRows: SessionLiveMatchRow[] = [
  { id: 'live-0', session_id: state.session_id, sequence_no: 0, round_no: 1, cycle_no: 1, court_idx: 0, status: 'live', team_a: [ids[0], ids[1]] as any, team_b: [ids[2], ids[3]] as any, resting: [], score_a: 0, score_b: 0, suggested_at: new Date(0).toISOString(), started_at: new Date(0).toISOString(), ended_at: null },
  { id: 'live-1', session_id: state.session_id, sequence_no: 1, round_no: 1, cycle_no: 1, court_idx: 1, status: 'live', team_a: [ids[4], ids[5]] as any, team_b: [ids[6], ids[7]] as any, resting: [], score_a: 0, score_b: 0, suggested_at: new Date(0).toISOString(), started_at: new Date(0).toISOString(), ended_at: null },
]

function build(blowoutRescue: boolean) {
  return buildSuggestedMatchPayloads({
    count: 1, sessionId: state.session_id, courtCount: 3, state,
    rows: { liveMatchRows: liveRows, liveStateVersion: 2 },
    completingLiveMatchIds: new Set(),
    fairnessAdjustment: correctForFairness(state),
    fairnessWarnings: detectFairnessIssues(state),
    playersById: new Map(ids.map(id => [id, { name: id.slice(0, 4) }])),
    pvnaTolerance: 0.5,
    options: { courtIdxs: [2], deferExtremeTightPool: true, blowoutRescue } as any,
  })
}

const gap = (tA: Team, tB: Team) => {
  const p = (id: string) => { const pl = state.players.get(id); return pl ? getEffectivePvna(pl) : 0 }
  return Math.abs(p(tA[0]) + p(tA[1]) - p(tB[0]) - p(tB[1]))
}

const off = build(false)
const on = build(true)
console.log('OFF (defer cũ):', off.length === 0 ? 'DEFER (rỗng) ✓' : `seated gap=${gap(off[0].team_a as Team, off[0].team_b as Team).toFixed(2)}`)
if (on[0]) {
  const m = on[0]
  console.log('ON  (rescue):  seated gap=' + gap(m.team_a as Team, m.team_b as Team).toFixed(2), '| degraded_reason=' + m.degraded_reason, '| rescue_court_idxs=' + JSON.stringify(m.rescue_court_idxs))
} else {
  console.log('ON: rỗng (KHÔNG seat — SAI)')
}

// DEBUG: manually free court 0 (mid players) and re-suggest court 2
import { suggestNextMatch } from '../../lib/next-round-suggester/suggest'
const court0 = [ids[0], ids[1], ids[2], ids[3]]
const court1 = [ids[4], ids[5], ids[6], ids[7]]
// busy = all locked (court0+court1). Free court0 => busy = court1 only
const busyFreeCourt0 = new Set(court1)
const rescueRes = suggestNextMatch(state, { busy_player_ids: [...busyFreeCourt0], court_idx: 2 })
const rm = rescueRes.alternatives?.[0]?.matches?.[0]
if (rm) {
  console.log('\nDEBUG free-court0 → court2:', [...rm.team_a, ...rm.team_b].map(id => id.slice(0,4)+'('+getEffectivePvna(state.players.get(id)!).toFixed(1)+')').join(' '),
    '| gap=' + gap(rm.team_a as Team, rm.team_b as Team).toFixed(2),
    '| dùng court0?=' + [...rm.team_a, ...rm.team_b].some(id => court0.includes(id)))
} else { console.log('\nDEBUG free-court0 → court2: RỖNG') }

console.log('\nmatch_explanations (ON):', JSON.stringify(on[0]?.match_explanations, null, 0))
