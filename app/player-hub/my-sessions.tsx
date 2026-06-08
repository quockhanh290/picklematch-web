import React from 'react'
import { MySessionsScreen } from '@/features/player/my-sessions/MySessionsScreen'
import { useAuth } from '@/lib/useAuth'
import { AppLoading } from '@/components/design'

export default function MySessionsRoute() {
  const { userId, isLoading } = useAuth()

  if (isLoading) {
    return <AppLoading fullScreen />
  }

  return <MySessionsScreen />
}
