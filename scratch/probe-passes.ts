/* Which tradeoff panel actually reaches the host on the live path?
   Three builders feed payload.tradeoff_choices (live-preview.ts:3530-3538):
     A buildConditionalLiveQualityTradeoffChoices  (conditional quality tradeoff available)
     B buildLiveTradeoffChoices                    (4 axes incl. reduce_intra, NOT flag gated)
     C buildOverThresholdRepeatTradeoff            (fallback, flag dispatched, 2 axes)
   Identify by the emitted id set. READ-ONLY.
   Usage: npx tsx scratch/probe-which-panel.ts [seeds] */
import seedrandom from 'seedrandom'
import { correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { buildSuggestedMatchPayloads, buildProjectedStateAfterLiveMatch } from './lp-passes'
import type { SuggestedMatchPayload } from './lp-passes'
import { getEffectivePvna } from '../lib/next-round-suggester/state'
import { __setQualityCostModelOverrideForTests } from '../lib/next-round-suggester/quality-cost-flag'
import { generatePlayers, initState } from '../tests/next-round-suggester/simulation/generators'
import type { SessionLiveMatchRow, SessionState } from '../lib/next-round-suggester/types'

const SEEDS = Number(process.argv[2] ?? 40)
;(globalThis as any).__PASS_STATS__ = []
const TOL = 0.5

const _warn = console.warn
console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].includes('drift monitor')) return; _warn(...a) }

const asLive = (p: SuggestedMatchPayload, seq: number, round: number): SessionLiveMatchRow => ({
  id: `m-${seq}`, session_id: 'r', sequence_no: seq, round_no: round, cycle_no: round,
  court_idx: p.court_idx, status: 'live', team_a: p.team_a, team_b: p.team_b, resting: p.resting ?? [],
  score_a: 0, score_b: 0, suggested_at: null, started_at: null, ended_at: null,
  created_at: null, updated_at: null, suggestion_metadata: null,
} as unknown as SessionLiveMatchRow)

type Tally = { payloads: number; withChoices: number; ids: Record<string, number>; sizes: Record<number, number> }
const tally = (): Tally => ({ payloads: 0, withChoices: 0, ids: {}, sizes: {} })

function run(flagOn: boolean, mode: 'refill' | 'fullboard'): Tally {
  const t = tally()
  for (let i = 0; i < SEEDS; i++) {
    __setQualityCostModelOverrideForTests(flagOn)
    try {
      const players = generatePlayers(
        { n_players: 24, pvna_distribution: 'bimodal', gender_ratio: 0.4, gender_pref_rate: 0.3, group_count: 0, group_size_range: [2, 4] },
        seedrandom(`panel-${i}`),
      )
      let state: SessionState = initState(players, { courts: 5, pvna_tolerance: TOL })
      state.config.quality_cost_enabled = flagOn
      let seq = 0
      const liveRows: SessionLiveMatchRow[] = []
      const build = (count: number, courtIdxs: number[] | undefined) => {
        const restore = console.log
        console.log = () => undefined
        try {
          return buildSuggestedMatchPayloads({
            count, sessionId: 'r', courtCount: 5, state,
            rows: { liveMatchRows: liveRows, liveStateVersion: liveRows.length }, completingLiveMatchIds: new Set(),
            fairnessAdjustment: correctForFairness(state), fairnessWarnings: detectFairnessIssues(state),
            playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
            pvnaTolerance: TOL,
            options: (courtIdxs ? { courtIdxs, blowoutRescue: true, rollingHorizon: true } : { blowoutRescue: true, rollingHorizon: true }) as never,
          })
        } finally { console.log = restore }
      }
      const record = (board: SuggestedMatchPayload[]) => {
        for (const p of board) {
          t.payloads++
          const ch = p.tradeoff_choices
          if (!ch || ch.length === 0) continue
          t.withChoices++
          t.sizes[ch.length] = (t.sizes[ch.length] ?? 0) + 1
          for (const c of ch) t.ids[c.id] = (t.ids[c.id] ?? 0) + 1
        }
      }

      const initial = build(5, undefined)
      record(initial)
      initial.forEach(m => liveRows.push(asLive(m, seq++, 0)))

      for (let round = 1; round <= 12; round++) {
        const live = liveRows.filter(r => r.status === 'live').map(r => r.court_idx as number).sort((a, b) => a - b)
        const targets = mode === 'refill' ? live.slice(0, 2) : live
        if (targets.length < 2) break
        for (const ci of targets) {
          const row = liveRows.find(r => r.status === 'live' && r.court_idx === ci)!
          state = buildProjectedStateAfterLiveMatch(state, { ...row, status: 'completed' } as SessionLiveMatchRow, round)
          liveRows.splice(liveRows.indexOf(row), 1)
        }
        const refill = build(targets.length, targets)
        record(refill)
        refill.forEach(m => liveRows.push(asLive(m, seq++, round)))
      }
    } finally { __setQualityCostModelOverrideForTests(null) }
  }
  return t
}

const MODES = (process.argv[3] ?? 'refill').split(',') as ('refill'|'fullboard')[]
for (const mode of MODES) {
  for (const flagOn of [true, false]) {
    const t = run(flagOn, mode)
    process.stdout.write(`${mode.padEnd(10)} flag=${flagOn ? 'ON ' : 'OFF'} | payloads=${String(t.payloads).padStart(5)}` +
      ` | co choices=${String(t.withChoices).padStart(4)} (${(100 * t.withChoices / (t.payloads || 1)).toFixed(1)}%)` +
      ` | so nhanh=${JSON.stringify(t.sizes)} | ids=${JSON.stringify(t.ids)}
`)
  }
}

const ps: any[] = (globalThis as any).__PASS_STATS__
const back: any[] = (globalThis as any).__PASS_BACK__ ?? []
const names = [...new Set(ps.map(e => e.name))]
console.log('--- post-pass: ai thuc su viet lai gi ---')
console.log('stage             | batches | batches changed | courts rewritten')
for (const n of names) {
  const g = ps.filter(e => e.name === n)
  const changedBatches = g.filter(e => !e.identical).length
  const courts = g.reduce((a, e) => a + e.changedCourts, 0)
  console.log(`${n.padEnd(18)}| ${String(g.length).padStart(7)} | ${String(changedBatches).padStart(15)} | ${String(courts).padStart(16)}`)
}
console.log('--- so voi lineup goc (co pass nao undo pass truoc khong) ---')
for (const n of names) {
  const g = back.filter(e => e.name === n)
  console.log(`${n.padEnd(18)} vsSeed courts=${g.reduce((a, e) => a + e.vsSeed, 0)}`)
}
