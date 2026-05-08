import React, { createContext, useContext } from 'react'
import { useNotifications, type Notification } from '@/hooks/useNotifications'

type NotificationsContextValue = {
  notifications: Notification[]
  unreadCount: number
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  error: string | null
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  error: null,
})

export function NotificationsProvider({
  userId,
  children,
}: {
  userId: string | null | undefined
  children: React.ReactNode
}) {
  const value = useNotifications(userId)
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotificationsContext() {
  return useContext(NotificationsContext)
}
