/**
 * Test suggestNextRound (classic) cho session bị stuck
 * Chạy: npx tsx scripts/test-session-suggest.ts [session_id]
 */
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { suggestNextRound } from '../lib/next-round-suggester/suggest'
import { calculateOptimalCourts } from '../lib/court-calculator/calculator'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'
const SESSION_ID = process.argv[2] ?? '6271b4f4-ae62-48d2-ac86-87f26eeba4a3'

async function query(table: string, params: Record<string, string> = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`Query ${table} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const [rawPlayerRows, pairRows, [settings], legacyRoundRows, liveMatchRows] = await Promise.all([
    query('session_player_state', {
      session_id: `eq.${SESSION_ID}`,
      select: '*,players(pvna,elo,current_elo,gender)',
    }),
    query('session_pair_history', { session_id: `eq.${SESSION_ID}`, select: '*' }),
    query('session_next_round_settings', { session_id: `eq.${SESSION_ID}`, select: 'court_count_override,pvna_tolerance' }),
    query('session_rounds', { session_id: `eq.${SESSION_ID}`, select: '*' }),
    query('session_live_matches', {
      session_id: `eq.${SESSION_ID}`,
      select: '*',
      status: 'neq.cancelled',
      order: 'sequence_no.asc',
    }),
  ])

  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    players: {
      pvna: row.effective_pvna ?? row.players?.pvna ?? null,
      elo: row.players?.elo ?? row.players?.current_elo ?? null,
      gender: row.players?.gender ?? null,
    },
  }))

  const n = playerRows.filter((r: any) => !r.checked_out_at).length
  const courts = Number(settings?.court_count_override ?? calculateOptimalCourts({ n_players: n, session_duration_min: 90, match_duration_min: 15, preset: 'balanced' }).recommended.courts)
  const pvna = Number(settings?.pvna_tolerance ?? 0.5)

  // Build virtual round rows từ live matches — giống UI
  const presentPlayerIds = playerRows.filter((p: any) => !p.checked_out_at).map((p: any) => p.player_id)
  const baseRoundNo = (legacyRoundRows as any[]).reduce((max: number, r: any) => Math.max(max, r.round_no), -1) + 1
  const completedLive = (liveMatchRows as any[]).filter((m: any) => m.status === 'completed')
    .sort((a: any, b: any) => a.sequence_no !== b.sequence_no ? a.sequence_no - b.sequence_no : (a.court_idx ?? 0) - (b.court_idx ?? 0))

  const roundRows: any[] = [...legacyRoundRows]
  const hasReliableRoundNo = completedLive.length === 0 || completedLive.every((m: any) => m.round_no != null)
  if (hasReliableRoundNo && completedLive.length > 0) {
    const byRound = new Map<number, any[]>()
    for (const m of completedLive) { const rows = byRound.get(m.round_no) ?? []; rows.push(m); byRound.set(m.round_no, rows) }
    for (const [roundNo, matches] of [...byRound.entries()].sort(([a], [b]) => a - b)) {
      if (matches.length < courts) continue
      const playedIds = new Set(matches.flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])]))
      roundRows.push({ id: matches[0].id, session_id: SESSION_ID, round_no: baseRoundNo + roundNo, status: 'completed',
        matches: matches.map((m: any) => ({ court_idx: m.court_idx ?? 0, team_a: m.team_a, team_b: m.team_b })),
        resting: presentPlayerIds.filter((id: string) => !playedIds.has(id)), started_at: null, ended_at: null })
    }
  }

  console.log(`Courts: ${courts}, Players: ${n}, PVNA tol: ${pvna}`)
  console.log(`Legacy rounds: ${legacyRoundRows.length}, Live matches: ${liveMatchRows.length}, Virtual rounds: ${roundRows.length - legacyRoundRows.length}`)

  const state = mapRowsToSessionState({
    sessionId: SESSION_ID,
    playerRows,
    pairRows: pairRows ?? [],
    roundRows,
    courts,
    pvnaTolerance: pvna,
  })

  const players = [...state.players.values()]
  const mustPlay = players.filter(p => p.consecutive_rest >= state.mustPlayAt)
  const mustRest = players.filter(p => p.consecutive_play >= state.mustRestAt)
  console.log(`mustPlayAt=${state.mustPlayAt} mustRestAt=${state.mustRestAt} benchDepth=${state.benchDepth}`)
  console.log(`MUST_PLAY: ${mustPlay.length}, MUST_REST: ${mustRest.length}`)
  console.log(`mustPlay pvna: ${mustPlay.map(p => p.pvna?.toFixed(2)).sort().join(', ')}`)

  const lowPvna = players.filter(p => (p.pvna ?? 0) < 3)
  const highPvna = players.filter(p => (p.pvna ?? 0) >= 3)
  const lowMustPlay = mustPlay.filter(p => (p.pvna ?? 0) < 3)
  const highMustPlay = mustPlay.filter(p => (p.pvna ?? 0) >= 3)
  console.log(`Low PVNA (<3): ${lowPvna.length} (MUST_PLAY: ${lowMustPlay.length})`)
  console.log(`High PVNA (>=3): ${highPvna.length} (MUST_PLAY: ${highMustPlay.length})`)

  const played4 = players.filter(p => (p.matches_played ?? 0) >= 4)
  const played3 = players.filter(p => (p.matches_played ?? 0) <= 3)
  console.log(`matches_played>=4: ${played4.length} (avg pvna=${(played4.reduce((s, p) => s + (p.pvna ?? 0), 0) / played4.length).toFixed(2)})`)
  console.log(`matches_played<=3: ${played3.length} (avg pvna=${(played3.reduce((s, p) => s + (p.pvna ?? 0), 0) / played3.length).toFixed(2)})`)

  console.log('\n--- suggestNextRound (classic) ---')
  const t0 = Date.now()
  const result = suggestNextRound(state, { max_runtime_ms: 4000 })
  console.log(`Time: ${Date.now() - t0}ms`)
  console.log(`Alternatives: ${result.alternatives.length}`)
  console.log(`should_end: ${result.should_end}`)
  console.log(`Warnings: ${JSON.stringify(result.warnings)}`)

  if (result.alternatives.length === 0) {
    console.log('\n!!! NO ALTERNATIVES — session TRULY stuck algorithmically !!!')
    return
  }

  for (let i = 0; i < Math.min(3, result.alternatives.length); i++) {
    const alt = result.alternatives[i]
    console.log(`\nAlt ${i + 1}: ${alt.matches.length} courts, resting=${alt.resting.length}`)
    for (const m of alt.matches) {
      const fmt = (ids: string[]) => ids.map(id => {
        const p = state.players.get(id)
        return `${p?.name ?? id}(${p?.pvna?.toFixed(2) ?? '?'})`
      }).join('+')
      console.log(`  [${fmt(m.team_a)}] vs [${fmt(m.team_b)}]`)
    }
    const restNames = alt.resting.map(id => {
      const p = state.players.get(id)
      return `${p?.name ?? id}(${p?.pvna?.toFixed(2) ?? '?'})`
    }).join(', ')
    console.log(`  Resting: ${restNames}`)
  }
}
main().catch(console.error)
