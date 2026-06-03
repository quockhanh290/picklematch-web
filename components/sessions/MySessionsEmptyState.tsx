import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'

export type SessionTab = 'upcoming' | 'pending' | 'history'

export function MySessionsEmptyState({ activeTab }: { activeTab: SessionTab }) {
  const theme = useAppTheme()
  const { t } = useTranslation()

  return (
    <View
      style={{
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        ...SHADOW.xs,
        marginTop: 12
      }}
    >
      <View style={{ padding: 28, backgroundColor: theme.surfaceContainerLowest }}>
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
          {t(`session_empty.${activeTab}.eyebrow`)}
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
          {t(`session_empty.${activeTab}.title`)}
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
          {t(`session_empty.${activeTab}.description`)}
        </Text>
      </View>
    </View>
  )
}

