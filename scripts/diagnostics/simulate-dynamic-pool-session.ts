/**
 * Dynamic-pool simulation: 40-player roster with rolling check-in/check-out,
 * group assignments, and courts varying 4-6 across 7 rounds.
 *
 * Reproduces the "pool co giãn" scenario: late arrivals, mid-session checkout,
 * re-check-in, and group pairing constraints — all in a single run.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/simulate-dynamic-pool-session.ts
 */
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { PlayerSessionState, ScoringWeights, SessionState } from '@/lib/next-round-suggester/types'

// Same 40-player roster as simulate-40-player-session.ts
const ROWS: [string, number, 'M' | 'F', 'M' | 'F' | 'any', 'M' | 'F' | 'any'][] = [
  ['P12', 3.12, 'F', 'F', 'F'],
  ['P8',  2.92, 'F', 'any', 'F'],
  ['P30', 4.06, 'F', 'F', 'any'],
  ['P40', 2.58, 'F', 'M', 'F'],
  ['P26', 3.85, 'F', 'any', 'any'],
  ['P7',  2.86, 'M', 'F', 'any'],
  ['P32', 4.16, 'F', 'any', 'F'],
  ['P13', 3.18, 'M', 'F', 'F'],
  ['P3',  2.66, 'M', 'M', 'any'],
  ['P31', 4.11, 'M', 'F', 'any'],
  ['P15', 3.28, 'M', 'M', 'any'],
  ['P36', 4.37, 'F', 'F', 'F'],
  ['P24', 3.75, 'F', 'F', 'F'],
  ['P16', 3.33, 'F', 'M', 'F'],
  ['P34', 4.27, 'F', 'M', 'any'],
  ['P2',  2.60, 'F', 'any', 'any'],
  ['P27', 3.90, 'M', 'M', 'any'],
  ['P39', 2.53, 'M', 'M', 'any'],
  ['P9',  2.97, 'M', 'M', 'F'],
  ['P28', 3.96, 'F', 'M', 'F'],
  ['P14', 3.23, 'F', 'any', 'any'],
  ['P29', 4.01, 'M', 'any', 'F'],
  ['P19', 3.49, 'M', 'F', 'any'],
  ['P22', 3.64, 'F', 'M', 'any'],
  ['P10', 3.02, 'F', 'M', 'any'],
  ['P18', 3.44, 'F', 'F', 'any'],
  ['P1',  2.55, 'M', 'F', 'F'],
  ['P33', 4.22, 'M', 'M', 'F'],
  ['P11', 3.07, 'M', 'any', 'any'],
  ['P4',  2.71, 'F', 'M', 'F'],
  ['P37', 4.42, 'M', 'F', 'F'],
  ['P35', 4.32, 'M', 'any', 'any'],
  ['P5',  2.76, 'M', 'any', 'F'],
  ['P23', 3.70, 'M', 'any', 'any'],
  ['P6',  2.81, 'F', 'F', 'any'],
  ['P25', 3.80, 'M', 'F', 'F'],
  ['P38', 4.48, 'F', 'any', 'any'],
  ['P20', 3.54, 'F', 'any', 'F'],
  ['P21', 3.59, 'M', 'M', 'F'],
  ['P17', 3.38, 'M', 'any', 'F'],
]

// Rounds: courts vary 4-6, players arrive/leave between rounds
const PLAN: { courts: number; in?: string[]; out?: string[] }[] = [
  { courts: 4, in: ['P1', 'P2', 'P3', 'P4', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P14', 'P16', 'P18', 'P21', 'P23'] },
  { courts: 5, in: ['P24', 'P25', 'P27', 'P28'], out: ['P10'] },
  { courts: 6, in: ['P30', 'P32', 'P37', 'P39', 'P40'], out: ['P7'] },
  { courts: 6, in: ['P10', 'P13', 'P15', 'P17'], out: ['P2', 'P18'] },
  { courts: 5, in: ['P7', 'P19', 'P20', 'P22'], out: ['P4', 'P39'] },
  { courts: 6, in: ['P2', 'P18', 'P26', 'P29', 'P31', 'P33'], out: ['P1'] },
  { courts: 6, in: ['P1', 'P4', 'P34', 'P35', 'P36', 'P38'], out: ['P12', 'P21'] },
]

const GROUP_ASSIGNMENTS: string[][] = [
  ['P1', 'P4'],
  ['P6', 'P12', 'P18'],
  ['P9', 'P21', 'P27'],
  ['P10', 'P16', 'P28'],
  ['P24', 'P30', 'P32'],
  ['P33', 'P35', 'P37'],
  ['P7', 'P22'],
]

const groupByPlayer = new Map<string, string>()
for (const [i, members] of GROUP_ASSIGNMENTS.entries()) {
  const groupId = `g${i + 1}:${members.join(':')}`
  for (const m of members) groupByPlayer.set(m, groupId)
}

const WEIGHTS: ScoringWeights = {
  pvna: 100,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
  consecutive_play: 0,
}

function makePlayer([name, pvna, gender, partner_gender_pref, opponent_gender_pref]: typeof ROWS[number]): PlayerSessionState {
  return {
    player_id: name,
    pvna,
    gender,
    partner_gender_pref,
    opponent_gender_pref,
    group_id: groupByPlayer.get(name) ?? null,
    checked_in_at: new Date('2026-05-14T11:59:00Z'),
    checked_out_at: new Date('2026-05-14T11:59:00Z'), // all start checked-out; plan.in adds them
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    rounds_available: 99,
  }
}

function applyEvents(players: PlayerSessionState[], step: typeof PLAN[number], roundNo: number): PlayerSessionState[] {
  const now = new Date(`2026-05-14T12:${String(roundNo).padStart(2, '0')}:00Z`)
  const inSet = new Set(step.in ?? [])
  const outSet = new Set(step.out ?? [])
  return players.map(p => {
    if (inSet.has(p.player_id)) return { ...p, checked_in_at: now, checked_out_at: null, opted_rest: false }
    if (outSet.has(p.player_id)) return { ...p, checked_out_at: now, opted_rest: false }
    return p
  })
}

function makeState(players: PlayerSessionState[], courts: number, roundNo: number, rounds: SessionState['rounds']): SessionState {
  return {
    session_id: 'sim-dynamic-pool-synthetic',
    current_round: roundNo,
    status: 'active',
    config: { courts, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(players.map(p => [p.player_id, p])),
    rounds,
  }
}

console.log('sim-dynamic-pool: rolling check-in/out, groups, courts 4-6')
console.log(`Groups: ${GROUP_ASSIGNMENTS.map((m, i) => `g${i + 1}=${m.join('/')}`).join(' | ')}`)

let players = ROWS.map(makePlayer)
let rounds: SessionState['rounds'] = []

for (let roundNo = 0; roundNo < PLAN.length; roundNo++) {
  const step = PLAN[roundNo]
  players = applyEvents(players, step, roundNo)
  const present = players.filter(p => p.checked_out_at === null)
  const state = makeState(players, step.courts, roundNo, rounds)
  const result = suggestNextRound(state)
  const alt = result.alternatives[0]

  const inList = (step.in ?? []).join(',') || '-'
  const outList = (step.out ?? []).join(',') || '-'
  console.log(`\nROUND ${roundNo} | courts=${step.courts} | present=${present.length} | in=${inList} | out=${outList}`)

  if (!alt) {
    console.log(`  NO MATCH | warnings=${result.warnings.join('; ')}`)
    continue
  }

  const s = alt.stats
  const tradeoffs = alt.tradeoffs?.map(t => t.type).join(',') ?? '-'
  console.log(`  score=${alt.score.toFixed(1)} pvna=${s.pvna_diff.toFixed(2)} PR=${s.partner_repeats} OR=${s.opponent_repeats} G=${s.gender_pref_penalty.toFixed(1)} rest=${alt.resting.join(',') || '-'} tradeoffs=${tradeoffs}`)
  for (const m of alt.matches) {
    const ms = m.stats
    const ta = m.team_a.map(id => {
      const p = state.players.get(id)!
      const g = groupByPlayer.get(id) ? groupByPlayer.get(id)!.split(':')[0] : '-'
      return `${id}(${p.gender};P:${p.partner_gender_pref};O:${p.opponent_gender_pref};G:${g})`
    }).join('/')
    const tb = m.team_b.map(id => {
      const p = state.players.get(id)!
      const g = groupByPlayer.get(id) ? groupByPlayer.get(id)!.split(':')[0] : '-'
      return `${id}(${p.gender};P:${p.partner_gender_pref};O:${p.opponent_gender_pref};G:${g})`
    }).join('/')
    console.log(`  S${m.court_idx + 1}: ${ta} vs ${tb} | pvna=${ms?.pvna_diff?.toFixed(2)} PR=${ms?.partner_repeats} OR=${ms?.opponent_repeats} G=${ms?.gender_pref_penalty?.toFixed(1)}`)
  }

  const committed = commitCompletedRound(state, { round_no: roundNo, matches: alt.matches, resting: alt.resting })
  players = [...committed.players.values()]
  rounds = [...rounds, {
    id: `round-${roundNo}`,
    session_id: 'sim-dynamic-pool-synthetic',
    round_no: roundNo,
    status: 'completed',
    matches: alt.matches,
    resting: alt.resting,
    started_at: new Date(),
    ended_at: new Date(),
  }]
}

const active = players.filter(p => p.checked_out_at === null)
const vals = players.map(p => p.matches_played)
const activeVals = active.map(p => p.matches_played)

console.log('\nSUMMARY')
console.log(`all players min/max=${Math.min(...vals)}/${Math.max(...vals)}`)
console.log(`active players min/max=${Math.min(...activeVals)}/${Math.max(...activeVals)}, active=${active.length}`)
console.log(players.sort((a, b) => a.matches_played - b.matches_played || a.player_id.localeCompare(b.player_id))
  .map(p => `${p.player_id}:${p.matches_played}${p.checked_out_at ? '(out)' : ''}`).join(' '))
