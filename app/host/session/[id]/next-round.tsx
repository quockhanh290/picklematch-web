import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { AppLoading, SecondaryNavbar } from '@/components/design'
import { NextRoundSuggesterScreen } from '@/features/host/session-detail/NextRoundSuggesterScreen'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { buildArrangementPlayers } from '@/lib/sessionDetail'
import { useAuth } from '@/lib/useAuth'
import { useAppTheme } from '@/lib/theme-context'

export default function NextRoundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const { loading, session } = useSessionDetail(id, userId)

  if (loading) return <AppLoading fullScreen />

  const ownerDetails = session?.owner_sessions?.[0] || session?.owner_sessions || {}
  const players = session ? buildArrangementPlayers({ ...session, owner_sessions: ownerDetails }) : []
  const subCourts = session?.sub_court_numbers || ownerDetails.sub_court_numbers || []
  const courts = Math.max(1, subCourts.length || ownerDetails.courts || ownerDetails.court_count || 1)

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="NEXT ROUND" />
      <NextRoundSuggesterScreen sessionId={id!} players={players} courts={courts} />
    </View>
  )
}
