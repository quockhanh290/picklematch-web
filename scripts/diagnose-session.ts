/**
 * Diagnostic snapshot cho 1 session đang chạy.
 * Tự pull toàn bộ data cần thiết, không cần nhập tay court_count hay pvna_tol.
 *
 * Chạy: npx tsx scripts/diagnose-session.ts <session_id>
 */
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { classifyPlayer, computeDynamicThresholds, getAverageMatches, Tier } from '../lib/next-round-suggester/classify'
import { detectFairnessIssues } from '../lib/next-round-suggester/fairness/detector'
import { computeSessionFairness } from '../lib/next-round-suggester/fairness/metrics'
import type { SessionState } from '../lib/next-round-suggester/types'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'

async function query<T = any>(table: string, params: Record<string, string> = {}): Promise<T[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function querySingle<T = any>(table: string, params: Record<string, string> = {}): Promise<T | null> {
  const rows = await query<T>(table, { ...params, limit: '1' })
  return rows[0] ?? null
}

const TIER_LABEL: Record<number, string> = {
  [Tier.MUST_PLAY]:   'MUST_PLAY  ',
  [Tier.SHOULD_PLAY]: 'SHOULD_PLAY',
  [Tier.FLEXIBLE]:    'FLEXIBLE   ',
  [Tier.SHOULD_REST]: 'SHOULD_REST',
  [Tier.MUST_REST]:   'MUST_REST  ',
  [Tier.OPTED_REST]:  'OPTED_REST ',
}

function fmt(n: number, d = 2) { return n.toFixed(d) }
function pad(s: string | number, w: number) { return String(s).padEnd(w) }
function rpad(s: string | number, w: number) { return String(s).padStart(w) }
function hr(char = '─', len = 72) { return char.repeat(len) }

function shortName(fullName: string | undefined, id: string) {
  if (!fullName) return id.slice(0, 8)
  return fullName.split(' ').pop() ?? fullName
}

function teamStr(ids: string[], names: Map<string, string>, state: SessionState) {
  return ids.map(id => {
    const p = state.players.get(id)
    const pvna = p ? fmt(p.pvna) : '?.??'
    return `${shortName(names.get(id), id)}(${pvna})`
  }).join(' + ')
}

async function main() {
  const sessionId = process.argv[2]
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/diagnose-session.ts <session_id>')
    process.exit(1)
  }

  console.log(`\nFetching session ${sessionId}...`)

  const [
    settings,
    rawPlayerRows,
    sessionPlayers,
    avoidPairs,
    pairRows,
    roundRows,
    rawMatchRows,
  ] = await Promise.all([
    querySingle<any>('session_next_round_settings', { session_id: `eq.${sessionId}`, select: '*' }),
    query<any>('session_player_state', {
      session_id: `eq.${sessionId}`,
      select: '*,players(pvna,elo,current_elo,gender,name)',
    }),
    query<any>('session_players', {
      session_id: `eq.${sessionId}`,
      select: 'player_id,check_in_status,status',
    }),
    query<any>('session_avoid_pairs', { session_id: `eq.${sessionId}`, select: '*' }),
    query<any>('session_pair_history', { session_id: `eq.${sessionId}`, select: '*' }),
    query<any>('session_rounds', { session_id: `eq.${sessionId}`, select: '*', order: 'round_no.asc' }),
    query<any>('session_live_matches', {
      session_id: `eq.${sessionId}`,
      select: '*',
      status: 'neq.cancelled',
      order: 'sequence_no.asc',
    }),
  ])

  // ── Config từ DB (fallback về defaults nếu chưa có settings) ──────────────
  const courtCount = Number(settings?.court_count_override ?? settings?.court_count ?? 4)
  const pvnaTolerance = Number(settings?.pvna_tolerance ?? 0.5)
  const targetRounds = settings?.target_rounds ? Number(settings.target_rounds) : null
  const courtPreset: string = settings?.court_preset ?? 'balanced'

  // ── Check-in status map ───────────────────────────────────────────────────
  const checkInStatus = new Map<string, string>(
    sessionPlayers.map((r: any) => [r.player_id, r.check_in_status ?? 'unknown'])
  )

  // ── Enrich player rows: effective_pvna override + name ───────────────────
  const playerRows = rawPlayerRows.map((row: any) => ({
    ...row,
    pvna: row.effective_pvna ?? row.players?.pvna ?? row.pvna ?? 0,
    gender: row.players?.gender ?? row.gender ?? null,
    name: row.players?.name ?? null,
    _has_pvna_override: row.effective_pvna != null,
    _base_pvna: row.players?.pvna ?? row.pvna ?? 0,
  }))

  const names = new Map<string, string>(
    playerRows.map((r: any) => [r.player_id, r.players?.name ?? r.name ?? r.player_id.slice(0, 8)])
  )

  // ── Build state ───────────────────────────────────────────────────────────
  const state: SessionState = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows,
    roundRows,
    courts: courtCount,
    pvnaTolerance,
  })

  const liveMatches = rawMatchRows.filter((m: any) => m.status === 'live')
  const suggestedMatches = rawMatchRows.filter((m: any) => m.status === 'suggested')
  const completedMatches = rawMatchRows.filter((m: any) => m.status === 'completed')

  const activePlayers = [...state.players.values()].filter(p => p.checked_out_at === null)
  const presentCount = activePlayers.length
  const benchDepth = presentCount - courtCount * 4
  const thresholds = computeDynamicThresholds(benchDepth, presentCount)
  const avgMatches = getAverageMatches(activePlayers)
  const matchBalance = new Map<string, number>(
    activePlayers.map(p => [p.player_id, p.matches_played - avgMatches])
  )
  const classifyCtx = { avgMatches, matchBalance, thresholds }

  const completedRoundNos = new Set(completedMatches.map((m: any) => m.round_no).filter((n: any) => n != null))
  const maxCompletedRound = completedRoundNos.size > 0 ? Math.max(...completedRoundNos) : 0
  const currentRound = maxCompletedRound + 1
  const fairness = computeSessionFairness(state)

  // ══════════════════════════════════════════════════════════════════════════
  console.log(hr('═'))
  console.log(`SESSION DIAGNOSTIC  ${sessionId}`)
  console.log(hr('═'))
  console.log(`Courts: ${courtCount}  │  PVNA tol: ${pvnaTolerance}  │  Preset: ${courtPreset}  │  Target: ${targetRounds ?? 'none'} rounds`)
  console.log(`Players present: ${presentCount}  │  benchDepth: ${benchDepth}  │  mustPlayAt: ${thresholds.mustPlayAt}  │  mustRestAt: ${thresholds.mustRestAt}`)
  console.log(`Completed rounds: ${maxCompletedRound}  │  Current round: ${currentRound}  │  Fairness: ${fmt(fairness.total, 1)}/100`)
  if (settings == null) console.log(`  ⚠ No session_next_round_settings found — using defaults`)

  // ── Avoid pairs ────────────────────────────────────────────────────────────
  if (avoidPairs.length > 0) {
    console.log(`\n${hr()}`)
    console.log('AVOID PAIRS')
    console.log(hr())
    for (const ap of avoidPairs) {
      const nameA = names.get(ap.player_a) ?? ap.player_a.slice(0, 8)
      const nameB = names.get(ap.player_b) ?? ap.player_b.slice(0, 8)
      const reason = ap.reason ? `  (${ap.reason})` : ''
      console.log(`  ${nameA} ↔ ${nameB}${reason}`)
    }
  }

  // ── Current board ──────────────────────────────────────────────────────────
  if (liveMatches.length > 0 || suggestedMatches.length > 0) {
    console.log(`\n${hr()}`)
    console.log('CURRENT BOARD')
    console.log(hr())
    for (const m of [...liveMatches, ...suggestedMatches]) {
      const status = m.status === 'live' ? '🟢 LIVE     ' : '🟡 SUGGESTED'
      const courtLabel = `Court ${(m.court_idx ?? m.sequence_no) + 1}`
      const tA = teamStr(m.team_a, names, state)
      const tB = teamStr(m.team_b, names, state)
      const locked = Array.isArray(m.locked_player_ids) && m.locked_player_ids.length > 0
        ? ` ⚠ LOCKED[${m.locked_player_ids.map((id: string) => shortName(names.get(id), id)).join(',')}]`
        : ''
      const warnings = Array.isArray(m.warnings) && m.warnings.length > 0
        ? ` [${m.warnings.join(',')}]`
        : ''
      console.log(`  ${status} ${pad(courtLabel, 9)} R${m.round_no ?? '?'}  ${tA} vs ${tB}${locked}${warnings}`)
    }
  }

  // ── Player table ───────────────────────────────────────────────────────────
  console.log(`\n${hr()}`)
  console.log('PLAYER STATE')
  console.log(hr())
  console.log(
    pad('Name', 18) +
    rpad('PVNA', 7) +
    rpad('Played', 8) +
    rpad('C-Rest', 8) +
    rpad('C-Play', 8) +
    pad('Tier', 14) +
    'Status'
  )
  console.log(hr('─'))

  const livePlayerIds = new Set(liveMatches.flatMap((m: any) => [...m.team_a, ...m.team_b]))
  const suggestedPlayerIds = new Set(suggestedMatches.flatMap((m: any) => [...m.team_a, ...m.team_b]))
  const lockedPlayerIds = new Set(
    suggestedMatches.flatMap((m: any) => Array.isArray(m.locked_player_ids) ? m.locked_player_ids : [])
  )

  const sortedPlayers = [...state.players.values()]
    .filter(p => p.checked_out_at === null)
    .sort((a, b) => {
      const ta = classifyPlayer(a, classifyCtx)
      const tb = classifyPlayer(b, classifyCtx)
      if (ta !== tb) return ta - tb
      if (b.consecutive_rest !== a.consecutive_rest) return b.consecutive_rest - a.consecutive_rest
      return a.player_id.localeCompare(b.player_id)
    })

  for (const p of sortedPlayers) {
    const tier = classifyPlayer(p, classifyCtx)
    const row = playerRows.find((r: any) => r.player_id === p.player_id)
    const pvnaStr = row?._has_pvna_override
      ? `${fmt(p.pvna)}*` // * = effective_pvna override
      : fmt(p.pvna)
    const status = livePlayerIds.has(p.player_id)
      ? '🟢 playing'
      : lockedPlayerIds.has(p.player_id)
        ? '🔒 locked(live)'
        : suggestedPlayerIds.has(p.player_id)
          ? '🟡 suggested'
          : p.opted_rest
            ? '💤 opted_rest'
            : '⚪ resting'
    const checkIn = checkInStatus.get(p.player_id)
    const checkInTag = checkIn === 'no_show' ? ' [no_show]'
      : checkIn === 'pending' ? ' [pending]'
      : ''
    console.log(
      pad(names.get(p.player_id) ?? p.player_id.slice(0, 16), 18) +
      rpad(pvnaStr, 7) +
      rpad(p.matches_played, 8) +
      rpad(p.consecutive_rest, 8) +
      rpad(p.consecutive_play, 8) +
      pad(TIER_LABEL[tier] ?? String(tier), 14) +
      status + checkInTag
    )
  }

  // Checked-out players (nếu có)
  const checkedOut = [...state.players.values()].filter(p => p.checked_out_at !== null)
  if (checkedOut.length > 0) {
    console.log(`  — ${checkedOut.length} checked-out: ${checkedOut.map(p => shortName(names.get(p.player_id), p.player_id)).join(', ')}`)
  }

  // ── Consecutive rest alert ─────────────────────────────────────────────────
  const consecAlerts = sortedPlayers.filter(p => p.consecutive_rest >= 2)
  if (consecAlerts.length > 0) {
    console.log(`\n${hr()}`)
    console.log('⚠ CONSECUTIVE REST ≥ 2')
    console.log(hr())
    for (const p of consecAlerts) {
      console.log(`  ${pad(names.get(p.player_id) ?? p.player_id.slice(0, 16), 18)} ${p.consecutive_rest} vòng liên tiếp nghỉ`)
    }
  }

  // ── Fairness warnings ──────────────────────────────────────────────────────
  const warnings = detectFairnessIssues(state)
  if (warnings.length > 0) {
    console.log(`\n${hr()}`)
    console.log('FAIRNESS WARNINGS')
    console.log(hr())
    for (const w of warnings) {
      const players = w.affected_players?.map((id: string) => shortName(names.get(id), id)).join(', ') ?? ''
      console.log(`  ⚠ ${pad(w.type, 32)} ${players ? `[${players}]` : ''}`)
      if (w.message) console.log(`       ${w.message}`)
    }
  } else {
    console.log('\n✅ No fairness warnings')
  }

  // ── Avoid pairs violated in current board ─────────────────────────────────
  if (avoidPairs.length > 0) {
    const boardPlayerSets = [...liveMatches, ...suggestedMatches].map((m: any) => ({
      courtLabel: `Court ${(m.court_idx ?? m.sequence_no) + 1}`,
      partners: [
        [m.team_a[0], m.team_a[1]],
        [m.team_b[0], m.team_b[1]],
      ] as [string, string][],
    }))
    const violations: string[] = []
    for (const { courtLabel, partners } of boardPlayerSets) {
      for (const [a, b] of partners) {
        const isAvoided = avoidPairs.some(
          ap => (ap.player_a === a && ap.player_b === b) || (ap.player_a === b && ap.player_b === a)
        )
        if (isAvoided) {
          violations.push(`  ❌ ${courtLabel}: ${shortName(names.get(a), a)} + ${shortName(names.get(b), b)} là avoid pair!`)
        }
      }
    }
    if (violations.length > 0) {
      console.log(`\n${hr()}`)
      console.log('AVOID PAIR VIOLATIONS IN CURRENT BOARD')
      console.log(hr())
      violations.forEach(v => console.log(v))
    }
  }

  // ── Last 5 rounds ──────────────────────────────────────────────────────────
  const recentRounds = completedMatches.reduce((acc: Map<number, any[]>, m: any) => {
    const rn = m.round_no ?? 0
    if (!acc.has(rn)) acc.set(rn, [])
    acc.get(rn)!.push(m)
    return acc
  }, new Map<number, any[]>())

  const roundNos = [...recentRounds.keys()].sort((a, b) => b - a).slice(0, 5)
  if (roundNos.length > 0) {
    console.log(`\n${hr()}`)
    console.log('LAST 5 ROUNDS (newest first)')
    console.log(hr())
    for (const rn of roundNos) {
      const matches = recentRounds.get(rn)!
      const playingIds = new Set(matches.flatMap((m: any) => [...m.team_a, ...m.team_b]))
      const restingNames = activePlayers
        .filter(p => !playingIds.has(p.player_id))
        .map(p => shortName(names.get(p.player_id), p.player_id))
      console.log(`  Round ${rn}:`)
      for (const m of matches) {
        const tA = teamStr(m.team_a, names, state)
        const tB = teamStr(m.team_b, names, state)
        console.log(`    Court ${(m.court_idx ?? 0) + 1}: ${tA} vs ${tB}`)
      }
      if (restingNames.length > 0) {
        console.log(`    Resting (${restingNames.length}): ${restingNames.join(', ')}`)
      }
    }
  }

  console.log(`\n${hr('═')}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
