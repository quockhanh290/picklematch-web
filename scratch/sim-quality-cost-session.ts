/* Local end-to-end "watch the new engine play a NEW session" — ZERO deploy, ZERO prod, deterministic.
   Simulates a fresh session through the production buildSuggestedMatchPayloads path in FULL-BOARD mode
   (count = courts each round) so the joint pass (≥2 courts) actually fires, and compares the CURRENT
   engine (flag OFF) vs the QUALITY-COST + JOINT engine (flag ON) round by round.
   Run: npx tsx scratch/sim-quality-cost-session.ts [nPlayers] [courts] [rounds] [seed]  */
import seedrandom from 'seedrandom'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import {
  buildProjectedStateAfterLiveMatch,
  buildProjectedStateAfterCompletedLiveRound,
  buildSuggestedMatchPayloads,
  type SuggestedMatchPayload,
} from '../lib/next-round-suggester/live-preview'
import { getProjectedRepeatSummary } from '../lib/next-round-suggester/score'
import { getEffectivePvna } from '../lib/next-round-suggester/state'
import { __setQualityCostModelOverrideForTests } from '../lib/next-round-suggester/quality-cost-flag'
import { generatePlayers, initState } from '../tests/next-round-suggester/simulation/generators'
import type { SessionLiveMatchRow, SessionState, Team } from '../lib/next-round-suggester/types'

const N = Number(process.argv[2] ?? 24)
const COURTS = Number(process.argv[3] ?? 5)
const ROUNDS = Number(process.argv[4] ?? 8)
const SEED = process.argv[5] ?? 'newsession-1'
const REFILL = Number(process.argv[6] ?? 2) // courts completing together per refill (>=2 → joint pass eligible)
const TOL = 0.5

// silence the drift monitor for clean output
const _warn = console.warn
console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].includes('drift monitor')) return; _warn(...a) }

function freshPlayers() {
  return generatePlayers(
    { n_players: N, pvna_distribution: 'bimodal', gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] },
    seedrandom(SEED),
  )
}

function asLive(p: SuggestedMatchPayload, sessionId: string, seq: number, round: number, status: 'live' | 'completed'): SessionLiveMatchRow {
  const ts = new Date(seq * 1000).toISOString()
  return {
    id: `m-${seq}`, session_id: sessionId, sequence_no: seq, round_no: round, cycle_no: round,
    court_idx: p.court_idx, status, team_a: p.team_a, team_b: p.team_b, resting: p.resting,
    score_a: 0, score_b: 0, suggested_at: ts, started_at: ts, ended_at: status === 'completed' ? ts : null,
  }
}

type RoundMetric = { gap: number; blow: number; rep3: number; intra: number; matches: number }
type SessionResult = { perRound: RoundMetric[]; jointFires: number; boards: { round: number; lines: string[] }[]; noValid: number; finalSpread: number }

function runSession(flagOn: boolean, sampleRounds: number[]): SessionResult {
  __setQualityCostModelOverrideForTests(flagOn)
  try {
    let state = initState(freshPlayers(), { courts: COURTS, pvna_tolerance: TOL })
    const pv = (id: string) => getEffectivePvna(state.players.get(id)!)
    const nm = (id: string) => id
    let jointFires = 0, noValid = 0, seq = 0
    const perRound: RoundMetric[] = []
    const boards: { round: number; lines: string[] }[] = []

    const instr = ((e: unknown) => { if (String(e) === 'joint') jointFires++ }) as never
    const baseOpts = {
      ignoreCapacityLock: true, deferExtremeTightPool: true, blowoutRescue: true,
      rollingHorizon: false, rollingPlanTarget: null, onInstrumentEvent: instr,
    }
    const scoreBoard = (board: SuggestedMatchPayload[], round: number, record: boolean) => {
      let gap = 0, blow = 0, rep3 = 0, intra = 0
      const lines: string[] = []
      for (const m of board) {
        const a = m.team_a as Team, b = m.team_b as Team
        const g = Math.abs(pv(a[0]) + pv(a[1]) - pv(b[0]) - pv(b[1])); gap += g; if (g > 1.5) blow++
        const iv = Math.max(Math.abs(pv(a[0]) - pv(a[1])), Math.abs(pv(b[0]) - pv(b[1]))); if (iv > 1.0) intra++
        const pr = getProjectedRepeatSummary(a, b, state)
        const maxMeet = Math.max(pr.max_opponent_pair_count, pr.max_partner_pair_count); if (maxMeet >= 3) rep3++
        if (record) {
          const fmtT = (t: Team) => t.map(id => `${nm(id)}·${pv(id).toFixed(1)}`).join(' ')
          lines.push(`  c${m.court_idx} gap ${g.toFixed(2)}${g > 1.5 ? ' ⚠BLOW' : ''}${maxMeet >= 3 ? ` rep${maxMeet}` : ''}${iv > 1 ? ' stack' : ''}  [${fmtT(a)}] v [${fmtT(b)}]`)
        }
      }
      perRound.push({ gap: +gap.toFixed(2), blow, rep3, intra, matches: board.length })
      if (record) boards.push({ round, lines })
    }
    const completeInto = (board: SuggestedMatchPayload[], round: number, liveRows: SessionLiveMatchRow[]) => {
      const batch = new Set<string>()
      for (const m of board) {
        const completed = asLive(m, state.session_id, seq++, round, 'completed')
        state = buildProjectedStateAfterLiveMatch(state, completed, round)
        ;[...m.team_a, ...m.team_b].forEach(id => batch.add(id))
        const idx = liveRows.findIndex(r => r.court_idx === m.court_idx)
        if (idx >= 0) liveRows.splice(idx, 1)
      }
      return batch
    }

    // Seed a full live board, then do MULTI-COURT rolling refills (count=REFILL) — the production moment
    // where the joint pass is eligible. Each refill completes REFILL live courts together and refills them
    // in ONE request, exactly like ≥2 courts finishing near-simultaneously.
    let liveRows: SessionLiveMatchRow[] = []
    const initialBoard = buildSuggestedMatchPayloads({
      count: COURTS, sessionId: state.session_id, courtCount: COURTS, state,
      rows: { liveMatchRows: [], liveStateVersion: 0 }, completingLiveMatchIds: new Set(),
      fairnessAdjustment: correctForFairness(state), fairnessWarnings: detectFairnessIssues(state),
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
      pvnaTolerance: TOL, options: baseOpts as never,
    })
    initialBoard.forEach(m => liveRows.push(asLive(m, state.session_id, seq++, 0, 'live')))

    for (let round = 1; round <= ROUNDS; round++) {
      // pick REFILL live courts (lowest court_idx first for determinism), complete + refill them jointly
      const liveCourts = liveRows.filter(r => r.status === 'live').map(r => r.court_idx).sort((x, y) => x - y)
      const targets = liveCourts.slice(0, REFILL)
      if (targets.length < 2) break
      const completing = targets.map(ci => liveRows.find(r => r.status === 'live' && r.court_idx === ci)!)
      completeInto(completing.map(r => ({ court_idx: r.court_idx, team_a: r.team_a, team_b: r.team_b, resting: r.resting } as SuggestedMatchPayload)), round, liveRows)

      const refill = buildSuggestedMatchPayloads({
        count: targets.length, sessionId: state.session_id, courtCount: COURTS, state,
        rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length }, completingLiveMatchIds: new Set(),
        fairnessAdjustment: correctForFairness(state), fairnessWarnings: detectFairnessIssues(state),
        playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
        pvnaTolerance: TOL, options: { ...baseOpts, courtIdxs: targets } as never,
      })
      // record the REFILL board (the multi-court moment joint acts on); use COURTS-agnostic short-board check
      const beforeNoValid = noValid; scoreBoard(refill, round, sampleRounds.includes(round))
      if (refill.length < targets.length) noValid = beforeNoValid + 1; else noValid = beforeNoValid
      refill.forEach(m => liveRows.push(asLive(m, state.session_id, seq++, round, 'live')))
    }

    const played = [...state.players.values()].map(p => p.matches_played)
    const finalSpread = Math.max(...played) - Math.min(...played)
    return { perRound, jointFires, boards, noValid, finalSpread }
  } finally {
    __setQualityCostModelOverrideForTests(null)
  }
}

const sample = [2, Math.floor(ROUNDS / 2), ROUNDS - 1]
const off = runSession(false, [])
const on = runSession(true, sample)

console.log(`\n=== NEW SESSION sim · ${N}p / ${COURTS}c / ${ROUNDS} rounds · seed=${SEED} · rolling ${REFILL}-court refills (joint-eligible) ===`)
console.log(`(local engine only — no Supabase, no deploy, deterministic)\n`)

console.log('── Per-round quality: gap(sum) blow rep≥3 stack ──')
console.log('rnd | OFF gap  bl rp st | ON  gap  bl rp st')
for (let r = 0; r < ROUNDS; r++) {
  const o = off.perRound[r], n = on.perRound[r]
  console.log(`${String(r + 1).padStart(3)} | ${o.gap.toFixed(2).padStart(7)} ${String(o.blow).padStart(2)} ${String(o.rep3).padStart(2)} ${String(o.intra).padStart(2)} | ${n.gap.toFixed(2).padStart(7)} ${String(n.blow).padStart(2)} ${String(n.rep3).padStart(2)} ${String(n.intra).padStart(2)}`)
}
const sum = (arr: RoundMetric[], k: keyof RoundMetric) => arr.reduce((s, m) => s + (m[k] as number), 0)
console.log('─'.repeat(48))
console.log(`SUM |  OFF blow=${sum(off.perRound, 'blow')} rep≥3=${sum(off.perRound, 'rep3')} stack=${sum(off.perRound, 'intra')} gapAvg=${(sum(off.perRound, 'gap') / ROUNDS).toFixed(2)}`)
console.log(`    |  ON  blow=${sum(on.perRound, 'blow')} rep≥3=${sum(on.perRound, 'rep3')} stack=${sum(on.perRound, 'intra')} gapAvg=${(sum(on.perRound, 'gap') / ROUNDS).toFixed(2)}`)
console.log(`\njoint pass fired: ${on.jointFires} time(s)   |   rest fairness (played spread): OFF ${off.finalSpread}  ON ${on.finalSpread}   |   short boards (NO_VALID): OFF ${off.noValid}  ON ${on.noValid}`)

console.log(`\n── Sample boards the host would SEE with the NEW engine (flag ON) ──`)
for (const b of on.boards) {
  console.log(`\nRound ${b.round + 1}:`)
  b.lines.forEach(l => console.log(l))
}
