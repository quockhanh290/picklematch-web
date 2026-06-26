/**
 * Large-pool simulation: 40 players, 10 courts, strict gender prefs.
 *
 * Reproduces the "board-stuck" scenario (algorithm phase #3): with strict
 * partner/opponent gender preferences the engine must fill 10 courts from
 * 40 players — a pool dense enough to trigger constraint relaxation paths.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/simulate-40-player-session.ts
 *   npx tsx scripts/diagnostics/simulate-40-player-session.ts --rounds=12
 */
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { PlayerSessionState, ScoringWeights, SessionState } from '@/lib/next-round-suggester/types'

// 40 players: [name, pvna, gender, partnerPref, opponentPref]
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

const WEIGHTS: ScoringWeights = {
  pvna: 100,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
  consecutive_play: 0,
}

const ROUNDS = Number(process.argv.find(a => a.startsWith('--rounds='))?.slice('--rounds='.length) ?? 7)

function makePlayer([name, pvna, gender, partner_gender_pref, opponent_gender_pref]: typeof ROWS[number]): PlayerSessionState {
  return {
    player_id: name,
    pvna,
    gender,
    partner_gender_pref,
    opponent_gender_pref,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00Z'),
    checked_out_at: null,
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

function makeState(players: PlayerSessionState[], roundNo: number, rounds: SessionState['rounds']): SessionState {
  return {
    session_id: 'sim-40-player-synthetic',
    current_round: roundNo,
    status: 'active',
    config: { courts: 10, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(players.map(p => [p.player_id, p])),
    rounds,
  }
}

function prefLabel(p: PlayerSessionState) {
  return `${p.player_id}(${p.gender};P:${p.partner_gender_pref};O:${p.opponent_gender_pref})`
}

console.log(`sim-40-player: players=40, courts=10, rounds=${ROUNDS}`)
console.log(`Gender: F=${ROWS.filter(r => r[2] === 'F').length}, M=${ROWS.filter(r => r[2] === 'M').length}`)

let players = ROWS.map(makePlayer)
let rounds: SessionState['rounds'] = []

for (let roundNo = 0; roundNo < ROUNDS; roundNo++) {
  const state = makeState(players, roundNo, rounds)
  const result = suggestNextRound(state)
  const alt = result.alternatives[0]

  if (!alt) {
    console.log(`\nROUND ${roundNo} | NO ALTERNATIVE | warnings=${result.warnings.join('; ')}`)
    break
  }

  const s = alt.stats
  const tradeoffs = alt.tradeoffs?.map(t => t.type).join(',') ?? '-'
  console.log(`\nROUND ${roundNo} | score=${alt.score.toFixed(1)} | pvna=${s.pvna_diff.toFixed(2)} | PR=${s.partner_repeats} | OR=${s.opponent_repeats} | G=${s.gender_pref_penalty.toFixed(1)} | rest=${alt.resting.join(',') || '-'} | tradeoffs=${tradeoffs}`)
  for (const m of alt.matches) {
    const ms = m.stats
    const ta = m.team_a.map(id => prefLabel(state.players.get(id)!)).join('/')
    const tb = m.team_b.map(id => prefLabel(state.players.get(id)!)).join('/')
    console.log(`  S${m.court_idx + 1}: ${ta} vs ${tb} | pvna=${ms?.pvna_diff?.toFixed(2)} PR=${ms?.partner_repeats} OR=${ms?.opponent_repeats} G=${ms?.gender_pref_penalty?.toFixed(1)}`)
  }

  const committed = commitCompletedRound(state, { round_no: roundNo, matches: alt.matches, resting: alt.resting })
  players = [...committed.players.values()]
  rounds = [...rounds, {
    id: `round-${roundNo}`,
    session_id: 'sim-40-player-synthetic',
    round_no: roundNo,
    status: 'completed',
    matches: alt.matches,
    resting: alt.resting,
    started_at: new Date(),
    ended_at: new Date(),
  }]
}

const vals = players.map(p => p.matches_played)
const pairRows = (() => {
  const state = makeState(players, rounds.length, rounds)
  const map = new Map<string, { partner_count: number; opponent_count: number }>()
  for (const p of players) {
    for (const [other, cnt] of p.partner_counts) {
      const key = [p.player_id, other].sort().join('|')
      const e = map.get(key) ?? { partner_count: 0, opponent_count: 0 }
      e.partner_count = Math.max(e.partner_count, cnt)
      map.set(key, e)
    }
    for (const [other, cnt] of p.opponent_counts) {
      const key = [p.player_id, other].sort().join('|')
      const e = map.get(key) ?? { partner_count: 0, opponent_count: 0 }
      e.opponent_count = Math.max(e.opponent_count, cnt)
      map.set(key, e)
    }
  }
  void state
  return [...map.values()]
})()

const pRepeat = pairRows.filter(r => r.partner_count > 1).length
const oRepeat = pairRows.filter(r => r.opponent_count > 1).length

console.log('\nSUMMARY')
console.log(`matches min/max/avg=${Math.min(...vals)}/${Math.max(...vals)}/${(vals.reduce((s,v) => s+v,0)/vals.length).toFixed(2)}`)
console.log(`partner repeat pairs=${pRepeat}, opponent repeat pairs=${oRepeat}`)
console.log('by player: ' + players.sort((a, b) => a.matches_played - b.matches_played || a.player_id.localeCompare(b.player_id)).map(p => `${p.player_id}:${p.matches_played}`).join(' '))
