import { supabase } from './supabase'

export async function insertNotification(
  playerId: string,
  title: string,
  body: string,
  type: string,
  deepLink?: string,
) {
  const { error } = await supabase.from('notifications').insert({
    player_id: playerId,
    title,
    body,
    type,
    deep_link: deepLink,
    is_read: false,
  })
  if (error) console.warn('insertNotification failed:', error.message)
}
