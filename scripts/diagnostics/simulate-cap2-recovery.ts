/**
 * Simulates the production cap-2 edge flow for large pools.
 *
 * Production constraint: each call to buildSuggestedMatchPayloads has count=2
 * (edge function fills at most 2 courts per call). The client calls repeatedly,
 * feeding previous payloads back as liveMatchRowsOverride with status='suggested'.
 *
 * This script measures whether the engine fills the full board across the
 * cap-2 recovery chain — without ever increasing LIVE_PREVIEW_BATCH_TIMEOUT_MS.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/simulate-cap2-recovery.ts
 *   npx tsx scripts/diagnostics/simulate-cap2-recovery.ts --courts=6
 *   npx tsx scripts/diagnostics/simulate-cap2-recovery.ts --courts=6 --rounds=7
 */
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import {
  buildSuggestedMatchPayloads,
  isRecentSuggestedLiveMatch,
} from '@/lib/next-round-suggester/live-preview'
import type {
  PlayerSessionState,
  ScoringWeights,
  SessionLiveMatchRow,
  SessionState,
} from '@/lib/next-round-suggester/types'
import type { SuggestedMatchPayload } from '@/lib/next-round-suggester/live-preview'

// ── roster ────────────────────────────────────────────────────────────────────

const ROWS: [string, number, 'M' | 'F', 'M' | 'F' | 'any', 'M' | 'F' | 'any'][] = [
  ['P12', 3.12, 'F', 'F', 'F'],   ['P8',  2.92, 'F', 'any', 'F'],
  ['P30', 4.06, 'F', 'F', 'any'], ['P40', 2.58, 'F', 'M', 'F'],
  ['P26', 3.85, 'F', 'any', 'any'],['P7',  2.86, 'M', 'F', 'any'],
  ['P32', 4.16, 'F', 'any', 'F'], ['P13', 3.18, 'M', 'F', 'F'],
  ['P3',  2.66, 'M', 'M', 'any'], ['P31', 4.11, 'M', 'F', 'any'],
  ['P15', 3.28, 'M', 'M', 'any'], ['P36', 4.37, 'F', 'F', 'F'],
  ['P24', 3.75, 'F', 'F', 'F'],   ['P16', 3.33, 'F', 'M', 'F'],
  ['P34', 4.27, 'F', 'M', 'any'], ['P2',  2.60, 'F', 'any', 'any'],
  ['P27', 3.90, 'M', 'M', 'any'], ['P39', 2.53, 'M', 'M', 'any'],
  ['P9',  2.97, 'M', 'M', 'F'],   ['P28', 3.96, 'F', 'M', 'F'],
  ['P14', 3.23, 'F', 'any', 'any'],['P29', 4.01, 'M', 'any', 'F'],
  ['P19', 3.49, 'M', 'F', 'any'], ['P22', 3.64, 'F', 'M', 'any'],
  ['P10', 3.02, 'F', 'M', 'any'], ['P18', 3.44, 'F', 'F', 'any'],
  ['P1',  2.55, 'M', 'F', 'F'],   ['P33', 4.22, 'M', 'M', 'F'],
  ['P11', 3.07, 'M', 'any', 'any'],['P4',  2.71, 'F', 'M', 'F'],
  ['P37', 4.42, 'M', 'F', 'F'],   ['P35', 4.32, 'M', 'any', 'any'],
  ['P5',  2.76, 'M', 'any', 'F'], ['P23', 3.70, 'M', 'any', 'any'],
  ['P6',  2.81, 'F', 'F', 'any'], ['P25', 3.80, 'M', 'F', 'F'],
  ['P38', 4.48, 'F', 'any', 'any'],['P20', 3.54, 'F', 'any', 'F'],
  ['P21', 3.59, 'M', 'M', 'F'],   ['P17', 3.38, 'M', 'any', 'F'],
]

const WEIGHTS: ScoringWeights = {
  pvna: 100, partner_repeat: 3, opponent_repeat: 1.5,
  group_bonus: 0.5, partner_gender_pref: 4, opponent_gender_pref: 2, consecutive_play: 0,
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const arg = (name: string, def: number) =>
  Number(process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def)
const COURTS = arg('courts', 10)
const ROUNDS = arg('rounds', 7)
const CAP   = arg('cap', 2)  // edge cap per call

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer([name, pvna, gender, pp, op]: typeof ROWS[number]): PlayerSessionState {
  return {
    player_id: name, pvna, gender,
    partner_gender_pref: pp, opponent_gender_pref: op,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00Z'),
    checked_out_at: null,
    matches_played: 0, last_played_round: -1,
    consecutive_rest: 0, consecutive_play: 0,
    partner_counts: new Map(), opponent_counts: new Map(),
    opted_rest: false, rounds_available: 99,
  }
}

function makeState(players: PlayerSessionState[], roundNo: number, rounds: SessionState['rounds']): SessionState {
  return {
    session_id: 'sim-cap2-synthetic',
    current_round: roundNo,
    status: 'active',
    config: { courts: COURTS, pvna_tolerance: 0.5, weights: WEIGHTS },
    players: new Map(players.map(p => [p.player_id, p])),
    rounds,
  }
}

function payloadToSuggestedRow(
  payload: SuggestedMatchPayload,
  seqNo: number,
  suggestedAt: string,
  roundNo: number,
): SessionLiveMatchRow {
  return {
    id: `sim-suggested-court-${payload.court_idx}-seq-${seqNo}`,
    session_id: 'sim-cap2-synthetic',
    sequence_no: seqNo,
    // Must match the actual session round (not payload.round_no which can be 0 due to drift).
    // repairRoundOnePayloadBatchWithCleanPool only runs when round_no===0; using the real round
    // number prevents it from re-picking already-busy players on rounds 1+.
    round_no: roundNo,
    court_idx: payload.court_idx,
    status: 'suggested',
    team_a: payload.team_a,
    team_b: payload.team_b,
    resting: payload.resting ?? [],
    score_a: 0,
    score_b: 0,
    suggested_at: suggestedAt,
    started_at: null,
    ended_at: null,
  }
}

function verifyNoDoubleBook(suggestedRows: SessionLiveMatchRow[]): string[] {
  const seen = new Map<string, number>()
  const errors: string[] = []
  for (const row of suggestedRows) {
    for (const id of [...row.team_a, ...row.team_b]) {
      const prev = seen.get(id)
      if (prev !== undefined) errors.push(`double-book: ${id} in court ${prev} and ${row.court_idx}`)
      else seen.set(id, row.court_idx ?? -1)
    }
  }
  return errors
}

function dumpRow(label: string, row: SessionLiveMatchRow) {
  const players = [...row.team_a, ...row.team_b].join(',')
  console.log(`  ${label} court${row.court_idx} seq${row.sequence_no} rnd${row.round_no} sa=${row.suggested_at?.slice(11,23)} [${players}]`)
}

// ── main ──────────────────────────────────────────────────────────────────────

const playersById = new Map(ROWS.map(([name]) => [name, { name }]))
let players = ROWS.map(makePlayer)
let rounds: SessionState['rounds'] = []
let allPassed = true

console.log(`sim-cap2-recovery: ${ROWS.length} players, ${COURTS} courts, ${ROUNDS} rounds, cap=${CAP}`)

for (let roundNo = 0; roundNo < ROUNDS; roundNo++) {
  const state = makeState(players, roundNo, rounds)
  const suggestedRows: SessionLiveMatchRow[] = []
  const allPayloads: SuggestedMatchPayload[] = []
  let callCount = 0
  let stuck = false

  // Simulate production cap-2 recovery loop
  while (allPayloads.length < COURTS) {
    // All rows from previous calls become 'suggested' override rows
    const suggestedAt = new Date(Date.now() - callCount * 500).toISOString() // stagger by 500ms each call, still within 60s TTL
    const liveMatchRowsOverride = suggestedRows.map((row, i) => ({ ...row, suggested_at: suggestedAt }))

    // Verify the override rows are still recognized as recent (TTL check)
    for (const row of liveMatchRowsOverride) {
      if (!isRecentSuggestedLiveMatch(row)) {
        console.error(`  BUG: suggested row court ${row.court_idx} not recognized as recent (suggested_at=${row.suggested_at})`)
      }
    }

    const remaining = COURTS - allPayloads.length
    const countThisCall = Math.min(CAP, remaining)

    const t0 = Date.now()
    const newPayloads = buildSuggestedMatchPayloads({
      count: countThisCall,
      sessionId: 'sim-cap2-synthetic',
      courtCount: COURTS,
      state,
      rows: { liveMatchRows: liveMatchRowsOverride, liveStateVersion: null },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById,
      pvnaTolerance: 0.5,
      options: { liveMatchRowsOverride },
    })
    const elapsed = Date.now() - t0
    callCount++

    if (newPayloads.length === 0) {
      stuck = true
      break
    }

    // Convert new payloads to suggested rows and append
    const baseSeqNo = suggestedRows.length
    const newRows: SessionLiveMatchRow[] = []
    for (const [i, payload] of newPayloads.entries()) {
      const row = payloadToSuggestedRow(payload, baseSeqNo + i, new Date().toISOString(), roundNo)
      newRows.push(row)
      suggestedRows.push(row)
    }
    allPayloads.push(...newPayloads)

    // Double-book check after each call
    const dbErrors = verifyNoDoubleBook(suggestedRows)
    if (dbErrors.length > 0) {
      console.error(`  DOUBLE-BOOK DETECTED round ${roundNo} call ${callCount}:`, dbErrors)
      console.error('  --- override rows fed to this call ---')
      liveMatchRowsOverride.forEach(r => dumpRow('OVRD', r))
      console.error('  --- new rows returned by engine ---')
      newRows.forEach(r => dumpRow('NEW ', r))
      const overridePlayers = new Set(liveMatchRowsOverride.flatMap(r => [...r.team_a, ...r.team_b]))
      const collisions = newRows.flatMap(r => [...r.team_a, ...r.team_b].filter(id => overridePlayers.has(id)))
      console.error('  --- players in both override AND new (engine double-booked):', collisions)
      allPassed = false
    }

    process.stdout.write(`  call${callCount}(+${newPayloads.length}/${countThisCall} ${elapsed}ms) `)
  }

  const filled = allPayloads.length
  const ok = filled === COURTS && !stuck
  if (!ok) allPassed = false

  const courtList = allPayloads.map(p => `S${p.court_idx! + 1}`).join(',')
  console.log(`\nROUND ${roundNo}: filled ${filled}/${COURTS} courts [${courtList}]${stuck ? ' STUCK' : ''} calls=${callCount}`)

  if (filled === 0) break

  // Commit the round: use the matches from all payloads
  const matchesForCommit = allPayloads.map((p, i) => ({
    court_idx: p.court_idx!,
    team_a: p.team_a,
    team_b: p.team_b,
  }))
  const restingIds = [...new Set(allPayloads.flatMap(p => p.resting ?? []))]
  const committed = commitCompletedRound(state, {
    round_no: roundNo,
    matches: matchesForCommit,
    resting: restingIds,
  })
  players = [...committed.players.values()]
  rounds = [...rounds, {
    id: `round-${roundNo}`,
    session_id: 'sim-cap2-synthetic',
    round_no: roundNo,
    status: 'completed',
    matches: matchesForCommit,
    resting: restingIds,
    started_at: new Date(),
    ended_at: new Date(),
  }]
}

console.log(`\nRESULT: ${allPassed ? 'PASS — production cap-2 fills full board after (a)(b)(c)' : 'FAIL — some rounds stuck, joint fallback needed'}`)
