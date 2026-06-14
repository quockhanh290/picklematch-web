import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const sessionId = process.argv[2]
const targetName = process.argv.slice(3).join(' ')
if (!sessionId || !targetName) throw new Error('Usage: npx tsx scratch/audit-session-player-rounds.ts <session-id> <player-name>')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Missing Supabase env')

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as any },
})

async function main() {
  const { error: authError } = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (authError) throw authError

  const [playersResult, matchesResult] = await Promise.all([
    client
      .from('session_player_state')
      .select('player_id, matches_played, last_played_round, consecutive_rest, consecutive_play, players(name, pvna)')
      .eq('session_id', sessionId),
    client
      .from('session_live_matches')
      .select('sequence_no, round_no, court_idx, status, team_a, team_b')
      .eq('session_id', sessionId)
      .neq('status', 'cancelled')
      .order('sequence_no', { ascending: true }),
  ])
  if (playersResult.error) throw playersResult.error
  if (matchesResult.error) throw matchesResult.error

  const player = (playersResult.data ?? []).find((row: any) => row.players?.name === targetName)
  if (!player) throw new Error(`Player not found: ${targetName}`)
  const matches = matchesResult.data ?? []
  const courtCount = Math.max(1, ...matches.map((row: any) => Number(row.court_idx ?? 0) + 1))
  const history = Array.from({ length: Math.ceil(matches.length / courtCount) }, (_, roundNo) => {
    const roundMatches = matches.slice(roundNo * courtCount, (roundNo + 1) * courtCount)
    const played = roundMatches.find((row: any) => [...row.team_a, ...row.team_b].includes(player.player_id))
    return {
      round: roundNo + 1,
      played: Boolean(played),
      sequence: played ? Number(played.sequence_no) : null,
      court: played ? Number(played.court_idx) + 1 : null,
    }
  })
  console.log(JSON.stringify({
    player: {
      id: player.player_id,
      name: player.players?.name,
      pvna: player.players?.pvna,
      matches_played: player.matches_played,
      last_played_round: player.last_played_round,
      consecutive_rest: player.consecutive_rest,
      consecutive_play: player.consecutive_play,
    },
    courtCount,
    history,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
