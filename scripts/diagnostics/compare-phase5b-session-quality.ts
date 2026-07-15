import { readFileSync } from 'node:fs'

import { compareSessionQuality } from '../../lib/next-round-suggester/planner/quality-gate'
import {
  buildSessionQualityReport,
  type SessionQualityTraceRound,
} from '../../lib/next-round-suggester/planner/quality-report'

type QualityTraceFile = {
  player_ids: string[]
  pvna_by_player: Record<string, number>
  pvna_tolerance: number
  rounds: SessionQualityTraceRound[]
  feasible_match_count_spread?: number
  mathematical_rest_bound?: number
  operation_errors?: number
  avoidable_incomplete_boards?: number
}

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function load(path: string) {
  const trace = JSON.parse(readFileSync(path, 'utf8')) as QualityTraceFile
  return buildSessionQualityReport({
    ...trace,
    pvna_by_player: new Map(Object.entries(trace.pvna_by_player).map(([id, value]) => [id, Number(value)])),
  })
}

const livePath = argument('--live')
const hybridPath = argument('--hybrid')
if (!livePath || !hybridPath) {
  throw new Error('Usage: npx tsx scripts/diagnostics/compare-phase5b-session-quality.ts --live=<trace.json> --hybrid=<trace.json>')
}

const liveOnly = load(livePath)
const hybrid = load(hybridPath)
const gate = compareSessionQuality(liveOnly.summary, hybrid.summary)
const worstPlayers = (players: typeof hybrid.players) => [...players]
  .sort((left, right) => (
    right.quality_debt - left.quality_debt
    || right.max_rest_streak - left.max_rest_streak
    || right.warning_match_exposure - left.warning_match_exposure
  ))
  .slice(0, 5)

console.log(JSON.stringify({
  passed: gate.passed,
  decisive_metric: gate.decisive_metric,
  regressions: gate.regressions,
  improvements: gate.improvements,
  live_only: {
    summary: liveOnly.summary,
    worst_players: worstPlayers(liveOnly.players),
  },
  hybrid: {
    summary: hybrid.summary,
    worst_players: worstPlayers(hybrid.players),
  },
  deltas: gate.deltas,
}, null, 2))

if (!gate.passed) process.exitCode = 1
