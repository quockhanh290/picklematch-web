import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { rebuildStateThroughRound } from '@/lib/next-round-suggester/history'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound, type SuggestionDiagnostic } from '@/lib/next-round-suggester/suggest'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'host@test.com'
const HOST_PASSWORD = process.env.HOST_PASSWORD ?? '123456'

if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function sumStrategy(diagnostics: SuggestionDiagnostic, key: 'evaluated' | 'accepted' | 'partition_iterations' | 'relaxed_partitions' | 'failed_partitions') {
  return Object.values(diagnostics.strategies).reduce((sum, row) => sum + row[key], 0)
}

async function main() {
  const sessionId = argValue('--session-id', '')
  const label = argValue('--label', 'current')
  const courts = Math.max(1, Number(argValue('--courts', '7')))
  const pvnaTolerance = Math.max(0, Number(argValue('--pvna-tolerance', '0.5')))
  const rounds = Math.max(1, Number(argValue('--rounds', '8')))
  if (!sessionId) throw new Error('Pass --session-id')

  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error } = await client.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD })
  if (error) throw error

  const fullState = await loadSessionState(client as any, sessionId, { courts, pvnaTolerance })
  const rows = []

  for (let roundNo = 1; roundNo <= rounds; roundNo += 1) {
    const state = rebuildStateThroughRound(fullState, roundNo - 1)
    const adjustment = correctForFairness(state)
    const adjustedState = applyFairnessAdjustment(state, adjustment)
    const diagnostics: SuggestionDiagnostic = {
      strategies: {},
      partition_count: 0,
      max_iterations: 0,
      exhaustive: false,
    }
    const startedAt = now()
    const suggestion = suggestNextRound(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
      diagnostics,
    })
    const ms = now() - startedAt
    const top = suggestion.alternatives[0]
    rows.push({
      label,
      roundNo,
      suggestMs: Math.round(ms),
      alternatives: suggestion.alternatives.length,
      warnings: top?.warnings ?? suggestion.warnings,
      score: top ? Number(top.score.toFixed(2)) : null,
      pvnaDiff: top ? Number(top.stats.pvna_diff.toFixed(2)) : null,
      partitionCount: diagnostics.partition_count,
      maxIterations: diagnostics.max_iterations,
      exhaustive: diagnostics.exhaustive,
      evaluated: sumStrategy(diagnostics, 'evaluated'),
      accepted: sumStrategy(diagnostics, 'accepted'),
      failedPartitions: sumStrategy(diagnostics, 'failed_partitions'),
      relaxedPartitions: sumStrategy(diagnostics, 'relaxed_partitions'),
      partitionIterations: sumStrategy(diagnostics, 'partition_iterations'),
      strategies: diagnostics.strategies,
    })
  }

  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  console.log(JSON.stringify({
    label,
    sessionId,
    courts,
    pvnaTolerance,
    summary: {
      suggestMsAvg: Math.round(avg(rows.map((row) => row.suggestMs))),
      partitionIterationsAvg: Math.round(avg(rows.map((row) => row.partitionIterations))),
      evaluatedAvg: Math.round(avg(rows.map((row) => row.evaluated))),
      failedPartitionsAvg: Math.round(avg(rows.map((row) => row.failedPartitions))),
      relaxedPartitionsAvg: Math.round(avg(rows.map((row) => row.relaxedPartitions))),
    },
    rows,
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
