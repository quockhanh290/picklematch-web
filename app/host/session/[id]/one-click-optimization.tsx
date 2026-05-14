import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AppLoading, SecondaryNavbar } from '@/components/design'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { useAuth } from '@/lib/useAuth'
import { useAppTheme } from '@/lib/theme-context'
import { buildArrangementPlayers } from '@/lib/sessionDetail'
import { OneClickOptimizationScreen } from '@/features/host/session-detail/OneClickOptimizationScreen'
import { View } from 'react-native'

export default function OneClickOptimizationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const router = useRouter()

  const {
    loading,
    session,
  } = useSessionDetail(id, userId)

  if (loading) {
    return <AppLoading fullScreen />
  }

  const rawOwnerDetails = session?.owner_sessions
  const ownerDetails = Array.isArray(rawOwnerDetails) ? (rawOwnerDetails[0] || {}) : (rawOwnerDetails || {})
  const processedPlayers = session ? buildArrangementPlayers({ ...session, owner_sessions: ownerDetails }) : []
  const courtCount = Math.max(1, (session?.sub_court_numbers || ownerDetails.sub_court_numbers || []).length || 1)

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar
        title={'T\u1ed0I \u01afU T\u1ef0 \u0110\u1ed8NG'}
        onBackPress={() => router.replace(`/host/session/${id}/matches?openScheduleSetup=1` as any)}
      />
      <OneClickOptimizationScreen
        players={processedPlayers}
        maxCourts={courtCount}
      />
    </View>
  )
}
