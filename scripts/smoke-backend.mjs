import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const DUMMY_PASSWORD = process.env.DUMMY_PASSWORD || 'Pickle123!'

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... npm run smoke:backend')
  process.exit(1)
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const IDS = {
  sessions: {
    openConfirmed: '55555555-5555-5555-5555-555555555551',
    doneRecent: '55555555-5555-5555-5555-555555555554',
    resultsPending: '55555555-5555-5555-5555-555555555558',
    autoClosed: '55555555-5555-5555-5555-555555555561',
    pendingCompletion: '55555555-5555-5555-5555-555555555560',
  },
  users: {
    hostConfirmed: {
      email: 'host.confirmed@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000001',
    },
    hostApproval: {
      email: 'host.approval@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000002',
    },
    matchedPlayer: {
      email: 'player.matched@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000003',
    },
    lowerPlayer: {
      email: 'player.lower@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000004',
    },
    socialPlayer: {
      email: 'player.social@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000007',
    },
    provisionalHost: {
      email: 'host.provisional@picklematch.vn',
      id: '90000000-0000-0000-0000-000000000006',
    },
  },
}

function logStep(message) {
  console.log(`\n== ${message}`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function runSeed() {
  logStep('Resetting dummy data to a known baseline')
  const result = spawnSync(process.execPath, ['scripts/seed-dummy-data.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      DUMMY_PASSWORD,
    },
  })

  if (result.status !== 0) {
    throw new Error(`Dummy seed failed with exit code ${result.status ?? 'unknown'}`)
  }
}

async function createUserClient(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

async function expectRpcError(client, fn, args, expectedSubstring) {
  const { error } = await client.rpc(fn, args)
  assert(error, `Expected ${fn} to fail, but it succeeded`)
  assert(
    error.message.toLowerCase().includes(expectedSubstring.toLowerCase()),
    `Expected ${fn} error to include "${expectedSubstring}", got "${error.message}"`,
  )
}

async function testSaveSessionTeams() {
  logStep('Testing host-only team arrangement')

  const hostClient = await createUserClient(IDS.users.hostConfirmed.email)
  const playerClient = await createUserClient(IDS.users.matchedPlayer.email)
  const assignments = [
    { player_id: IDS.users.hostConfirmed.id, team_no: 1 },
    { player_id: IDS.users.matchedPlayer.id, team_no: 2 },
  ]

  await expectRpcError(playerClient, 'save_session_teams', {
    p_session_id: IDS.sessions.openConfirmed,
    p_assignments: assignments,
  }, 'Not allowed')

  const { error: saveError } = await hostClient.rpc('save_session_teams', {
    p_session_id: IDS.sessions.openConfirmed,
    p_assignments: assignments,
  })

  if (saveError) {
    throw new Error(`Host save_session_teams failed: ${saveError.message}`)
  }

  const { data, error } = await service
    .from('session_players')
    .select('player_id, team_no')
    .eq('session_id', IDS.sessions.openConfirmed)
    .in('player_id', [IDS.users.hostConfirmed.id, IDS.users.matchedPlayer.id])

  if (error) {
    throw new Error(`Failed to verify team assignment: ${error.message}`)
  }

  const teamMap = new Map((data ?? []).map((row) => [row.player_id, row.team_no]))
  assert(teamMap.get(IDS.users.hostConfirmed.id) === 1, 'Host should be assigned to team 1')
  assert(teamMap.get(IDS.users.matchedPlayer.id) === 2, 'Matched player should be assigned to team 2')
}

async function testResultConfirmationAndRating() {
  logStep('Testing result confirmation and secure rating submission')

  const matchedClient = await createUserClient(IDS.users.matchedPlayer.email)

  await expectRpcError(
    matchedClient,
    'submit_rating',
    {
      p_session_id: IDS.sessions.resultsPending,
      p_rated_id: IDS.users.hostApproval.id,
      p_tags: ['friendly'],
      p_no_show: false,
      p_skill_validation: 'matched',
    },
    'finalized',
  )

  const { data: confirmationResult, error: confirmError } = await matchedClient.rpc('respond_to_session_result', {
    p_session_id: IDS.sessions.resultsPending,
    p_response: 'confirmed',
    p_note: null,
  })

  if (confirmError) {
    throw new Error(`respond_to_session_result failed: ${confirmError.message}`)
  }

  assert(confirmationResult === 'finalized', `Expected resultsPending confirmation to finalize, got "${confirmationResult}"`)

  const { data: sessionRow, error: sessionError } = await service
    .from('sessions')
    .select('results_status')
    .eq('id', IDS.sessions.resultsPending)
    .single()

  if (sessionError) {
    throw new Error(`Failed to verify finalized session: ${sessionError.message}`)
  }

  assert(sessionRow?.results_status === 'finalized', 'resultsPending session should be finalized after final confirmation')

  const { error: rateError } = await matchedClient.rpc('submit_rating', {
    p_session_id: IDS.sessions.resultsPending,
    p_rated_id: IDS.users.hostApproval.id,
    p_tags: ['friendly', 'fair_play'],
    p_no_show: false,
    p_skill_validation: 'matched',
  })

  if (rateError) {
    throw new Error(`submit_rating failed after finalization: ${rateError.message}`)
  }

  const { data: ratings, error: ratingsError } = await service
    .from('ratings')
    .select('id, rater_id, rated_id, session_id')
    .eq('session_id', IDS.sessions.resultsPending)
    .eq('rater_id', IDS.users.matchedPlayer.id)
    .eq('rated_id', IDS.users.hostApproval.id)

  if (ratingsError) {
    throw new Error(`Failed to verify rating row: ${ratingsError.message}`)
  }

  assert((ratings ?? []).length === 1, 'Expected exactly one rating row after submit_rating')

  await expectRpcError(
    matchedClient,
    'submit_rating',
    {
      p_session_id: IDS.sessions.resultsPending,
      p_rated_id: IDS.users.hostApproval.id,
      p_tags: ['friendly'],
      p_no_show: false,
      p_skill_validation: 'matched',
    },
    'already rated',
  )
}

async function testMatchEloProcessing() {
  logStep('Testing match-result Elo processing and draw skip reasons')

  const processedSessionId = IDS.sessions.doneRecent
  const drawSessionId = IDS.sessions.autoClosed
  const hostClient = await createUserClient(IDS.users.hostApproval.email)
  const matchedClient = await createUserClient(IDS.users.matchedPlayer.email)
  const lowerClient = await createUserClient(IDS.users.lowerPlayer.email)
  const provisionalClient = await createUserClient(IDS.users.provisionalHost.email)

  const { error: resetHistoryError } = await service
    .from('elo_history')
    .delete()
    .eq('session_id', processedSessionId)

  if (resetHistoryError) {
    throw new Error(`Failed to clear elo_history for processed test: ${resetHistoryError.message}`)
  }

  const { error: resetSessionError } = await service
    .from('sessions')
    .update({
      status: 'pending_completion',
      results_status: 'not_submitted',
      results_submitted_at: null,
      results_confirmation_deadline: null,
      elo_processed: false,
      elo_skip_reason: null,
      is_ranked: true,
    })
    .eq('id', processedSessionId)

  if (resetSessionError) {
    throw new Error(`Failed to reset processed session state: ${resetSessionError.message}`)
  }

  const processedAssignments = [
    { player_id: IDS.users.hostApproval.id, team_no: 1, match_result: 'win' },
    { player_id: IDS.users.matchedPlayer.id, team_no: 1, match_result: 'win' },
    { player_id: IDS.users.lowerPlayer.id, team_no: 2, match_result: 'loss' },
    { player_id: IDS.users.provisionalHost.id, team_no: 2, match_result: 'loss' },
  ]

  for (const assignment of processedAssignments) {
    const { error } = await service
      .from('session_players')
      .update({
        status: 'confirmed',
        team_no: assignment.team_no,
        match_result: 'pending',
        proposed_result: 'pending',
        result_confirmation_status: 'not_submitted',
        result_confirmed_at: null,
        result_disputed_at: null,
        result_dispute_note: null,
        elo_snapshot: null,
      })
      .eq('session_id', processedSessionId)
      .eq('player_id', assignment.player_id)

    if (error) {
      throw new Error(`Failed to prepare processed Elo session: ${error.message}`)
    }
  }

  const { error: submitError } = await hostClient.rpc('submit_session_results', {
    p_session_id: processedSessionId,
    p_results: processedAssignments.map((assignment) => ({
      player_id: assignment.player_id,
      result: assignment.match_result,
    })),
  })

  if (submitError) {
    throw new Error(`submit_session_results failed for processed session: ${submitError.message}`)
  }

  const confirmations = [
    { client: matchedClient, label: 'matched player' },
    { client: lowerClient, label: 'lower-skill player' },
    { client: provisionalClient, label: 'provisional host player' },
  ]

  let finalConfirmationResult = null
  for (const confirmation of confirmations) {
    const { data, error } = await confirmation.client.rpc('respond_to_session_result', {
      p_session_id: processedSessionId,
      p_response: 'confirmed',
      p_note: null,
    })

    if (error) {
      throw new Error(`respond_to_session_result failed for ${confirmation.label}: ${error.message}`)
    }

    finalConfirmationResult = data
  }

  assert(
    finalConfirmationResult === 'finalized',
    `Expected processed session final confirmation to return "finalized", got "${finalConfirmationResult}"`,
  )

  const { data: processedSession, error: processedSessionError } = await service
    .from('sessions')
    .select('results_status, elo_processed, elo_skip_reason')
    .eq('id', processedSessionId)
    .single()

  if (processedSessionError) {
    throw new Error(`Failed to verify processed session state: ${processedSessionError.message}`)
  }

  assert(processedSession?.results_status === 'finalized', 'Processed session should finalize after all confirmations')
  assert(processedSession?.elo_processed === true, 'Processed session should be marked elo_processed=true')
  assert(processedSession?.elo_skip_reason === null, 'Processed session should clear elo_skip_reason')

  const { data: eloRows, error: eloRowsError } = await service
    .from('elo_history')
    .select('player_id, session_id, delta, source')
    .eq('session_id', processedSessionId)

  if (eloRowsError) {
    throw new Error(`Failed to verify elo_history rows: ${eloRowsError.message}`)
  }

  assert((eloRows ?? []).length === 4, `Expected 4 elo_history rows, got ${(eloRows ?? []).length}`)
  assert((eloRows ?? []).every((row) => row.source === 'match_result'), 'All elo_history rows should use source=match_result')

  const { error: resetDrawSessionError } = await service
    .from('sessions')
    .update({ elo_processed: false, elo_skip_reason: null, results_status: 'finalized', is_ranked: true })
    .eq('id', drawSessionId)

  if (resetDrawSessionError) {
    throw new Error(`Failed to reset draw session state: ${resetDrawSessionError.message}`)
  }

  const { data: drawStatus, error: drawError } = await service.rpc('process_match_elo', {
    p_session_id: drawSessionId,
  })

  if (drawError) {
    throw new Error(`process_match_elo failed for draw session: ${drawError.message}`)
  }

  assert(drawStatus === 'skipped_draw_result', `Expected draw skip status, got "${drawStatus}"`)

  const { data: drawSession, error: drawSessionError } = await service
    .from('sessions')
    .select('elo_processed, elo_skip_reason')
    .eq('id', drawSessionId)
    .single()

  if (drawSessionError) {
    throw new Error(`Failed to verify draw session state: ${drawSessionError.message}`)
  }

  assert(drawSession?.elo_processed === false, 'Draw session should remain elo_processed=false')
  assert(
    drawSession?.elo_skip_reason === 'skipped_draw_result',
    `Expected draw session skip reason to be "skipped_draw_result", got "${drawSession?.elo_skip_reason}"`,
  )
}

async function testHostUnprofessionalReport() {
  logStep('Testing host-unprofessional reporting when host did not submit results')

  const matchedClient = await createUserClient(IDS.users.matchedPlayer.email)
  const lowerClient = await createUserClient(IDS.users.lowerPlayer.email)

  const { data: firstReport, error: firstError } = await matchedClient.rpc('report_host_unprofessional', {
    p_session_id: IDS.sessions.pendingCompletion,
    p_note: 'Host chưa gửi kết quả đúng hạn.',
  })

  if (firstError) {
    throw new Error(`First host-unprofessional report failed: ${firstError.message}`)
  }

  assert(firstReport === 'reported', `Expected first host report to return "reported", got "${firstReport}"`)

  const { data: secondReport, error: secondError } = await lowerClient.rpc('report_host_unprofessional', {
    p_session_id: IDS.sessions.pendingCompletion,
    p_note: 'Host không chốt kết quả, người chơi phải tự theo dõi.',
  })

  if (secondError) {
    throw new Error(`Second host-unprofessional report failed: ${secondError.message}`)
  }

  assert(
    secondReport === 'reported',
    `Expected second host report to return "reported", got "${secondReport}"`,
  )

  const { data: hostRow, error: hostError } = await service
    .from('players')
    .select('host_reputation')
    .eq('id', IDS.users.hostApproval.id)
    .single()

  if (hostError) {
    throw new Error(`Failed to verify host reputation after report: ${hostError.message}`)
  }

  assert(hostRow?.host_reputation === 13, `Expected host reputation to decrease to 13, got "${hostRow?.host_reputation}"`)

  const { data: playerRow, error: playerError } = await service
    .from('session_players')
    .select('host_unprofessional_reported_at, host_unprofessional_report_note')
    .eq('session_id', IDS.sessions.pendingCompletion)
    .eq('player_id', IDS.users.matchedPlayer.id)
    .single()

  if (playerError) {
    throw new Error(`Failed to verify player host report marker: ${playerError.message}`)
  }

  assert(Boolean(playerRow?.host_unprofessional_reported_at), 'Expected host_unprofessional_reported_at to be set')

  const { data: repeatReport, error: repeatError } = await matchedClient.rpc('report_host_unprofessional', {
    p_session_id: IDS.sessions.pendingCompletion,
    p_note: 'Báo lại lần nữa.',
  })

  if (repeatError) {
    throw new Error(`Repeat host-unprofessional report failed unexpectedly: ${repeatError.message}`)
  }

  assert(repeatReport === 'already_reported', `Expected repeat host report to return "already_reported", got "${repeatReport}"`)
}

async function testPendingRatingsProcessor() {
  logStep('Testing pending ratings processor executes without crashing')
  const { data, error } = await service.rpc('process_pending_ratings')

  if (error) {
    throw new Error(`process_pending_ratings failed: ${error.message}`)
  }

  assert(typeof data === 'number', `Expected process_pending_ratings to return a number, got "${typeof data}"`)
  console.log(`process_pending_ratings returned ${data}`)
}

async function main() {
  runSeed()
  await testSaveSessionTeams()
  await testResultConfirmationAndRating()
  await testMatchEloProcessing()
  await testHostUnprofessionalReport()
  await testPendingRatingsProcessor()
  console.log('\nBackend smoke test passed.\n')
}

main().catch((error) => {
  console.error('\nBackend smoke test failed:')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
