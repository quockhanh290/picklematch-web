import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '@/lib/useAuth'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { AppLoading, SecondaryNavbar } from '@/components/design'
import { View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { TeamArrangementScreen } from '@/features/host/session-detail/TeamArrangementScreen'
import { buildArrangementPlayers } from '@/lib/sessionDetail'

export default function TeamArrangementRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const router = useRouter()

  const {
    loading,
    refreshing,
    session,
    fetchSession,
    error,
  } = useSessionDetail(id, userId)

  if (loading) {
    return <AppLoading fullScreen />
  }

  const ownerDetails = session?.owner_sessions?.[0] || session?.owner_sessions || {}
  const processedPlayers = session ? buildArrangementPlayers({ ...session, owner_sessions: ownerDetails }) : []

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar 
        title="SẮP XẾP ĐỘI" 
      />
      <TeamArrangementScreen
        sessionId={id!}
        players={processedPlayers}
        maxPlayers={session?.max_players || 16}
        onUpdated={fetchSession}
        onClose={() => router.back()}
      />
    </View>
  )
}
