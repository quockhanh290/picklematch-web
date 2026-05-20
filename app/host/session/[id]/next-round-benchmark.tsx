import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'

import { AppLoading, SecondaryNavbar } from '@/components/design'
import { NextRoundBenchmarkScreen } from '@/features/host/session-detail/next-round-benchmark/NextRoundBenchmarkScreen'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { useAppTheme } from '@/lib/theme-context'
import { useAuth } from '@/lib/useAuth'

export default function NextRoundBenchmarkRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const router = useRouter()
  const theme = useAppTheme()
  const { loading } = useSessionDetail(id, userId)

  if (loading) return <AppLoading fullScreen />

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar
        title="NEXT ROUND BENCH"
        onBackPress={() => router.back()}
      />
      <NextRoundBenchmarkScreen sessionId={id!} />
    </View>
  )
}
