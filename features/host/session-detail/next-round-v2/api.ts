import { supabase } from '@/lib/supabase'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase function configuration')
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Host login expired')
  }

  const query = new URLSearchParams({ session_id: sessionId })
  Object.entries(extraQuery).forEach(([key, value]) => query.set(key, String(value)))

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Edge Function ${functionName} failed`)
  }

  return payload
}

export async function loadLatestSyncablePlayerIds(
  sessionId: string,
  localFallbackIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('session_players')
    .select('player_id, status, check_in_status')
    .eq('session_id', sessionId)

  if (error) {
    throw error
  }

  const confirmedRows = (data ?? []).filter(row => row.status === 'confirmed' || row.status == null)
  const presentIds = confirmedRows
    .filter(row => row.check_in_status === 'present' || row.check_in_status === 'checked_in')
    .map(row => String(row.player_id))
  const activeIds = confirmedRows
    .filter(row => row.check_in_status !== 'no_show')
    .map(row => String(row.player_id))

  const preferredIds = presentIds.length > 0 ? presentIds : activeIds
  return [...new Set([...preferredIds, ...localFallbackIds])]
}
