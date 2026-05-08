import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/fill-missing-players.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const DUMMY_PLAYER_IDS = [
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000004',
  '90000000-0000-0000-0000-000000000006',
  '90000000-0000-0000-0000-000000000007'
]

async function fillMissingPlayers() {
  console.log('Fetching past-due sessions that are under-populated...')
  
  // 1. Get candidate sessions
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, max_players, status, session_players(player_id, status, team_no)')
    .in('status', ['open', 'pending_completion'])
    .lt('end_time', new Date().toISOString())

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError)
    return
  }

  console.log(`Found ${sessions.length} candidate sessions.`)

  for (const session of sessions) {
    const confirmedPlayers = session.session_players.filter(p => p.status === 'confirmed')
    const missingCount = session.max_players - confirmedPlayers.length

    if (missingCount <= 0) continue

    console.log(`\nProcessing session ${session.id}:`)
    console.log(`- Max players: ${session.max_players}`)
    console.log(`- Current confirmed: ${confirmedPlayers.length}`)
    console.log(`- Missing: ${missingCount}`)

    // Update status if it was open
    if (session.status === 'open') {
      await supabase
        .from('sessions')
        .update({ 
          status: 'pending_completion',
          pending_completion_marked_at: new Date().toISOString()
        })
        .eq('id', session.id)
      console.log('- Status transitioned to pending_completion')
    }

    let filled = 0
    for (const dummyId of DUMMY_PLAYER_IDS) {
      if (filled >= missingCount) break
      
      const alreadyIn = session.session_players.some(p => p.player_id === dummyId)
      if (alreadyIn) continue

      // Calculate team balancing
      const _team1Count = confirmedPlayers.filter(p => p.team_no === 1).length + (filled % 2 === 0 ? 0 : 0) // Simplified
      // Actually let's just count current players in the session
      const { data: currentPlayers } = await supabase
        .from('session_players')
        .select('team_no')
        .eq('session_id', session.id)
      
      const t1 = (currentPlayers || []).filter(p => p.team_no === 1).length
      const t2 = (currentPlayers || []).filter(p => p.team_no === 2).length
      const teamNo = t1 <= t2 ? 1 : 2

      const { error: insertError } = await supabase
        .from('session_players')
        .insert({
          session_id: session.id,
          player_id: dummyId,
          status: 'confirmed',
          team_no: teamNo
        })

      if (insertError) {
        console.error(`  - Error adding player ${dummyId}:`, insertError.message)
      } else {
        console.log(`  - Added dummy player ${dummyId} to Team ${teamNo}`)
        filled++
      }
    }
  }

  console.log('\nFinished filling sessions.')
}

fillMissingPlayers()
