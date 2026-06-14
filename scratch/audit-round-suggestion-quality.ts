/**
 * audit-round-suggestion-quality.ts
 *
 * For each completed round in a session, re-runs the engine at the exact
 * state that existed just before that round, then explains:
 *   - What the engine suggested (top 3 alternatives)
 *   - What actually happened (from DB)
 *   - Whether what happened matches the engine's top suggestion
 *   - Why each alternative was ranked as it was (score, tradeoffs, burden)
 *   - Per-player rest state at that moment
 *
 * Usage:
 *   npx tsx scratch/audit-round-suggestion-quality.ts <session-id> [--rounds=N] [--alt=M]
 *
 *   --rounds=N   Only audit the first N rounds (default: all)
 *   --alt=M      Show up to M alternatives per round (default: 5)
 *   --json       Output raw JSON instead of formatted text
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import WebSocket from 'ws'

import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import { rebuildStateThroughRound } from '../lib/next-round-suggester/history'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import { mapRowsToSessionState, loadSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRound, suggestNextMatch, type SuggestionDiagnostic } from '../lib/next-round-suggester/suggest'
import {
  buildProjectedStateAfterLiveMatch,
  buildProjectedStateAfterCompletedLiveRound,
} from '../lib/next-round-suggester/live-preview'
import type {
  Match,
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
  SuggestionTradeoff,
} from '../lib/next-round-suggester/types'
import { buildCompletedLiveCycleRows } from '../features/host/session-detail/next-round-v2/live-cycle-rows'

// ─── env ─────────────────────────────────────────────────────────────────────

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf('=')
    if (sep < 0) continue
    const key = trimmed.slice(0, sep).trim()
    const val = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = val
  }
}
loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing SUPABASE_URL / ANON_KEY')

// ─── args ─────────────────────────────────────────────────────────────────────

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/audit-round-suggestion-quality.ts <session-id> [--rounds=N] [--alt=M] [--json]')

function argNum(name: string, fallback: number): number {
  const val = process.argv.find(a => a.startsWith(`${name}=`))?.split('=')[1]
  return val ? Math.max(1, Number(val)) : fallback
}
const maxRounds = argNum('--rounds', 999)
const maxAlt = argNum('--alt', 5)
const jsonMode = process.argv.includes('--json')

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function playerName(state: SessionState, id: string, names: Map<string, string>): string {
  return names.get(id) ?? id.slice(0, 8)
}

function matchLabel(match: Match, names: Map<string, string>, state: SessionState): string {
  const a = match.team_a.map(id => playerName(state, id, names)).join(' & ')
  const b = match.team_b.map(id => playerName(state, id, names)).join(' & ')
  return `[${a}] vs [${b}]`
}

function tradeoffLabel(t: SuggestionTradeoff): string {
  const base = t.type
    .replace('pvna_tolerance_relaxed', 'PVNA relaxed')
    .replace('repeat_cap_relaxed', 'Repeat cap relaxed')
    .replace('intra_team_gap_relaxed', 'Intra-team gap relaxed')
  const extra = t.over_by != null ? ` (+${fmt(t.over_by)})` : ''
  const players = t.affected_players != null ? ` [${t.affected_players}p]` : ''
  return `${base}${extra}${players}`
}

function restSummary(state: SessionState, names: Map<string, string>): string[] {
  return [...state.players.values()]
    .filter(p => p.consecutive_rest >= 1 && p.checked_out_at === null)
    .sort((a, b) => b.consecutive_rest - a.consecutive_rest || a.matches_played - b.matches_played)
    .map(p => `${names.get(p.player_id) ?? p.player_id.slice(0, 8)} rest=${p.consecutive_rest} played=${p.matches_played} pvna=${fmt(p.pvna)}`)
}

function altKey(alt: SuggestionAlternative): string {
  return alt.matches
    .map(m => [...m.team_a, ...m.team_b].slice().sort().join(':'))
    .sort()
    .join('|')
}

type RoundAudit = {
  roundNo: number
  actualMatches: string[]
  actualResting: string[]
  engineTopMatches: string[]
  engineTopResting: string[]
  matchesEngineTopChoice: boolean
  topAlternative: AlternativeAudit | null
  alternatives: AlternativeAudit[]
  actualAlternativeRank: number | null   // 0-based rank of what actually happened
  restAtRoundStart: string[]
  warnings: string[]
  correctorApplied: boolean
  correctorWarnings: string[]
  suggestMs: number
  fairnessScoreBefore: number
}

// ─── live-match audit types ───────────────────────────────────────────────────

type LiveCourtAudit = {
  cycleNo: number
  courtIdx: number
  actualMatch: string
  engineTopMatch: string | null
  matchesEngineTop: boolean
  actualRank: number | null  // 0-based rank of actual match in engine suggestions
  alternatives: AlternativeAudit[]
  busyPlayers: string[]       // players locked in earlier courts of this cycle
  restAtCycleStart: string[]
  suggestMs: number
  warnings: string[]
}

type LiveCycleAudit = {
  cycleNo: number
  courts: LiveCourtAudit[]
}

type AlternativeAudit = {
  rank: number
  score: number
  pvnaDiff: number
  partnerRepeats: number
  opponentRepeats: number
  consecutivePlayPenalty: number
  warnings: string[]
  tradeoffs: string[]
  matches: string[]
  resting: string[]
  isActual: boolean
}

function buildAlternativeAudit(
  rank: number,
  alt: SuggestionAlternative,
  state: SessionState,
  names: Map<string, string>,
  actualKey: string | null,
): AlternativeAudit {
  return {
    rank,
    score: Number(alt.score.toFixed(3)),
    pvnaDiff: Number((alt.stats?.pvna_diff ?? 0).toFixed(3)),
    partnerRepeats: alt.stats?.partner_repeats ?? 0,
    opponentRepeats: alt.stats?.opponent_repeats ?? 0,
    consecutivePlayPenalty: Number((alt.stats?.consecutive_play_penalty ?? 0).toFixed(3)),
    warnings: alt.warnings,
    tradeoffs: (alt.tradeoffs ?? []).map(tradeoffLabel),
    matches: alt.matches.map((m, i) => `Court${m.court_idx + 1}: ${matchLabel(m, names, state)}`),
    resting: alt.resting.map(id => names.get(id) ?? id.slice(0, 8)),
    isActual: altKey(alt) === actualKey,
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })

  const authError = (await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })).error
  if (authError) throw authError

  // Fetch names
  const playersRes = await client
    .from('session_players')
    .select('player_id, players(name, pvna)')
    .eq('session_id', sessionId)
  if (playersRes.error) throw playersRes.error

  const names = new Map<string, string>()
  for (const row of playersRes.data ?? []) {
    if (row.players?.name) names.set(row.player_id, row.players.name as string)
  }

  // Detect session type: live match system or traditional rounds
  const snapshotRes = await (client as any).rpc('get_live_session_snapshot_versioned', { p_session_id: sessionId })
  const snapshot = snapshotRes.data as {
    player_rows?: SessionPlayerStateRow[]
    pair_rows?: any[]
    round_rows?: any[]
    live_match_rows?: SessionLiveMatchRow[]
    court_count?: number
  } | null

  // Fetch session metadata for court count
  const sessionMeta = await client.from('sessions').select('settings').eq('id', sessionId).single()
  const courtCount: number = snapshot?.court_count
    ?? (sessionMeta.data?.settings as any)?.courts
    ?? 6

  let fullState: SessionState
  if (snapshot && (snapshot.live_match_rows?.length ?? 0) > 0) {
    // Live-match session: build round rows from live match rows
    const playerRows: SessionPlayerStateRow[] = snapshot.player_rows ?? []
    const pairRows = snapshot.pair_rows ?? []
    const legacyRoundRows = snapshot.round_rows ?? []
    const liveMatchRows: SessionLiveMatchRow[] = snapshot.live_match_rows ?? []
    const roundRows = buildCompletedLiveCycleRows({
      liveMatchRows,
      legacyRoundRows,
      playerRows,
      sessionId,
      courtCount,
    })
    fullState = mapRowsToSessionState({
      sessionId,
      playerRows,
      pairRows,
      roundRows,
      courts: courtCount,
    })
  } else {
    // Traditional session: load from session_rounds
    fullState = await loadSessionState(client as any, sessionId)
  }

  const completedRounds = fullState.rounds
    .filter(r => r.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
    .slice(0, maxRounds)

  const audits: RoundAudit[] = []

  for (const round of completedRounds) {
    // State just BEFORE this round
    const stateBefore = rebuildStateThroughRound(fullState, round.round_no - 1)
    const fairnessBefore = computeSessionFairness(stateBefore).total

    const adjustment = correctForFairness(stateBefore)
    const adjustedState = applyFairnessAdjustment(stateBefore, adjustment)

    const diag: SuggestionDiagnostic = {
      strategies: {},
      partition_count: 0,
      max_iterations: 0,
      exhaustive: false,
    }

    const t0 = Date.now()
    const suggestion = suggestNextRound(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
      max_alternatives: maxAlt,
      diagnostics: diag,
    })
    const suggestMs = Date.now() - t0

    // Build actual match key for comparison
    const actualKey = round.matches
      .map(m => [...m.team_a, ...m.team_b].slice().sort().join(':'))
      .sort()
      .join('|')

    // Find rank of actual in alternatives
    const actualRank = suggestion.alternatives.findIndex(alt => altKey(alt) === actualKey)

    const altAudits = suggestion.alternatives.map((alt, i) =>
      buildAlternativeAudit(i, alt, adjustedState, names, actualKey),
    )

    audits.push({
      roundNo: round.round_no,
      actualMatches: round.matches.map((m, i) => `Court${m.court_idx + 1}: ${matchLabel(m, names, adjustedState)}`),
      actualResting: round.resting.map(id => names.get(id) ?? id.slice(0, 8)),
      engineTopMatches: suggestion.alternatives[0]?.matches.map(m => `Court${m.court_idx + 1}: ${matchLabel(m, names, adjustedState)}`) ?? [],
      engineTopResting: suggestion.alternatives[0]?.resting.map(id => names.get(id) ?? id.slice(0, 8)) ?? [],
      matchesEngineTopChoice: actualRank === 0,
      topAlternative: altAudits[0] ?? null,
      alternatives: altAudits,
      actualAlternativeRank: actualRank === -1 ? null : actualRank,
      restAtRoundStart: restSummary(stateBefore, names),
      warnings: suggestion.warnings,
      correctorApplied: adjustment.applied_for_warnings.length > 0,
      correctorWarnings: adjustment.applied_for_warnings,
      suggestMs,
      fairnessScoreBefore: Number(fairnessBefore.toFixed(1)),
    })
  }

  if (jsonMode) {
    console.log(JSON.stringify(audits, null, 2))
    return
  }

  // ─── formatted output ──────────────────────────────────────────────────────

  const matchSymbol = (b: boolean) => b ? '✅' : '❌'
  const sep = '─'.repeat(72)

  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  SUGGESTION QUALITY AUDIT`)
  console.log(`  Session: ${sessionId}`)
  console.log(`  Rounds audited: ${audits.length}  |  Alternatives shown: up to ${maxAlt}`)
  console.log(`${'═'.repeat(72)}\n`)

  for (const audit of audits) {
    console.log(`${sep}`)
    console.log(`ROUND ${audit.roundNo}  |  fairness before: ${audit.fairnessScoreBefore}  |  suggest: ${audit.suggestMs}ms`)
    if (audit.correctorApplied) {
      console.log(`  ⚠️  Corrector applied: ${audit.correctorWarnings.join(', ')}`)
    }
    if (audit.warnings.length) {
      console.log(`  ⚠️  Engine warnings: ${audit.warnings.join(', ')}`)
    }

    if (audit.restAtRoundStart.length) {
      console.log(`\n  Players waiting to play (before this round):`)
      for (const r of audit.restAtRoundStart) console.log(`    ${r}`)
    }

    console.log(`\n  ACTUAL (what happened in DB):`)
    for (const m of audit.actualMatches) console.log(`    ${m}`)
    if (audit.actualResting.length) console.log(`    Resting: ${audit.actualResting.join(', ')}`)

    console.log(`\n  ENGINE TOP SUGGESTION:`)
    for (const m of audit.engineTopMatches) console.log(`    ${m}`)
    if (audit.engineTopResting.length) console.log(`    Resting: ${audit.engineTopResting.join(', ')}`)
    if (audit.topAlternative) {
      const top = audit.topAlternative
      console.log(`    score=${top.score}  pvna_diff=${top.pvnaDiff}  partner_rep=${top.partnerRepeats}  opp_rep=${top.opponentRepeats}  consec_penalty=${top.consecutivePlayPenalty}`)
      if (top.tradeoffs.length) console.log(`    Tradeoffs: ${top.tradeoffs.join(' | ')}`)
    }

    const rankLabel = audit.actualAlternativeRank == null
      ? 'not in top alternatives'
      : audit.actualAlternativeRank === 0
        ? 'rank #1 (engine top choice)'
        : `rank #${audit.actualAlternativeRank + 1}`

    console.log(`\n  MATCH: actual == engine top? ${matchSymbol(audit.matchesEngineTopChoice)}  (actual was ${rankLabel})`)

    if (audit.alternatives.length > 1) {
      console.log(`\n  ALL ALTERNATIVES (ranked by engine):`)
      for (const alt of audit.alternatives) {
        const marker = alt.isActual ? '← ACTUAL' : ''
        console.log(`\n    #${alt.rank + 1} score=${alt.score}  pvna=${alt.pvnaDiff}  part_rep=${alt.partnerRepeats}  opp_rep=${alt.opponentRepeats}  ${marker}`)
        for (const m of alt.matches) console.log(`       ${m}`)
        if (alt.resting.length) console.log(`       Resting: ${alt.resting.join(', ')}`)
        if (alt.tradeoffs.length) console.log(`       Tradeoffs: ${alt.tradeoffs.join(' | ')}`)
        if (alt.warnings.filter(w => w !== 'EXHAUSTIVE_FALLBACK').length) {
          console.log(`       Warnings: ${alt.warnings.filter(w => w !== 'EXHAUSTIVE_FALLBACK').join(', ')}`)
        }
      }
    }

    console.log('')
  }

  // ─── summary ──────────────────────────────────────────────────────────────

  const matched = audits.filter(a => a.matchesEngineTopChoice).length
  const rankDistrib = new Map<string, number>()
  for (const a of audits) {
    const key = a.actualAlternativeRank == null ? 'not found' : `rank ${a.actualAlternativeRank + 1}`
    rankDistrib.set(key, (rankDistrib.get(key) ?? 0) + 1)
  }

  console.log(`${'═'.repeat(72)}`)
  console.log(`SUMMARY`)
  console.log(`  Rounds audited:          ${audits.length}`)
  console.log(`  Actual == engine top:    ${matched}/${audits.length} (${Math.round(matched / audits.length * 100)}%)`)
  console.log(`  Avg suggest time:        ${Math.round(audits.reduce((s, a) => s + a.suggestMs, 0) / audits.length)}ms`)
  console.log(`  Rounds with corrector:   ${audits.filter(a => a.correctorApplied).length}`)
  console.log(`  Actual rank distribution:`)
  for (const [rank, count] of [...rankDistrib].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${rank}: ${count}`)
  }
  console.log(`${'═'.repeat(72)}\n`)
}

void main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
