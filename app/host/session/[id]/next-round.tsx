import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { AppLoading } from '@/components/design'
import { NextRoundSuggesterScreen } from '@/features/host/session-detail/NextRoundSuggesterScreen'
import { NextRoundSuggesterScreenV2 } from '@/features/host/session-detail/NextRoundSuggesterScreenV2'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { buildArrangementPlayers } from '@/lib/sessionDetail'
import { useAuth } from '@/lib/useAuth'
import { useAppTheme } from '@/lib/theme-context'

export default function NextRoundRoute() {
  const { id, ui, bootstrap, report } = useLocalSearchParams<{ id: string; ui?: string; bootstrap?: string; report?: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const useFullBootstrap = bootstrap === 'full'
  const routeStartedAtRef = React.useRef(Date.now())
  const firstReadyMsRef = React.useRef<number | null>(null)
  const { loading, session, lastTiming } = useSessionDetail(id, userId, {
    includeMatches: useFullBootstrap,
    includeViewerExtras: useFullBootstrap,
    traceLabel: useFullBootstrap ? 'next-round-route-full' : 'next-round-route-light',
  })

  if (loading) return <AppLoading fullScreen />
  if (firstReadyMsRef.current === null) {
    firstReadyMsRef.current = Date.now() - routeStartedAtRef.current
    if (__DEV__) {
      console.log('[next-round-route] bootstrap timing', {
        route_bootstrap_ms: firstReadyMsRef.current,
        bootstrap_variant: useFullBootstrap ? 'full' : 'light',
        session_detail: lastTiming,
      })
    }
  }

  const ownerSessions = session?.owner_sessions
  const ownerDetails = Array.isArray(ownerSessions) ? ownerSessions[0] ?? {} : ownerSessions ?? {}
  const players = session ? buildArrangementPlayers({ ...session, owner_sessions: ownerDetails }) : []
  const subCourts = session?.sub_court_numbers || ownerDetails.sub_court_numbers || []
  const courts = Math.max(1, subCourts.length || ownerDetails.courts || ownerDetails.court_count || 1)
  const bootstrapTelemetry = {
    optimization_variant: useFullBootstrap ? 'next-round-full-session-detail' : 'next-round-light-session-detail',
    bootstrap_variant: useFullBootstrap ? 'full' : 'light',
    route_bootstrap_ms: firstReadyMsRef.current,
    session_detail: lastTiming,
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {ui === 'v1' ? (
        <NextRoundSuggesterScreen sessionId={id!} players={players} courts={courts} />
      ) : (
        <NextRoundSuggesterScreenV2 sessionId={id!} players={players} courts={courts} bootstrapTelemetry={bootstrapTelemetry} initialShowReport={report === '1'} />
      )}
    </View>
  )
}
