import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '@/lib/useAuth'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { AppLoading, SecondaryNavbar } from '@/components/design'
import { View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { OwnerCheckInScreen } from '@/features/owner/session-detail/OwnerCheckInScreen'

export default function OwnerCheckInRoute() {
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar 
        title="ĐIỂM DANH NGƯỜI CHƠI" 
        onBackPress={() => router.back()} 
      />
      <OwnerCheckInScreen
        sessionId={id!}
        players={session?.session_players || []}
        onUpdated={fetchSession}
        onClose={() => router.back()}
      />
    </View>
  )
}
