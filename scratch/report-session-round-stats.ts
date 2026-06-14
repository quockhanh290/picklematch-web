import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

type Match = {
  court_idx: number
  team_a: [string, string]
  team_b: [string, string]
}

type RoundRow = {
  round_no: number
  status: string
  matches: Match[]
  resting: string[]
}

type PlayerRow = {
  player_id: string
  name: string
  pvna: string | number | null
}

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/report-session-round-stats.ts <session-id>')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

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

async function main() {
  const client = createClient(url!, anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signInError) throw signInError

  const [roundRes, liveMatchRes, playerRes, pairRes] = await Promise.all([
    client
      .from('session_rounds')
      .select('round_no, status, matches, resting')
      .eq('session_id', sessionId)
      .order('round_no', { ascending: true }),
    client
      .from('session_live_matches')
      .select('sequence_no, round_no, court_idx, status, team_a, team_b, resting')
      .eq('session_id', sessionId)
      .neq('status', 'cancelled')
      .order('sequence_no', { ascending: true }),
    client
      .from('session_player_state')
      .select('player_id, players(name, pvna)')
      .eq('session_id', sessionId),
    client
      .from('session_pair_history')
      .select('player_a, player_b, partner_count, opponent_count')
      .eq('session_id', sessionId),
  ])
  if (roundRes.error) throw roundRes.error
  if (liveMatchRes.error) throw liveMatchRes.error
  if (playerRes.error) throw playerRes.error
  if (pairRes.error) throw pairRes.error

  let rounds = ((roundRes.data ?? []) as any[]).map((row): RoundRow => ({
    round_no: Number(row.round_no),
    status: String(row.status),
    matches: row.matches ?? [],
    resting: row.resting ?? [],
  }))
  if (rounds.length === 0) {
    const liveRows = (liveMatchRes.data ?? []) as any[]
    const inferredCourtCount = Math.max(1, ...liveRows.map(row => Number(row.court_idx ?? 0) + 1))
    const byRound = new Map<number, RoundRow>()
    liveRows.forEach((row, index) => {
      const roundNo = Number(row.round_no ?? Math.floor(index / inferredCourtCount))
      const round = byRound.get(roundNo) ?? {
        round_no: roundNo,
        status: 'completed',
        matches: [],
        resting: [],
      }
      round.matches.push({
        court_idx: Number(row.court_idx ?? round.matches.length),
        team_a: row.team_a,
        team_b: row.team_b,
      })
      byRound.set(roundNo, round)
    })
    rounds = [...byRound.values()].sort((a, b) => a.round_no - b.round_no)
  }
  const players = new Map<string, PlayerRow>()
  for (const row of (playerRes.data ?? []) as any[]) {
    players.set(String(row.player_id), {
      player_id: String(row.player_id),
      name: row.players?.name ?? String(row.player_id).slice(0, 8),
      pvna: row.players?.pvna ?? null,
    })
  }

  const pvna = (playerId: string) => Number(players.get(playerId)?.pvna ?? 3)
  const name = (playerId: string) => players.get(playerId)?.name ?? playerId.slice(0, 8)
  const teamSum = (team: [string, string]) => team.reduce((sum, playerId) => sum + pvna(playerId), 0)
  const teamLabel = (team: [string, string]) => `${name(team[0])}+${name(team[1])}`

  const matchCounts = new Map([...players.keys()].map(id => [id, 0]))
  const restCounts = new Map([...players.keys()].map(id => [id, 0]))
  const consecutiveRest = new Map([...players.keys()].map(id => [id, 0]))
  const maxConsecutiveRest = new Map([...players.keys()].map(id => [id, 0]))
  const consecutivePlay = new Map([...players.keys()].map(id => [id, 0]))
  const maxConsecutivePlay = new Map([...players.keys()].map(id => [id, 0]))
  const pvnaOverExposure = new Map([...players.keys()].map(id => [id, 0]))
  const intraOverExposure = new Map([...players.keys()].map(id => [id, 0]))
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()

  const matchStats: Array<{
    round: number
    court: number
    label: string
    gap: number
    teamA: number
    teamB: number
    maxIntraTeamGap: number
    partnerRepeatBefore: number
    opponentRepeatBefore: number
    maxProjectedPartnerPair: number
    maxProjectedOpponentPair: number
  }> = []

  for (const round of rounds) {
    const playedThisRound = new Set<string>()
    for (const match of round.matches) {
      const teamA = match.team_a
      const teamB = match.team_b
      const partnerAKey = pairKey(teamA[0], teamA[1])
      const partnerBKey = pairKey(teamB[0], teamB[1])
      const opponentKeys = teamA.flatMap(a => teamB.map(b => pairKey(a, b)))
      const partnerRepeatBefore = (partnerCounts.get(partnerAKey) ?? 0) + (partnerCounts.get(partnerBKey) ?? 0)
      const opponentRepeatBefore = opponentKeys.reduce((sum, key) => sum + (opponentCounts.get(key) ?? 0), 0)
      const projectedPartnerA = (partnerCounts.get(partnerAKey) ?? 0) + 1
      const projectedPartnerB = (partnerCounts.get(partnerBKey) ?? 0) + 1
      const projectedOpponentCounts = opponentKeys.map(key => (opponentCounts.get(key) ?? 0) + 1)

      const aSum = teamSum(teamA)
      const bSum = teamSum(teamB)
      const gap = Math.abs(aSum - bSum)
      const maxIntraTeamGap = Math.max(
        Math.abs(pvna(teamA[0]) - pvna(teamA[1])),
        Math.abs(pvna(teamB[0]) - pvna(teamB[1])),
      )
      matchStats.push({
        round: round.round_no,
        court: (match.court_idx ?? 0) + 1,
        label: `${teamLabel(teamA)} vs ${teamLabel(teamB)}`,
        gap,
        teamA: aSum,
        teamB: bSum,
        maxIntraTeamGap,
        partnerRepeatBefore,
        opponentRepeatBefore,
        maxProjectedPartnerPair: Math.max(projectedPartnerA, projectedPartnerB),
        maxProjectedOpponentPair: Math.max(...projectedOpponentCounts),
      })

      partnerCounts.set(partnerAKey, projectedPartnerA)
      partnerCounts.set(partnerBKey, projectedPartnerB)
      for (const key of opponentKeys) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      for (const playerId of [...teamA, ...teamB]) {
        playedThisRound.add(playerId)
        matchCounts.set(playerId, (matchCounts.get(playerId) ?? 0) + 1)
        if (gap > 0.5) pvnaOverExposure.set(playerId, (pvnaOverExposure.get(playerId) ?? 0) + 1)
        if (maxIntraTeamGap > 1.5) intraOverExposure.set(playerId, (intraOverExposure.get(playerId) ?? 0) + 1)
      }
    }

    for (const playerId of players.keys()) {
      if (playedThisRound.has(playerId)) {
        consecutiveRest.set(playerId, 0)
        const next = (consecutivePlay.get(playerId) ?? 0) + 1
        consecutivePlay.set(playerId, next)
        maxConsecutivePlay.set(playerId, Math.max(maxConsecutivePlay.get(playerId) ?? 0, next))
      } else {
        consecutivePlay.set(playerId, 0)
        restCounts.set(playerId, (restCounts.get(playerId) ?? 0) + 1)
        const next = (consecutiveRest.get(playerId) ?? 0) + 1
        consecutiveRest.set(playerId, next)
        maxConsecutiveRest.set(playerId, Math.max(maxConsecutiveRest.get(playerId) ?? 0, next))
      }
    }
  }

  const gaps = matchStats.map(row => row.gap)
  const intraGaps = matchStats.map(row => row.maxIntraTeamGap)
  const matchValues = [...matchCounts.values()]
  const restValues = [...restCounts.values()]
  const maxRestValues = [...maxConsecutiveRest.values()]
  const finalPairRows = (pairRes.data ?? []) as any[]
  const partnerFinal = finalPairRows.map(row => Number(row.partner_count ?? 0))
  const opponentFinal = finalPairRows.map(row => Number(row.opponent_count ?? 0))
  const worstGaps = [...matchStats].sort((a, b) => b.gap - a.gap).slice(0, 10)
  const repeatCapMatches = matchStats.filter(row => row.maxProjectedPartnerPair > 2 || row.maxProjectedOpponentPair > 2)
  const pairBurdenByPlayer = new Map([...players.keys()].map(id => [id, {
    uniquePartners: 0,
    uniqueOpponents: 0,
    repeatedPartners: 0,
    repeatedOpponents: 0,
  }]))
  for (const row of finalPairRows) {
    const playerIds = [String(row.player_a), String(row.player_b)]
    for (const playerId of playerIds) {
      const burden = pairBurdenByPlayer.get(playerId)
      if (!burden) continue
      const partnerCount = Number(row.partner_count ?? 0)
      const opponentCount = Number(row.opponent_count ?? 0)
      if (partnerCount > 0) burden.uniquePartners += 1
      if (opponentCount > 0) burden.uniqueOpponents += 1
      burden.repeatedPartners += Math.max(0, partnerCount - 1)
      burden.repeatedOpponents += Math.max(0, opponentCount - 1)
    }
  }
  const perPlayer = [...players.keys()].map(playerId => {
    const burden = pairBurdenByPlayer.get(playerId)!
    return {
      player: name(playerId),
      pvna: format(pvna(playerId)),
      matches: matchCounts.get(playerId) ?? 0,
      rests: restCounts.get(playerId) ?? 0,
      maxConsecutivePlay: maxConsecutivePlay.get(playerId) ?? 0,
      maxConsecutiveRest: maxConsecutiveRest.get(playerId) ?? 0,
      uniquePartners: burden.uniquePartners,
      repeatedPartners: burden.repeatedPartners,
      uniqueOpponents: burden.uniqueOpponents,
      repeatedOpponents: burden.repeatedOpponents,
      pvnaOverExposure: pvnaOverExposure.get(playerId) ?? 0,
      intraOverExposure: intraOverExposure.get(playerId) ?? 0,
    }
  }).sort((left, right) =>
    right.repeatedPartners - left.repeatedPartners
    || right.repeatedOpponents - left.repeatedOpponents
    || right.pvnaOverExposure - left.pvnaOverExposure
    || right.intraOverExposure - left.intraOverExposure
    || left.player.localeCompare(right.player),
  )

  console.log(JSON.stringify({
    sessionId,
    rounds: rounds.length,
    matches: matchStats.length,
    players: players.size,
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
      matchesWithAnyPartnerRepeatBefore: matchStats.filter(row => row.partnerRepeatBefore > 0).length,
      matchesWithAnyOpponentRepeatBefore: matchStats.filter(row => row.opponentRepeatBefore > 0).length,
      matchesOverProjectedPairCap2: repeatCapMatches.length,
      maxFinalPartnerPairCount: Math.max(0, ...partnerFinal),
      maxFinalOpponentPairCount: Math.max(0, ...opponentFinal),
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
    worstGaps: worstGaps.map(row => ({
      round: row.round + 1,
      court: row.court,
      match: row.label,
      sum: `${format(row.teamA)}-${format(row.teamB)}`,
      gap: format(row.gap),
      partnerRepeatBefore: row.partnerRepeatBefore,
      opponentRepeatBefore: row.opponentRepeatBefore,
      maxProjectedPartnerPair: row.maxProjectedPartnerPair,
      maxProjectedOpponentPair: row.maxProjectedOpponentPair,
    })),
    repeatCapExamples: repeatCapMatches.slice(0, 10).map(row => ({
      round: row.round + 1,
      court: row.court,
      match: row.label,
      gap: format(row.gap),
      maxProjectedPartnerPair: row.maxProjectedPartnerPair,
      maxProjectedOpponentPair: row.maxProjectedOpponentPair,
    })),
    perPlayer,
  }, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
