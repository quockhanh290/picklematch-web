import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { AppLoading } from '@/components/design'
import { RosterScreen } from '@/features/host/session-detail/RosterScreen'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { buildArrangementPlayers } from '@/lib/sessionDetail'
import { useAuth } from '@/lib/useAuth'
import { useAppTheme } from '@/lib/theme-context'

export default function RosterRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const { loading, session } = useSessionDetail(id, userId)

  if (loading) return <AppLoading fullScreen />

  const ownerDetails = session?.owner_sessions?.[0] || session?.owner_sessions || {}
  const players = session ? buildArrangementPlayers({ ...session, owner_sessions: ownerDetails }) : []

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <RosterScreen sessionId={id!} players={players} />
    </View>
  )
}
