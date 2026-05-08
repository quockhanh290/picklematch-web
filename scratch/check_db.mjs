import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkLatestRegistration() {
  console.log('Checking latest registrations...')
  
  // 1. Get latest players
  const { data: players, error: playerError } = await supabase
    .from('players')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  if (playerError) {
    console.error('Error fetching players:', playerError)
    return
  }

  console.log('\n--- Latest Players ---')
  players.forEach(p => {
    console.log(`ID: ${p.id}, Name: ${p.name}, Phone: ${p.phone}, Guest: ${p.is_guest}, Created: ${p.created_at}`)
  })

  // 2. Get latest session joins
  const { data: joins, error: joinError } = await supabase
    .from('session_players')
    .select('*, players(name), sessions(id, title)')
    .order('created_at', { ascending: false })
    .limit(5)

  if (joinError) {
    console.error('Error fetching session_players:', joinError)
    return
  }

  console.log('\n--- Latest Session Joins ---')
  joins.forEach(j => {
    console.log(`Session: ${j.sessions?.id} (${j.sessions?.title}), Player: ${j.players?.name}, Status: ${j.status}, Joined: ${j.created_at}`)
  })
}

checkLatestRegistration()
