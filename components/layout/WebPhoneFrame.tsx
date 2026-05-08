import React from 'react'
import { Platform, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { BORDER, RADIUS, SHADOW } from '@/constants/screenLayout'

export default function WebPhoneFrame({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme()

  if (Platform.OS !== 'web') {
    return <>{children}</>
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaceContainerLowest,
        alignItems: 'center',
        padding: 16,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 430,
          height: '100%',
          backgroundColor: theme.background,
          borderRadius: RADIUS.xl,
          overflow: 'hidden',
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
          ...SHADOW.md,
        }}
      >
        {children}
      </View>
    </View>
  )
}

