import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function seedTestData() {
  console.log('--- Seeding Test Data for Dashboard ---')

  // 1. Get the target host (assume host.confirmed@picklematch.vn or first user)
  let { data: hosts } = await supabase
    .from('players')
    .select('id, email')
    .ilike('email', '%host%')
    .limit(1)

  if (!hosts || hosts.length === 0) {
    console.log('No host user found, getting first available user...')
    const { data: anyUser } = await supabase.from('players').select('id, email').limit(1)
    if (!anyUser || anyUser.length === 0) {
      console.error('No users in DB!')
      return
    }
    hosts = anyUser
  }
  
  const hostId = hosts[0].id
  console.log(`Using Host: ${hosts[0].email} (${hostId})`)

  // 2. Clear existing sessions for this host
  console.log('Clearing existing sessions for this host...')
  const { data: oldSessions } = await supabase.from('sessions').select('id, slot_id').eq('host_id', hostId)
  if (oldSessions && oldSessions.length > 0) {
    const sessionIds = oldSessions.map(s => s.id)
    const slotIds = oldSessions.map(s => s.slot_id).filter(id => id != null)
    
    await supabase.from('session_players').delete().in('session_id', sessionIds)
    await supabase.from('join_requests').delete().in('match_id', sessionIds)
    await supabase.from('sessions').delete().in('id', sessionIds)
    if (slotIds.length > 0) {
      await supabase.from('court_slots').delete().in('id', slotIds)
    }
  }

  // 3. Create a Court if none exists
  let { data: courts } = await supabase.from('courts').select('id').limit(1)
  let courtId
  if (!courts || courts.length === 0) {
    console.log('Creating dummy court...')
    const { data: newCourt } = await supabase.from('courts').insert({
      name: 'Test Court',
      address: '123 Test St',
      total_courts: 4,
      status: 'active'
    }).select('id').single()
    courtId = newCourt.id
  } else {
    courtId = courts[0].id
  }

  // 4. Create an URGENT session (starts in 2 hours)
  console.log('Creating Urgent Session (starts in 2h)...')
  const now = new Date()
  const start = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 hours from now
  const end = new Date(now.getTime() + 4 * 60 * 60 * 1000) // 4 hours from now

  const { data: slot } = await supabase.from('court_slots').insert({
    court_id: courtId,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'booked'
  }).select('id').single()

  const { data: session } = await supabase.from('sessions').insert({
    host_id: hostId,
    slot_id: slot.id,
    title: 'Urgent Test Session',
    min_players: 4,
    max_players: 8, // 8 max players
    total_cost: 50000,
    status: 'confirmed', // Must be confirmed to show up normally in some views, or 'open'
    elo_min: 0,
    elo_max: 2000
  }).select('id').single()

  // Add format metadata
  await supabase.from('owner_sessions').insert({
    session_id: session.id,
    owner_id: hostId,
    format_type: 'social',
    sub_court_numbers: ['1']
  })

  // 5. Create 3 Dummy Players and add them to session
  // This will make confirmedCount = 3, max = 8. Ratio = 3/8 = 0.375 (< 0.6)
  // This triggers isUrgent logic.
  console.log('Creating 3 dummy players and adding to session...')
  for (let i = 1; i <= 3; i++) {
    // Create dummy player
    const { data: dummyPlayer } = await supabase.from('players').insert({
      name: `Dummy Player ${i}`,
      email: `dummy${i}_${Date.now()}@test.com`,
      gender: i % 2 === 0 ? 'F' : 'M'
    }).select('id').single()

    // Add to session
    await supabase.from('session_players').insert({
      session_id: session.id,
      player_id: dummyPlayer.id,
      status: 'confirmed'
    })
  }

  console.log('✅ Done! Check the Dashboard.')
  console.log('You should see an Urgent Session (Coral color) with 3/8 players.')
}

seedTestData().catch(console.error)
