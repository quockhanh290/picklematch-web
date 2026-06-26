import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { bestPartitioning } from '@/lib/next-round-suggester/pair'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import type { Match, SessionPlayerPreferenceRow, SessionPlayerStateRow, SessionState, SuggestionAlternative } from '@/lib/next-round-suggester/types'

type PlayerName = { name: string; pvna: number }

const requestedSessionId = process.argv[2]
if (!requestedSessionId) throw new Error('Usage: tsx scratch/simulate-next-match-session.ts <session-id|latest> --rounds=8')
const recomputePerMatch = process.argv.includes('--recompute-per-match')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const courtPresetArg = argValue('--court-preset', '')
const sessionDurationMinArg = argValue('--session-duration-min', '')
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const roundsToSimulate = Math.max(1, Number(argValue('--rounds', '10')))
const courtCountArg = argValue('--courts', '')
const pvnaToleranceArg = argValue('--pvna-tolerance', '')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => `${value}:${count}`).join(', ')
}

function format(n: number, digits = 2) {
  return Number(n.toFixed(digits))
}

function project(state: SessionState, alt: SuggestionAlternative, roundNo: number): SessionState {
  const match = alt.matches[0]
  const playedIds = new Set([...match.team_a, ...match.team_b])
  const players = new Map(state.players)

  players.forEach((player, playerId) => {
    if (playedIds.has(playerId)) {
      players.set(playerId, {
        ...player,
        matches_played: player.matches_played + 1,
        last_played_round: roundNo,
        consecutive_play: player.consecutive_play + 1,
        consecutive_rest: 0,
        opted_rest: false,
      })
    }
  })

  const incrementPair = (playerAId: string, playerBId: string, type: 'partner' | 'opponent') => {
    const playerA = players.get(playerAId)
    const playerB = players.get(playerBId)
    if (playerA) {
      const partnerCounts = new Map(playerA.partner_counts)
      const opponentCounts = new Map(playerA.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
      players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (playerB) {
      const partnerCounts = new Map(playerB.partner_counts)
      const opponentCounts = new Map(playerB.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
      players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner')
  incrementPair(match.team_b[0], match.team_b[1], 'partner')
  for (const a of match.team_a) for (const b of match.team_b) incrementPair(a, b, 'opponent')

  return { ...state, players }
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function findExhaustiveSingleMatch(state: SessionState, busy: Set<string>) {
  const present = [...state.players.values()].filter(player => player.checked_out_at === null && !player.opted_rest && !busy.has(player.player_id))
  let checked = 0
  let strictBest: { gap: number; match: Match } | null = null
  let relaxedBest: { gap: number; match: Match } | null = null
  for (let a = 0; a < present.length - 3; a += 1) {
    for (let b = a + 1; b < present.length - 2; b += 1) {
      for (let c = b + 1; c < present.length - 1; c += 1) {
        for (let d = c + 1; d < present.length; d += 1) {
          checked += 1
          const players = [present[a], present[b], present[c], present[d]]
          const strict = bestPartitioning(players, state, { allowRelaxedTolerance: false, allowRepeatOverflow: false })
          const strictMatch = strict?.matches[0]
          if (strictMatch) {
            const gap = strictMatch.stats?.pvna_diff ?? Infinity
            if (!strictBest || gap < strictBest.gap) strictBest = { gap, match: strictMatch }
          }
          const relaxed = bestPartitioning(players, state, { allowRelaxedTolerance: true, allowRepeatOverflow: true })
          const relaxedMatch = relaxed?.matches[0]
          if (relaxedMatch) {
            const gap = relaxedMatch.stats?.pvna_diff ?? Infinity
            if (!relaxedBest || gap < relaxedBest.gap) relaxedBest = { gap, match: relaxedMatch }
          }
        }
      }
    }
  }
  return { checked, strictBest, relaxedBest }
}

async function main() {
  const client = createClient(url!, anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signIn.error) throw signIn.error

  let sessionId = requestedSessionId
  if (requestedSessionId === 'latest') {
    const latestRes = await client
      .from('sessions')
      .select('id, created_at')
      .eq('host_id', signIn.data.user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestRes.error) throw latestRes.error
    if (!latestRes.data?.id) throw new Error('No latest session found')
    sessionId = String(latestRes.data.id)
  }

  const settingsRes = await client
    .from('session_next_round_settings')
    .select('court_count_override, court_preset, court_duration_min, pvna_tolerance, target_rounds')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (settingsRes.error && settingsRes.error.code !== 'PGRST116') throw settingsRes.error
  const dbSettings = settingsRes.data as any | null
  const courtPreset = (courtPresetArg || dbSettings?.court_preset || 'balanced') as CourtPreset
  const sessionDurationMin = Math.max(1, Number(sessionDurationMinArg || dbSettings?.court_duration_min || 120))
  const dbCourtCountOverride = dbSettings?.court_count_override == null ? null : Number(dbSettings.court_count_override)
  const pvnaTolerance = Number(pvnaToleranceArg || dbSettings?.pvna_tolerance || 0.5)

  const [playersRes, preferenceRes, namesRes] = await Promise.all([
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId),
    client
      .from('session_player_state')
      .select('player_id, players(name, pvna)')
      .eq('session_id', sessionId),
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error
  if (namesRes.error) throw namesRes.error

  const names = new Map<string, PlayerName>((namesRes.data ?? []).map((row: any) => [String(row.player_id), {
    name: row.players?.name ?? String(row.player_id).slice(0, 8),
    pvna: Number(row.players?.pvna ?? 3),
  }]))
  const label = (id: string) => names.get(id)?.name ?? id.slice(0, 8)
  const teamSum = (team: [string, string]) => team.reduce((sum, id) => sum + (names.get(id)?.pvna ?? 3), 0)
  const teamLabel = (team: [string, string]) => `${label(team[0])}+${label(team[1])}`

  const playerCount = ((playersRes.data ?? []) as SessionPlayerStateRow[]).length
  const courtCalculator = calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: sessionDurationMin,
    match_duration_min: matchDurationMin,
    preset: courtPreset,
  })
  const courtCount = Math.max(1, Number(courtCountArg || dbCourtCountOverride || courtCalculator.recommended.courts))

  let state = mapRowsToSessionState({
    sessionId,
    playerRows: ((playersRes.data ?? []) as SessionPlayerStateRow[]).map(row => ({
      ...row,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
    })),
    pairRows: [],
    roundRows: [],
    preferenceRows: (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[],
    courts: courtCount,
    pvnaTolerance,
  })

  const rounds: Array<{ roundNo: number; matches: Match[]; resting: string[]; warnings: string[]; tradeoffs: number }> = []
  const allPlayerIds = [...state.players.keys()]
  for (let roundNo = 0; roundNo < roundsToSimulate; roundNo += 1) {
    const busy = new Set<string>()
    const matches: Match[] = []
    const warnings: string[] = []
    let tradeoffs = 0
    for (let courtIdx = 0; courtIdx < courtCount; courtIdx += 1) {
      const adjustment = recomputePerMatch
        ? correctForFairness({
          ...state,
          players: new Map([...state.players.entries()].map(([playerId, player]) => [
            playerId,
            busy.has(playerId) ? { ...player, checked_out_at: new Date() } : player,
          ])),
        })
        : correctForFairness(state)
      const adjustedState = applyFairnessAdjustment(state, adjustment)
      const result = suggestNextMatch(adjustedState, {
        court_idx: courtIdx,
        busy_player_ids: busy,
        tier_overrides: adjustment.tier_overrides,
        max_alternatives: 1,
      })
      const alt = result.alternatives[0]
      const match = alt?.matches[0]
      if (!alt || !match) {
        const exhaustive = findExhaustiveSingleMatch(state, busy)
        const describe = (item: { gap: number; match: Match } | null) => item ? {
          match: `${teamLabel(item.match.team_a)} vs ${teamLabel(item.match.team_b)}`,
          gap: format(item.gap),
          sum: `${format(teamSum(item.match.team_a))}-${format(teamSum(item.match.team_b))}`,
        } : null
        console.log(JSON.stringify({
          stopped: true,
          mode: recomputePerMatch ? 'recompute-per-match' : 'current-queue',
          round: roundNo + 1,
          court: courtIdx + 1,
          resultWarnings: result.warnings,
          busyCount: busy.size,
          busyPlayers: [...busy].map(label),
          tierOverrides: Object.keys(adjustment.tier_overrides).map(label),
          exhaustive: {
            checked: exhaustive.checked,
            strictBest: describe(exhaustive.strictBest),
            relaxedBest: describe(exhaustive.relaxedBest),
          },
        }, null, 2))
        throw new Error(`No next-match suggestion at round=${roundNo + 1} court=${courtIdx + 1}`)
      }
      matches.push(match)
      warnings.push(...alt.warnings)
      tradeoffs += alt.tradeoffs?.length ?? 0
      match.team_a.forEach(id => busy.add(id))
      match.team_b.forEach(id => busy.add(id))
      state = project(state, alt, roundNo)
    }
    const resting = allPlayerIds.filter(id => !busy.has(id))
    for (const [playerId, player] of state.players) {
      if (!busy.has(playerId)) {
        state.players.set(playerId, {
          ...player,
          consecutive_rest: player.consecutive_rest + 1,
          consecutive_play: 0,
        })
      }
    }
    rounds.push({ roundNo, matches, resting, warnings, tradeoffs })
  }

  const matchCounts = new Map(allPlayerIds.map(id => [id, 0]))
  const restCounts = new Map(allPlayerIds.map(id => [id, 0]))
  const consecutiveRest = new Map(allPlayerIds.map(id => [id, 0]))
  const maxConsecutiveRest = new Map(allPlayerIds.map(id => [id, 0]))
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const matchStats: Array<{
    round: number
    court: number
    label: string
    teamA: number
    teamB: number
    gap: number
    maxIntraTeamGap: number
    maxProjectedPartnerPair: number
    maxProjectedOpponentPair: number
    warningCount: number
  }> = []

  for (const round of rounds) {
    const playedThisRound = new Set<string>()
    for (const match of round.matches) {
      const partnerKeys = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
      const opponentKeys = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
      const projectedPartner = Math.max(...partnerKeys.map(key => (partnerCounts.get(key) ?? 0) + 1))
      const projectedOpponent = Math.max(...opponentKeys.map(key => (opponentCounts.get(key) ?? 0) + 1))
      for (const key of partnerKeys) partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
      for (const key of opponentKeys) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      const aSum = teamSum(match.team_a)
      const bSum = teamSum(match.team_b)
      matchStats.push({
        round: round.roundNo,
        court: match.court_idx + 1,
        label: `${teamLabel(match.team_a)} vs ${teamLabel(match.team_b)}`,
        teamA: aSum,
        teamB: bSum,
        gap: Math.abs(aSum - bSum),
        maxIntraTeamGap: Math.max(
          Math.abs((names.get(match.team_a[0])?.pvna ?? 3) - (names.get(match.team_a[1])?.pvna ?? 3)),
          Math.abs((names.get(match.team_b[0])?.pvna ?? 3) - (names.get(match.team_b[1])?.pvna ?? 3)),
        ),
        maxProjectedPartnerPair: projectedPartner,
        maxProjectedOpponentPair: projectedOpponent,
        warningCount: round.warnings.length + round.tradeoffs,
      })
      for (const id of [...match.team_a, ...match.team_b]) {
        playedThisRound.add(id)
        matchCounts.set(id, (matchCounts.get(id) ?? 0) + 1)
      }
    }
    for (const id of round.resting) restCounts.set(id, (restCounts.get(id) ?? 0) + 1)
    for (const id of allPlayerIds) {
      if (playedThisRound.has(id)) {
        consecutiveRest.set(id, 0)
      } else {
        const next = (consecutiveRest.get(id) ?? 0) + 1
        consecutiveRest.set(id, next)
        maxConsecutiveRest.set(id, Math.max(maxConsecutiveRest.get(id) ?? 0, next))
      }
    }
  }

  const gaps = matchStats.map(row => row.gap)
  const intraGaps = matchStats.map(row => row.maxIntraTeamGap)
  const matchValues = [...matchCounts.values()]
  const restValues = [...restCounts.values()]
  const maxRestValues = [...maxConsecutiveRest.values()]
  const worstGaps = [...matchStats].sort((a, b) => b.gap - a.gap).slice(0, 10)

  console.log(JSON.stringify({
    sessionId,
    setup: {
      sourceSessionArg: requestedSessionId,
      dbSettings,
      courtCount,
      courtPreset,
      sessionDurationMin,
      matchDurationMin,
      pvnaTolerance,
    },
    mode: recomputePerMatch ? 'next-match-recompute-per-match-local-simulation' : 'next-match-current-queue-local-simulation',
    courtCalculator: {
      playerCount,
      preset: courtPreset,
      sessionDurationMin,
      matchDurationMin,
      recommendedCourts: courtCount,
      reasoning: courtCalculator.reasoning,
    },
    rounds: rounds.length,
    matches: matchStats.length,
    players: allPlayerIds.length,
    pvnaGap: {
      avg: format(avg(gaps)),
      p50: format(percentile(gaps, 50)),
      p90: format(percentile(gaps, 90)),
      max: format(Math.max(...gaps)),
      over_0_5: gaps.filter(value => value > 0.5).length,
      over_1_0: gaps.filter(value => value > 1).length,
    },
    intraTeamGap: {
      max: format(Math.max(...intraGaps)),
      over_1_5: intraGaps.filter(value => value > 1.5).length,
    },
    repeat: {
      matchesOverProjectedPairCap2: matchStats.filter(row => row.maxProjectedPartnerPair > 2 || row.maxProjectedOpponentPair > 2).length,
      maxFinalPartnerPairCount: Math.max(0, ...partnerCounts.values()),
      maxFinalOpponentPairCount: Math.max(0, ...opponentCounts.values()),
    },
    playerDistribution: {
      matchCount: {
        min: Math.min(...matchValues),
        max: Math.max(...matchValues),
        avg: format(avg(matchValues)),
        bucket: bucket(matchValues),
      },
      restCount: {
        min: Math.min(...restValues),
        max: Math.max(...restValues),
        avg: format(avg(restValues)),
        bucket: bucket(restValues),
        maxConsecutive: Math.max(...maxRestValues),
      },
    },
    warnings: {
      roundsWithWarningsOrTradeoffs: rounds.filter(round => round.warnings.length > 0 || round.tradeoffs > 0).length,
      warningCount: rounds.reduce((sum, round) => sum + round.warnings.length, 0),
      tradeoffCount: rounds.reduce((sum, round) => sum + round.tradeoffs, 0),
    },
    worstGaps: worstGaps.map(row => ({
      round: row.round + 1,
      court: row.court,
      match: row.label,
      sum: `${format(row.teamA)}-${format(row.teamB)}`,
      gap: format(row.gap),
      maxProjectedPartnerPair: row.maxProjectedPartnerPair,
      maxProjectedOpponentPair: row.maxProjectedOpponentPair,
    })),
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
