// Bench: shared force_budget_deadline across 3 courts — total must stay under cap.
// Simulates buildSuggestedMatchPayloads calling suggestNextRound for 3 consecutive hard courts.
// Run: npx tsx scratch/bench-shared-force-deadline.ts
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import { DEFAULT_SCORING_WEIGHTS } from '../lib/next-round-suggester/state'
import type { PlayerSessionState, SessionState } from '../lib/next-round-suggester/types'

function makePlayer(i: number, pvna: number, gender: 'M' | 'F', restCount = 0): PlayerSessionState {
  const p: PlayerSessionState = {
    player_id: `p${i}`,
    pvna,
    gender,
    group_id: null,
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
    checked_in_at: new Date(0),
    checked_out_at: null,
    opted_rest: false,
    matches_played: 5,
    consecutive_rest: restCount,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    rounds_rested: 0,
    rounds_available: 8,
    effective_pvna: null,
  }
  // Pre-fill pair counts so overflow kicks in and regular passes struggle
  return p
}

// 48 players: tight PVNA, all pairs used 3× — regular passes fail fast, force pass triggers
const players = new Map<string, PlayerSessionState>()
for (let i = 0; i < 48; i++) {
  const p = makePlayer(i, 1 + (i % 10) * 0.5, i % 3 === 0 ? 'F' : 'M', i < 4 ? 1 : 0)
  players.set(p.player_id, p)
}
players.forEach((p, id) => {
  players.forEach((_, otherId) => {
    if (id !== otherId) {
      p.partner_counts.set(otherId, 3)
      p.opponent_counts.set(otherId, 3)
    }
  })
})

function makeState(): SessionState {
  return {
    session_id: 'bench',
    config: {
      courts: 1,
      pvna_tolerance: 0.1,
      planned_total_rounds: undefined,
      court_preset: 'balanced',
      avoid_pairs: [],
      weights: DEFAULT_SCORING_WEIGHTS,
    },
    players: new Map(players),
    rounds: [{ status: 'completed', matches: [], round_no: 1, id: 'r1', resting: [] }],
  }
}

const COURTS = 3
const FORCE_RESCUE_TOTAL_MS = 2000
const MAIN_BUDGET_PER_COURT = 900
const TOTAL_CAP = COURTS * MAIN_BUDGET_PER_COURT + FORCE_RESCUE_TOTAL_MS

console.log(`Simulating ${COURTS} consecutive hard courts — total cap: ${TOTAL_CAP}ms`)
console.log(`(${COURTS} × ${MAIN_BUDGET_PER_COURT}ms main + ${FORCE_RESCUE_TOTAL_MS}ms shared force)`)

let grandTotal = 0

for (let rep = 0; rep < 2; rep++) {
  const batchStart = Date.now()
  const forceBudgetDeadline = batchStart + FORCE_RESCUE_TOTAL_MS
  let batchMs = 0

  for (let court = 0; court < COURTS; court++) {
    const t0 = Date.now()
    const state = makeState()
    const result = suggestNextRound(state, {
      max_runtime_ms: MAIN_BUDGET_PER_COURT,
      force_budget_deadline: forceBudgetDeadline,
    })
    const elapsed = Date.now() - t0
    batchMs += elapsed
    console.log(`  rep ${rep + 1} court ${court + 1}: ${elapsed}ms  alts=${result.alternatives.length}`)
  }
  grandTotal = Math.max(grandTotal, batchMs)
  console.log(`  rep ${rep + 1} batch total: ${batchMs}ms vs cap ${TOTAL_CAP}ms: ${batchMs < TOTAL_CAP ? '✓' : '✗'}`)
}

console.log(`\nWorst batch: ${grandTotal}ms  cap: ${TOTAL_CAP}ms`)
if (grandTotal < TOTAL_CAP) {
  console.log('✓ PASS: shared deadline working — total within cap')
} else {
  console.error('✗ FAIL: over cap — shared deadline not working')
  process.exit(1)
}
