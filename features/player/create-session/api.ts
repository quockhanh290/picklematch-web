import { supabase } from '@/lib/supabase'

export async function createSessionApi(payload: any) {
  return await supabase.rpc('create_session_with_host', payload)
}

export async function updateSessionApi(sessionId: string, payload: any) {
  return await supabase.rpc('update_session_with_host', {
    p_session_id: sessionId,
    ...payload,
  })
}


export async function fetchSessionDetailForEditApi(sessionId: string) {
  return await supabase.rpc('get_session_detail_overview', { p_session_id: sessionId })
}
