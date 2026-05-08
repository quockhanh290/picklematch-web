import React from 'react'
import { View, Text, ViewStyle } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING } from '@/constants/screenLayout'

interface BrandedFooterProps {
  style?: ViewStyle
}

export function BrandedFooter({ style }: BrandedFooterProps) {
  const theme = useAppTheme()

  return (
    <View style={[{ 
      alignItems: 'center', 
      justifyContent: 'center', 
      paddingVertical: 32,
      paddingHorizontal: SPACING.xl,
      opacity: 0.8
    }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 14, height: 2, backgroundColor: theme.primary, marginRight: 8 }} />
        <Text
          style={{
            color: theme.primary,
            fontFamily: SCREEN_FONTS.headlineBlack,
            fontSize: 12,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.medium, fontSize: 8, textTransform: 'none' }}>powered by </Text>
          PICKLEMATCH
        </Text>
      </View>
    </View>
  )
}
