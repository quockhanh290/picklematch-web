import React from 'react'
import { Text, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'

import { STRINGS } from '@/constants/strings'

export type SessionTab = 'upcoming' | 'pending' | 'history'

export function MySessionsEmptyState({ activeTab }: { activeTab: SessionTab }) {
  const theme = useAppTheme()
  const config =
    activeTab === 'upcoming'
      ? STRINGS.session_empty.upcoming
      : activeTab === 'pending'
        ? STRINGS.session_empty.pending
        : STRINGS.session_empty.history

  return (
    <View
      style={{
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        ...SHADOW.xs,
        marginTop: 12
      }}
    >
      <View style={{ padding: 28, backgroundColor: '#FCFAF7' }}>
        <Text
          style={{
            color: theme.primary,
            fontFamily: SCREEN_FONTS.cta,
            fontSize: 10,
            letterSpacing: 2.2,
            textTransform: 'uppercase',
            marginBottom: 16
          }}
        >
          {config.eyebrow}
        </Text>
        <Text
          style={{
            color: theme.onSurface,
            fontFamily: SCREEN_FONTS.headline,
            fontSize: 26,
            lineHeight: 32,
            textTransform: 'uppercase',
            marginBottom: 10
          }}
        >
          {config.title}
        </Text>
        <Text
          style={{
            color: theme.onSurfaceVariant,
            fontFamily: SCREEN_FONTS.body,
            fontSize: 15,
            lineHeight: 24,
            maxWidth: '90%'
          }}
        >
          {config.description}
        </Text>
      </View>
    </View>
  )
}

