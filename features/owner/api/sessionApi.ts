import { supabase } from '@/lib/supabase'

export async function createOwnerSessionApi(payload: any) {
  return await supabase.rpc('create_owner_session', payload)
}

export async function updateOwnerSessionApi(sessionId: string, payload: any) {
  return await supabase.rpc('update_owner_session', {
    p_session_id: sessionId,
    ...payload,
  })
}

export async function fetchOwnerSessionDetailForEditApi(sessionId: string) {
  return await supabase
    .from('sessions')
    .select(`
      *,
      owner_sessions(*),
      slot:court_slots(*, court:courts(*))
    `)
    .eq('id', sessionId)
    .single()
}
