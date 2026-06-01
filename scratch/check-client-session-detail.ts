import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

async function main() {
const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/check-client-session-detail.ts <session-id>')

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('Missing Supabase env')

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws as any },
})

const email = process.env.HOST_EMAIL ?? 'host@test.com'
const password = process.env.HOST_PASSWORD ?? '123456'
const signIn = await client.auth.signInWithPassword({ email, password })
if (signIn.error) throw signIn.error

const sessionRes = await client.rpc('get_session_detail_overview', { p_session_id: sessionId })
if (sessionRes.error) throw sessionRes.error
const session = sessionRes.data?.session
const players = session?.session_players ?? []
console.log(`session_players=${players.length}`)
for (const item of players) {
  const player = item.player
  if (!player?.name) continue
  if (['P17', 'P35', 'P27', 'P23', 'P10', 'P3', 'P7', 'P28'].includes(player.name)) {
    console.log(`${player.name} status=${item.status} checkIn=${item.check_in_status} pvna=${player.pvna} elo=${player.elo} current=${player.current_elo}`)
  }
}
}

void main()
