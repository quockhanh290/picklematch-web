export type Notification = {
  id: string
  player_id: string
  type: string
  title: string
  body: string
  deep_link: string | null
  is_read: boolean
  created_at: string
}

export type NotificationCategory = 'all' | 'my_sessions' | 'achievements'
