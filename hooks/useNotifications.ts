import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNetworkState } from '@/lib/NetworkContext'

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


export function useNotifications(userId: string | null | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [error, setError] = useState<string | null>(null)
  const { isOnline, status } = useNetworkState()

  useEffect(() => {
    if (!userId) {
      setNotifications([])
      return
    }

    // Initial fetch
    void fetchNotifications()

    // Fallback polling for in-app browsers where realtime can be unstable.
    // Pause polling if offline.
    const pollTimer = setInterval(() => {
      if (isOnline) {
        void fetchNotifications()
      }
    }, 30000)

    // Realtime subscription
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `player_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `player_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? (payload.new as Notification) : n)),
          )
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('realtime_unavailable')
        }
      })

    return () => {
      clearInterval(pollTimer)
      supabase.removeChannel(channel)
    }
  }, [userId, isOnline])

  async function fetchNotifications() {
    if (!userId) return
    try {
      const { data, error: queryError } = await supabase
        .from('notifications')
        .select('*')
        .eq('player_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (queryError) {
        setError(queryError.message)
        return
      }
      setError(null)
      if (data) setNotifications(data as Notification[])
    } catch (e: any) {
      setError(e?.message ?? 'fetch_failed')
    }
  }

  async function markAsRead(notificationId: string) {
    const prev = notifications
    setNotifications((current) =>
      current.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
    )
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
    if (updateError) {
      setNotifications(prev)
      setError(updateError.message)
    }
  }

  async function markAllAsRead() {
    if (!userId) return
    const prev = notifications
    setNotifications((current) => current.map((n) => ({ ...n, is_read: true })))
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('player_id', userId)
      .eq('is_read', false)
    if (updateError) {
      setNotifications(prev)
      setError(updateError.message)
    }
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return { notifications, unreadCount, markAsRead, markAllAsRead, error }
}
