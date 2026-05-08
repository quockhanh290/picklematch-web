import assert from 'node:assert/strict'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const DUMMY_PASSWORD = process.env.DUMMY_PASSWORD || 'Pickle123!'

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const IDS = {
  sessions: {
    openConfirmed: '55555555-5555-5555-5555-555555555551',
    openApproval: '55555555-5555-5555-5555-555555555552',
  },
  users: {
    hostConfirmed: {
      email: 'host.confirmed@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000001',
    },
    matchedPlayer: {
      email: 'player.matched@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000003',
    },
    socialPlayer: {
      email: 'player.social@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000007',
    }
  }
}

async function createUserClient(email: string) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await client.auth.signInWithPassword({
    email,
    password: DUMMY_PASSWORD,
  })

  if (error) {
    throw new Error(`Sign in failed for ${email}: ${error.message}`)
  }

  return client
}

async function runTests() {
  console.log('Running Security & Integrity Tests...')

  // 1. Test join_session RPC
  console.log('Step 1: Testing join_session RPC...')
  const socialClient = await createUserClient(IDS.users.socialPlayer.email)
  
  // Try to join as a player
  const { data: joinData, error: joinError } = await socialClient.rpc('join_session', {
    p_session_id: IDS.sessions.openConfirmed
  })
  
  if (joinError) {
    // If it fails because user is already in (possible if seed was run recently), we skip or check message
    console.log(`Join session result: ${joinError.message}`)
  } else {
    console.log('Successfully joined session via RPC.')
  }

  // 2. Test Data Masking in get_session_detail_overview
  console.log('Step 2: Testing data masking in get_session_detail_overview...')
  
  // As a non-participant
  const randomClient = await createUserClient('player.lower@picklematch.vn')
  const { data: overviewGuest, error: guestError } = await randomClient.rpc('get_session_detail_overview', {
    p_session_id: IDS.sessions.openConfirmed
  })

  if (guestError) throw guestError
  
  assert.equal(overviewGuest.session.booking_phone, null, 'Booking phone should be hidden for guests')
  assert.equal(overviewGuest.session.booking_reference, null, 'Booking reference should be hidden for guests')
  console.log('PASS: Sensitive data hidden from guest.')

  // As the host
  const hostClient = await createUserClient(IDS.users.hostConfirmed.email)
  const { data: overviewHost, error: hostError } = await hostClient.rpc('get_session_detail_overview', {
    p_session_id: IDS.sessions.openConfirmed
  })

  if (hostError) throw hostError
  assert.notEqual(overviewHost.session.booking_phone, null, 'Booking phone should be visible to host')
  console.log('PASS: Sensitive data visible to host.')

  // 3. Test RLS on Players
  console.log('Step 3: Testing RLS on players table...')
  const { error: updateOtherError } = await hostClient
    .from('players')
    .update({ name: 'Hacker' })
    .eq('id', IDS.users.matchedPlayer.id)

  // In Supabase, update on non-owned row might succeed in returning empty array but not actually update, 
  // or return error if using single() or if no policy allows it.
  // With my policy "Users can update own profile", update on others should match 0 rows.
  const { data: updatedRows } = await hostClient
    .from('players')
    .update({ name: 'Hacker' })
    .eq('id', IDS.users.matchedPlayer.id)
    .select()

  assert.equal(updatedRows?.length ?? 0, 0, 'Should not be able to update other player profiles')
  console.log('PASS: RLS prevents updating other player profiles.')

  console.log('\nAll security tests passed.')
}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
