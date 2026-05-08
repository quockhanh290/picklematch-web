import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function checkSessions() {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('id, max_players, status, results_status, slot:slot_id(end_time), players:session_players(player_id, status)')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error(error)
    return
  }

  sessions.forEach(s => {
    const confirmedCount = s.players.filter(p => p.status === 'confirmed').length
    const isAfterEnd = s.slot ? new Date() > new Date(s.slot.end_time) : false
    console.log(`Session ${s.id}:`)
    console.log(`  Max: ${s.max_players}, Confirmed: ${confirmedCount}`)
    console.log(`  Status: ${s.status}, Results: ${s.results_status}`)
    console.log(`  After End: ${isAfterEnd}`)
  })
}

checkSessions()
