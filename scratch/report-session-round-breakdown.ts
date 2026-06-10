import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const sessionIds = process.argv.slice(2)
if (sessionIds.length === 0) {
  throw new Error('Usage: tsx scratch/report-session-round-breakdown.ts <session-id> [session-id...]')
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => `${value}:${count}`).join(', ')
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

  const output = []
  for (const sessionId of sessionIds) {
    const [matchRes, playerRes] = await Promise.all([
      client
        .from('session_live_matches')
        .select('sequence_no, round_no, court_idx, status, team_a, team_b')
        .eq('session_id', sessionId)
        .neq('status', 'cancelled')
        .order('sequence_no', { ascending: true }),
      client
        .from('session_player_state')
        .select('player_id, players(name, pvna)')
        .eq('session_id', sessionId),
    ])
    if (matchRes.error) throw matchRes.error
    if (playerRes.error) throw playerRes.error

    const players = new Map<string, { name: string; pvna: number }>()
    for (const row of playerRes.data ?? []) {
      players.set(String(row.player_id), {
        name: String((row as any).players?.name ?? row.player_id),
        pvna: Number((row as any).players?.pvna ?? 0),
      })
    }
    const completedRows = (matchRes.data ?? []).filter(row => row.status === 'completed')
    const inferredCourtCount = Math.max(1, ...completedRows.map(row => Number(row.court_idx ?? 0) + 1))
    const matches = completedRows
      .map((row, index) => ({
        sequence_no: Number(row.sequence_no ?? index),
        round_no: Number(row.round_no ?? Math.floor(index / inferredCourtCount)),
        court_idx: Number(row.court_idx ?? 0),
        team_a: row.team_a as [string, string],
        team_b: row.team_b as [string, string],
      }))

    const partnerCounts = new Map<string, number>()
    const opponentCounts = new Map<string, number>()
    const matchCounts = new Map([...players.keys()].map(playerId => [playerId, 0]))
    const rounds = []

    for (let roundNo = 0; roundNo < 8; roundNo += 1) {
      const roundMatches = matches.filter(match => match.round_no === roundNo)
      const pvnaGaps: number[] = []
      const intraGaps: number[] = []
      let pvnaOver = 0
      let intraOver = 0
      let partnerRepeatMatches = 0
      let opponentRepeatMatches = 0
      const worst = { gap: -1, match: '' }

      for (const match of roundMatches) {
        const teamSum = (team: [string, string]) => team.reduce((sum, id) => sum + (players.get(id)?.pvna ?? 0), 0)
        const teamName = (team: [string, string]) => team.map(id => players.get(id)?.name ?? id.slice(0, 8)).join('+')
        const gap = Math.abs(teamSum(match.team_a) - teamSum(match.team_b))
        const intra = Math.max(
          Math.abs((players.get(match.team_a[0])?.pvna ?? 0) - (players.get(match.team_a[1])?.pvna ?? 0)),
          Math.abs((players.get(match.team_b[0])?.pvna ?? 0) - (players.get(match.team_b[1])?.pvna ?? 0)),
        )
        pvnaGaps.push(gap)
        intraGaps.push(intra)
        if (gap > 0.5) pvnaOver += 1
        if (intra > 1.5) intraOver += 1
        if (gap > worst.gap) {
          worst.gap = gap
          worst.match = `${teamName(match.team_a)} vs ${teamName(match.team_b)}`
        }

        const partnerPairs = [pairKey(match.team_a[0], match.team_a[1]), pairKey(match.team_b[0], match.team_b[1])]
        const opponentPairs = match.team_a.flatMap(a => match.team_b.map(b => pairKey(a, b)))
        if (partnerPairs.some(key => (partnerCounts.get(key) ?? 0) > 0)) partnerRepeatMatches += 1
        if (opponentPairs.some(key => (opponentCounts.get(key) ?? 0) > 0)) opponentRepeatMatches += 1

        for (const key of partnerPairs) partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
        for (const key of opponentPairs) opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
        for (const playerId of [...match.team_a, ...match.team_b]) {
          matchCounts.set(playerId, (matchCounts.get(playerId) ?? 0) + 1)
        }
      }

      rounds.push({
        round: roundNo + 1,
        matches: roundMatches.length,
        pvnaAvg: round(avg(pvnaGaps)),
        pvnaMax: round(Math.max(0, ...pvnaGaps)),
        pvnaOver,
        intraMax: round(Math.max(0, ...intraGaps)),
        intraOver,
        partnerRepeatMatches,
        opponentRepeatMatches,
        countBucketAfterRound: bucket([...matchCounts.values()]),
        worstMatch: worst.match,
      })
    }

    output.push({ sessionId, rounds })
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
