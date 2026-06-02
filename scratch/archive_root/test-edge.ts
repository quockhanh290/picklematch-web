const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_KEY'

const sessionId = '8c5e92eb-e720-40a0-a60a-6dfdcc229f9c'

async function run() {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_live_session_snapshot_versioned`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`
    },
    body: JSON.stringify({ p_session_id: sessionId })
  })
  const snapshot = await res.json()
  
  if (!snapshot || !snapshot.player_rows) {
    console.log('No snapshot', snapshot)
    return
  }

  console.log('Calling Edge Function...')
  const funcRes = await fetch(`${supabaseUrl}/functions/v1/session-live-matches-suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`
    },
    body: JSON.stringify({
      count: 6,
      court_count: 6,
      pvna_tolerance: 0.5,
      live_match_rows: snapshot.live_match_rows,
      live_state_version: snapshot.live_state_version,
      client_player_states: snapshot.player_rows,
    })
  })

  const data = await funcRes.json()

  console.log('Payloads returned:', data?.payloads?.length)
  if (data?.payloads) {
    data.payloads.forEach((p: any, i: number) => {
      console.log(`Payload ${i}: court_idx=${p.court_idx}, team_a=${p.team_a}, team_b=${p.team_b}`)
    })
  } else {
    console.log('Error:', data)
  }
}

run().catch(console.error)
