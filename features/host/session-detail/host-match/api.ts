import { supabase } from '@/lib/supabase'

export type PlayerAvailabilityStatus = 'present' | 'no_show'

export async function updatePlayerAvailability(sessionId: string, playerId: string, status: PlayerAvailabilityStatus) {
  return supabase
    .from('session_players')
    .update({ check_in_status: status })
    .eq('session_id', sessionId)
    .eq('player_id', playerId)
}

export async function updateMatchScore(matchId: string, team: 'a' | 'b', score: number) {
  return supabase
    .from('session_matches')
    .update({ [team === 'a' ? 'score_a' : 'score_b']: score, updated_at: new Date().toISOString() })
    .eq('id', matchId)
}

export async function finishMatch(matchId: string) {
  return supabase
    .from('session_matches')
    .update({ status: 'finished', updated_at: new Date().toISOString() })
    .eq('id', matchId)
}

export async function cancelMatch(matchId: string) {
  return supabase
    .from('session_matches')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', matchId)
}

export type SessionMatchInsertRow = {
  session_id: string
  team_a_no: number
  team_b_no: number
  court_no?: number
  status: 'playing'
  players_snapshot: Record<string, unknown>
}

export async function insertMatch(row: SessionMatchInsertRow) {
  return supabase.from('session_matches').insert(row)
}

export async function insertMatches(rows: SessionMatchInsertRow[]) {
  return supabase.from('session_matches').insert(rows)
}

export async function deleteAllMatchesForSession(sessionId: string) {
  return supabase.from('session_matches').delete().eq('session_id', sessionId)
}
