import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

type Player = { id: string; name: string; pvna: number }
type Match = {
  teamA: [Player, Player]
  teamB: [Player, Player]
  pvna: number
  intra: number
}

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: npx tsx scratch/audit-round1-intra-feasibility.ts <session-id>')

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const PVNA_CAP = 0.5
const INTRA_CAP = 0.75
const COURTS = 6

function sum(team: [Player, Player]) {
  return team[0].pvna + team[1].pvna
}

function intra(team: [Player, Player]) {
  return Math.abs(team[0].pvna - team[1].pvna)
}

function buildMatch(teamA: [Player, Player], teamB: [Player, Player]): Match {
  return {
    teamA,
    teamB,
    pvna: Math.abs(sum(teamA) - sum(teamB)),
    intra: Math.max(intra(teamA), intra(teamB)),
  }
}

function idsOf(match: Match) {
  return [...match.teamA, ...match.teamB].map(player => player.id)
}

function findDisjoint(matches: Match[], depth = COURTS) {
  const byFirstPlayer = new Map<string, Match[]>()
  for (const match of matches) {
    for (const id of idsOf(match)) {
      byFirstPlayer.set(id, [...(byFirstPlayer.get(id) ?? []), match])
    }
  }

  const playersInAny = [...new Set(matches.flatMap(idsOf))]
  const search = (chosen: Match[], used: Set<string>): Match[] | null => {
    if (chosen.length === depth) return chosen
    const remainingSlots = (depth - chosen.length) * 4
    const availablePlayers = playersInAny.filter(id => !used.has(id)).length
    if (availablePlayers < remainingSlots) return null

    const anchor = playersInAny.find(id => !used.has(id))
    if (!anchor) return null
    const options = byFirstPlayer.get(anchor) ?? []
    for (const match of options) {
      const ids = idsOf(match)
      if (ids.some(id => used.has(id))) continue
      const nextUsed = new Set([...used, ...ids])
      const found = search([...chosen, match], nextUsed)
      if (found) return found
    }
    return null
  }

  return search([], new Set())
}

async function main() {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signInError) throw signInError

  const { data, error } = await client
    .from('session_player_state')
    .select('player_id, checked_out_at, players(name, pvna)')
    .eq('session_id', sessionId)
    .is('checked_out_at', null)
  if (error) throw error

  const players: Player[] = (data ?? []).map((row: any) => ({
    id: row.player_id,
    name: row.players?.name ?? row.player_id,
    pvna: Number(row.players?.pvna ?? 0),
  }))

  const matches: Match[] = []
  for (let a = 0; a < players.length; a += 1) {
    for (let b = a + 1; b < players.length; b += 1) {
      for (let c = b + 1; c < players.length; c += 1) {
        for (let d = c + 1; d < players.length; d += 1) {
          const p = [players[a], players[b], players[c], players[d]]
          const splits: Array<[[Player, Player], [Player, Player]]> = [
            [[p[0], p[1]], [p[2], p[3]]],
            [[p[0], p[2]], [p[1], p[3]]],
            [[p[0], p[3]], [p[1], p[2]]],
          ]
          for (const [teamA, teamB] of splits) {
            const match = buildMatch(teamA, teamB)
            if (match.pvna <= PVNA_CAP + 1e-9 && match.intra <= INTRA_CAP + 1e-9) {
              matches.push(match)
            }
          }
        }
      }
    }
  }

  matches.sort((left, right) => left.intra - right.intra || left.pvna - right.pvna)
  const found = findDisjoint(matches)
  console.log(JSON.stringify({
    sessionId,
    playerCount: players.length,
    feasibleCandidateMatches: matches.length,
    found: Boolean(found),
    matches: (found ?? []).map((match, index) => ({
      court: index + 1,
      teamA: match.teamA.map(player => `${player.name} ${player.pvna}`),
      teamB: match.teamB.map(player => `${player.name} ${player.pvna}`),
      pvna: Number(match.pvna.toFixed(2)),
      intra: Number(match.intra.toFixed(2)),
    })),
    resting: found
      ? players
          .filter(player => !new Set(found.flatMap(idsOf)).has(player.id))
          .map(player => `${player.name} ${player.pvna}`)
      : [],
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
