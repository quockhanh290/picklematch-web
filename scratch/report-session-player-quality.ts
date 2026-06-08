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
  matches: Match[]
  resting: string[]
}

type PlayerQuality = {
  playerId: string
  name: string
  pvna: number
  matches: number
  rests: number
  maxConsecutivePlay: number
  maxConsecutiveRest: number
  pvnaGaps: number[]
  intraGaps: number[]
  partnerRepeatEvents: number
  opponentRepeatEvents: number
  partnerRepeatMatches: number
  opponentRepeatMatches: number
  maxSamePartner: number
  maxSameOpponent: number
  recentPartnerRepeatWithin2: number
  recentOpponentRepeatWithin2: number
}

const sessionIds = process.argv.slice(2)
if (sessionIds.length === 0) {
  throw new Error('Usage: tsx scratch/report-session-player-quality.ts <session-id> [session-id...]')
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function format(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function summarizeValues(values: number[]) {
  return {
    avg: format(avg(values)),
    p90: format(percentile(values, 90)),
    max: format(Math.max(0, ...values)),
  }
}

function pairDistribution(counts: Map<string, number>) {
  const values = [...counts.values()]
  return {
    totalPairs: values.length,
    repeatedPairs: values.filter(value => value > 1).length,
    count2: values.filter(value => value === 2).length,
    count3: values.filter(value => value === 3).length,
    count4Plus: values.filter(value => value >= 4).length,
    max: Math.max(0, ...values),
  }
}

async function loadSessionReport(client: ReturnType<typeof createClient>, sessionId: string) {
  const [roundRes, liveMatchRes, playerRes] = await Promise.all([
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
      .select('player_id, players(name, pvna, current_elo, elo)')
      .eq('session_id', sessionId),
  ])
  if (roundRes.error) throw roundRes.error
  if (liveMatchRes.error) throw liveMatchRes.error
  if (playerRes.error) throw playerRes.error

  const players = new Map<string, PlayerQuality>()
  for (const row of (playerRes.data ?? []) as any[]) {
    const player = Array.isArray(row.players) ? row.players[0] : row.players
    const playerId = String(row.player_id)
    players.set(playerId, {
      playerId,
      name: player?.name ?? playerId.slice(0, 8),
      pvna: Number(player?.pvna ?? player?.current_elo ?? player?.elo ?? 3),
      matches: 0,
      rests: 0,
      maxConsecutivePlay: 0,
      maxConsecutiveRest: 0,
      pvnaGaps: [],
      intraGaps: [],
      partnerRepeatEvents: 0,
      opponentRepeatEvents: 0,
      partnerRepeatMatches: 0,
      opponentRepeatMatches: 0,
      maxSamePartner: 0,
      maxSameOpponent: 0,
      recentPartnerRepeatWithin2: 0,
      recentOpponentRepeatWithin2: 0,
    })
  }

  let rounds = ((roundRes.data ?? []) as any[]).map((row): RoundRow => ({
    round_no: Number(row.round_no),
    matches: row.matches ?? [],
    resting: row.resting ?? [],
  }))
  if (rounds.length === 0) {
    const liveRows = (liveMatchRes.data ?? []) as any[]
    const inferredCourtCount = Math.max(1, ...liveRows.map(row => Number(row.court_idx ?? 0) + 1))
    const byRound = new Map<number, RoundRow>()
    liveRows.forEach((row, index) => {
      const roundNo = Number(row.round_no ?? Math.floor(index / inferredCourtCount))
      const round = byRound.get(roundNo) ?? { round_no: roundNo, matches: [], resting: [] }
      round.matches.push({
        court_idx: Number(row.court_idx ?? round.matches.length),
        team_a: row.team_a,
        team_b: row.team_b,
      })
      byRound.set(roundNo, round)
    })
    rounds = [...byRound.values()].sort((a, b) => a.round_no - b.round_no)
  }

  const pvna = (playerId: string) => players.get(playerId)?.pvna ?? 3
  const teamSum = (team: [string, string]) => team.reduce((sum, playerId) => sum + pvna(playerId), 0)
  const partnerCounts = new Map<string, number>()
  const opponentCounts = new Map<string, number>()
  const lastPartnerRound = new Map<string, number>()
  const lastOpponentRound = new Map<string, number>()
  const currentPlayStreak = new Map([...players.keys()].map(id => [id, 0]))
  const currentRestStreak = new Map([...players.keys()].map(id => [id, 0]))

  for (const round of rounds) {
    const playedThisRound = new Set<string>()
    for (const match of round.matches) {
      const teamA = match.team_a
      const teamB = match.team_b
      const teamAGap = Math.abs(pvna(teamA[0]) - pvna(teamA[1]))
      const teamBGap = Math.abs(pvna(teamB[0]) - pvna(teamB[1]))
      const pvnaGap = Math.abs(teamSum(teamA) - teamSum(teamB))
      const partnerPairs: Array<[string, string]> = [teamA, teamB]
      const opponentPairs = teamA.flatMap(a => teamB.map(b => [a, b] as [string, string]))

      for (const [left, right] of partnerPairs) {
        const key = pairKey(left, right)
        const before = partnerCounts.get(key) ?? 0
        const lastRound = lastPartnerRound.get(key)
        for (const playerId of [left, right]) {
          const quality = players.get(playerId)
          if (!quality) continue
          if (before > 0) {
            quality.partnerRepeatEvents += before
            quality.partnerRepeatMatches += 1
          }
          if (lastRound !== undefined && round.round_no - lastRound <= 2) {
            quality.recentPartnerRepeatWithin2 += 1
          }
          quality.maxSamePartner = Math.max(quality.maxSamePartner, before + 1)
        }
        partnerCounts.set(key, before + 1)
        lastPartnerRound.set(key, round.round_no)
      }

      for (const [left, right] of opponentPairs) {
        const key = pairKey(left, right)
        const before = opponentCounts.get(key) ?? 0
        const lastRound = lastOpponentRound.get(key)
        for (const playerId of [left, right]) {
          const quality = players.get(playerId)
          if (!quality) continue
          if (before > 0) {
            quality.opponentRepeatEvents += before
            quality.opponentRepeatMatches += 1
          }
          if (lastRound !== undefined && round.round_no - lastRound <= 2) {
            quality.recentOpponentRepeatWithin2 += 1
          }
          quality.maxSameOpponent = Math.max(quality.maxSameOpponent, before + 1)
        }
        opponentCounts.set(key, before + 1)
        lastOpponentRound.set(key, round.round_no)
      }

      for (const playerId of [...teamA, ...teamB]) {
        const quality = players.get(playerId)
        if (!quality) continue
        playedThisRound.add(playerId)
        quality.matches += 1
        quality.pvnaGaps.push(pvnaGap)
        quality.intraGaps.push(teamA.includes(playerId) ? teamAGap : teamBGap)
      }
    }

    for (const playerId of players.keys()) {
      const quality = players.get(playerId)!
      if (playedThisRound.has(playerId)) {
        const nextPlay = (currentPlayStreak.get(playerId) ?? 0) + 1
        currentPlayStreak.set(playerId, nextPlay)
        currentRestStreak.set(playerId, 0)
        quality.maxConsecutivePlay = Math.max(quality.maxConsecutivePlay, nextPlay)
      } else {
        quality.rests += 1
        const nextRest = (currentRestStreak.get(playerId) ?? 0) + 1
        currentRestStreak.set(playerId, nextRest)
        currentPlayStreak.set(playerId, 0)
        quality.maxConsecutiveRest = Math.max(quality.maxConsecutiveRest, nextRest)
      }
    }
  }

  const rows = [...players.values()]
  const scored = rows.map(row => {
    const pvnaOver = row.pvnaGaps.filter(value => value > 0.5).length
    const intraOver = row.intraGaps.filter(value => value > 1.5).length
    return {
      playerId: row.playerId,
      name: row.name,
      pvna: format(row.pvna),
      matches: row.matches,
      rests: row.rests,
      maxConsecutivePlay: row.maxConsecutivePlay,
      maxConsecutiveRest: row.maxConsecutiveRest,
      avgPvnaGap: format(avg(row.pvnaGaps)),
      maxPvnaGap: format(Math.max(0, ...row.pvnaGaps)),
      pvnaOver,
      avgIntraGap: format(avg(row.intraGaps)),
      maxIntraGap: format(Math.max(0, ...row.intraGaps)),
      intraOver,
      partnerRepeatEvents: row.partnerRepeatEvents,
      partnerRepeatMatches: row.partnerRepeatMatches,
      opponentRepeatEvents: row.opponentRepeatEvents,
      opponentRepeatMatches: row.opponentRepeatMatches,
      maxSamePartner: row.maxSamePartner,
      maxSameOpponent: row.maxSameOpponent,
      recentPartnerRepeatWithin2: row.recentPartnerRepeatWithin2,
      recentOpponentRepeatWithin2: row.recentOpponentRepeatWithin2,
      burden:
        pvnaOver * 8 +
        Math.max(0, Math.max(0, ...row.pvnaGaps) - 0.5) * 6 +
        intraOver * 4 +
        row.partnerRepeatMatches * 6 +
        row.opponentRepeatMatches * 2 +
        row.recentPartnerRepeatWithin2 * 4 +
        Math.max(0, row.maxConsecutivePlay - 3) * 10,
    }
  })

  const burdens = scored.map(row => row.burden)
  const pvnaOverValues = scored.map(row => row.pvnaOver)
  const intraOverValues = scored.map(row => row.intraOver)
  const partnerRepeatValues = scored.map(row => row.partnerRepeatMatches)
  const opponentRepeatValues = scored.map(row => row.opponentRepeatMatches)
  const partnerRepeatEventValues = scored.map(row => row.partnerRepeatEvents)
  const opponentRepeatEventValues = scored.map(row => row.opponentRepeatEvents)
  const recentPartnerRepeatValues = scored.map(row => row.recentPartnerRepeatWithin2)
  const recentOpponentRepeatValues = scored.map(row => row.recentOpponentRepeatWithin2)
  return {
    sessionId,
    rounds: rounds.length,
    players: players.size,
    summary: {
      burden: summarizeValues(burdens),
      maxPvnaGapByPlayer: summarizeValues(scored.map(row => row.maxPvnaGap)),
      pvnaOverMatchesByPlayer: {
        avg: format(avg(pvnaOverValues)),
        max: Math.max(0, ...pvnaOverValues),
        playersWithAny: pvnaOverValues.filter(value => value > 0).length,
      },
      intraOverMatchesByPlayer: {
        avg: format(avg(intraOverValues)),
        max: Math.max(0, ...intraOverValues),
        playersWithAny: intraOverValues.filter(value => value > 0).length,
      },
      repeat: {
        partner: {
          pairDistribution: pairDistribution(partnerCounts),
          matchesByPlayer: {
            avg: format(avg(partnerRepeatValues)),
            max: Math.max(0, ...partnerRepeatValues),
            playersWithAny: partnerRepeatValues.filter(value => value > 0).length,
          },
          eventsByPlayer: {
            avg: format(avg(partnerRepeatEventValues)),
            max: Math.max(0, ...partnerRepeatEventValues),
          },
          recentWithin2RoundsByPlayer: {
            avg: format(avg(recentPartnerRepeatValues)),
            max: Math.max(0, ...recentPartnerRepeatValues),
            playersWithAny: recentPartnerRepeatValues.filter(value => value > 0).length,
          },
        },
        opponent: {
          pairDistribution: pairDistribution(opponentCounts),
          matchesByPlayer: {
            avg: format(avg(opponentRepeatValues)),
            max: Math.max(0, ...opponentRepeatValues),
            playersWithAny: opponentRepeatValues.filter(value => value > 0).length,
          },
          eventsByPlayer: {
            avg: format(avg(opponentRepeatEventValues)),
            max: Math.max(0, ...opponentRepeatEventValues),
          },
          recentWithin2RoundsByPlayer: {
            avg: format(avg(recentOpponentRepeatValues)),
            max: Math.max(0, ...recentOpponentRepeatValues),
            playersWithAny: recentOpponentRepeatValues.filter(value => value > 0).length,
          },
        },
      },
      maxSamePartner: Math.max(0, ...scored.map(row => row.maxSamePartner)),
      maxSameOpponent: Math.max(0, ...scored.map(row => row.maxSameOpponent)),
      maxConsecutivePlay: Math.max(0, ...scored.map(row => row.maxConsecutivePlay)),
      maxConsecutiveRest: Math.max(0, ...scored.map(row => row.maxConsecutiveRest)),
    },
    worstPlayers: scored
      .sort((left, right) => right.burden - left.burden)
      .slice(0, 10),
  }
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

  const reports = []
  for (const sessionId of sessionIds) {
    reports.push(await loadSessionReport(client, sessionId))
  }
  console.log(JSON.stringify(reports, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
