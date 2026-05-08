import React from 'react'
import { Text, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'

interface SectionDividerProps {
  index: string
  title: string
}

export function SectionDivider({ index, title }: SectionDividerProps) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, textTransform: 'uppercase', letterSpacing: 1.5, color: theme.outline }}>
        {index} / {title}
      </Text>
      <View style={{ height: 1, flex: 1, backgroundColor: theme.outlineVariant }} />
    </View>
  )
}
