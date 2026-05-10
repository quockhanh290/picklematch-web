import React from 'react'
import { View, ViewStyle, Platform } from 'react-native'
import { SPACING } from '@/constants/screenLayout'

interface WebContainerProps {
  children: React.ReactNode
  style?: ViewStyle
  maxWidth?: number
}

export function WebContainer({ children, style, maxWidth = 1200 }: WebContainerProps) {
  if (Platform.OS !== 'web') {
    return <View style={style}>{children}</View>
  }

  return (
    <View style={[{
      width: '100%',
      maxWidth: maxWidth,
      alignSelf: 'center',
      paddingHorizontal: SPACING.xl,
      backgroundColor: 'transparent',
    }, style]}>
      {children}
    </View>
  )
}
