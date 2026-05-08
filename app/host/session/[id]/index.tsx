import React from 'react'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/lib/useAuth'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { AppLoading } from '@/components/design'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { HostSessionDetailScreen } from '@/features/host/session-detail/HostSessionDetailScreen'

export default function HostSessionDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const _insets = useSafeAreaInsets()

  const {
    loading,
    refreshing,
    session,
    viewerPlayer,
    matches,
    fetchSession,
    error,
  } = useSessionDetail(id, userId)

  useFocusEffect(
    React.useCallback(() => {
      if (id) fetchSession()
    }, [id])
  )

  if (loading) {
    return <AppLoading fullScreen />
  }

  if (error || !session) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center', fontSize: 15, fontFamily: SCREEN_FONTS.label, color: theme.onSurfaceVariant }}>
          {error || 'Không tìm thấy kèo Host.'}
        </Text>
      </View>
    )
  }

  const isHost = userId !== null && userId !== undefined && userId === session?.host.id

  return (
    <HostSessionDetailScreen
      id={id!}
      session={session}
      viewerPlayer={viewerPlayer}
      matches={matches}
      refreshing={refreshing}
      onRefresh={fetchSession}
      isHost={isHost}
    />
  )
}
