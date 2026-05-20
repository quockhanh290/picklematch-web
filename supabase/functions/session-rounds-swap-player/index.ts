/* eslint-disable import/no-unresolved */
import { getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost } from '../_shared/live-session.ts'
import { bumpLiveStateVersion } from '../_shared/live-state-version.ts'
import { insertSuggesterAuditEvent } from '../_shared/suggester-audit.ts'

type Team = [string, string]
type Match = { court_idx: number; team_a: Team; team_b: Team; [key: string]: unknown }

Deno.serve(async (request) => {
  try {
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request)
  }

  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400, request)
  }

  const auth = await requireHost(request, sessionId)
  if (auth.error) return auth.error

  const body = await readJson(request)
  const outPlayerId = typeof body.out_player_id === 'string' ? body.out_player_id : null
  const inPlayerId = typeof body.in_player_id === 'string' ? body.in_player_id : null

  if (!outPlayerId || !inPlayerId) {
    return jsonResponse({ ok: false, error: 'Missing out_player_id or in_player_id' }, 400, request)
  }
  if (outPlayerId === inPlayerId) {
    return jsonResponse({ ok: false, error: 'out_player_id and in_player_id must be different' }, 400, request)
  }

  // Find active round
  const { data: round, error: roundError } = await auth.supabase
    .from('session_rounds')
    .select('id, round_no, matches, resting')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle()

  if (roundError) {
    return jsonResponse({ ok: false, error: 'Could not load active round' }, 500, request)
  }
  if (!round) {
    return jsonResponse({ ok: false, error: 'No active round found' }, 409, request)
  }

  const matches: Match[] = Array.isArray(round.matches) ? round.matches : []
  const allActiveIds = new Set(matches.flatMap(m => [...m.team_a, ...m.team_b]))

  if (!allActiveIds.has(outPlayerId)) {
    return jsonResponse({ ok: false, error: 'out_player_id is not in any active match' }, 409, request)
  }
  if (allActiveIds.has(inPlayerId)) {
    return jsonResponse({ ok: false, error: 'in_player_id is already in an active match' }, 409, request)
  }

  // Check in_player is checked in (not checked out)
  const { data: inPlayerState, error: stateError } = await auth.supabase
    .from('session_player_state')
    .select('checked_out_at')
    .eq('session_id', sessionId)
    .eq('player_id', inPlayerId)
    .maybeSingle()

  if (stateError) {
    return jsonResponse({ ok: false, error: 'Could not verify player state' }, 500, request)
  }
  if (!inPlayerState) {
    return jsonResponse({ ok: false, error: 'in_player_id not found in session' }, 404, request)
  }
  if (inPlayerState.checked_out_at !== null) {
    return jsonResponse({ ok: false, error: 'in_player_id has already checked out' }, 409, request)
  }

  // Replace out_player_id with in_player_id in matches
  const updatedMatches = matches.map(match => {
    const newTeamA = match.team_a.map(id => id === outPlayerId ? inPlayerId : id) as Team
    const newTeamB = match.team_b.map(id => id === outPlayerId ? inPlayerId : id) as Team
    return { ...match, team_a: newTeamA, team_b: newTeamB }
  })

  const checkedOutAt = new Date().toISOString()

  const [roundResult, checkoutResult] = await Promise.all([
    auth.supabase
      .from('session_rounds')
      .update({ matches: updatedMatches })
      .eq('id', round.id)
      .select('*')
      .single(),
    auth.supabase
      .from('session_player_state')
      .update({ checked_out_at: checkedOutAt, opted_rest: false })
      .eq('session_id', sessionId)
      .eq('player_id', outPlayerId),
  ])

  if (roundResult.error) {
    console.error('swap round update failed', roundResult.error)
    return jsonResponse({ ok: false, error: 'Could not update round matches' }, 500, request)
  }
  if (checkoutResult.error) {
    console.error('swap checkout failed', checkoutResult.error)
    return jsonResponse({ ok: false, error: 'Could not check out swapped player' }, 500, request)
  }

  try {
    await bumpLiveStateVersion(auth.supabase, sessionId)
  } catch (versionError) {
    return jsonResponse({ ok: false, error: versionError instanceof Error ? versionError.message : 'Could not bump live_state_version' }, 500, request)
  }

  await insertSuggesterAuditEvent(auth.supabase, {
    session_id: sessionId,
    round_no: round.round_no,
    event_type: 'player_swapped_mid_round',
    event_source: 'host',
    actor_id: auth.userId,
    payload: { out_player_id: outPlayerId, in_player_id: inPlayerId, checked_out_at: checkedOutAt },
  })

  return jsonResponse({ ok: true, round: roundResult.data }, 200, request)
  } catch (err) {
    console.error('session-rounds-swap-player unhandled error', err)
    return jsonResponse({ ok: false, error: 'Could not swap player' }, 500, request)
  }
})
