import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'

import { NextRoundSuggesterScreenV2 } from '@/features/host/session-detail/NextRoundSuggesterScreenV2'
import { prewarmSuggestFunction } from '@/features/host/session-detail/next-round-v2/api'
import { resetNextRoundTelemetry } from '@/features/host/session-detail/next-round-v2/telemetry'
import { useAppTheme } from '@/lib/theme-context'

export default function NextRoundRoute() {
  const { id, bootstrap, report } = useLocalSearchParams<{ id: string; bootstrap?: string; report?: string }>()
  const theme = useAppTheme()
  const useFullBootstrap = bootstrap === 'full'
  const routeStartedAtRef = React.useRef(Date.now())
  const firstReadyMsRef = React.useRef<number | null>(null)

  if (firstReadyMsRef.current === null) {
    // Warm the suggest edge function's isolate/auth/DB before the screen's first real suggest.
    // Deduped in the api, so it is a no-op if a nav handler already fired it with more lead time.
    prewarmSuggestFunction(id!)
    resetNextRoundTelemetry(id!, {
      bootstrap_variant: useFullBootstrap ? 'full' : 'light',
      optimization_variant: 'next-round-v2-shell',
    })
    firstReadyMsRef.current = Date.now() - routeStartedAtRef.current
    if (__DEV__) {
      console.log('[next-round-route] bootstrap timing', {
        route_bootstrap_ms: firstReadyMsRef.current,
        bootstrap_variant: useFullBootstrap ? 'full' : 'light',
      })
    }
  }

  const bootstrapTelemetry = {
    optimization_variant: 'next-round-v2-shell',
    bootstrap_variant: useFullBootstrap ? 'full' : 'light',
    route_bootstrap_ms: firstReadyMsRef.current,
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <NextRoundSuggesterScreenV2 sessionId={id!} bootstrapTelemetry={bootstrapTelemetry} initialShowReport={report === '1'} />
    </View>
  )
}
