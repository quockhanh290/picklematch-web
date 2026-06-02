import React from 'react'
import { Text, TextInput, type TextInputProps, View, Platform } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS } from '@/constants/screenLayout'

type Props = TextInputProps & {
  label?: string
  hint?: string
  leftIcon?: React.ReactNode
}

export function AppInput({ label, hint, leftIcon, ...props }: Props) {
  const theme = useAppTheme()
  return (
    <View style={{ gap: 8 }}>
      {label && (
        <Text 
          style={{ 
            color: theme.onSurfaceVariant, 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 12,
            letterSpacing: 1,
            textTransform: 'uppercase',
            paddingLeft: 4
          }}
        >
          {label}
        </Text>
      )}
      <View 
        style={{ 
          flexDirection: 'row', 
          alignItems: 'center', 
          borderWidth: 1, 
          borderColor: theme.outlineVariant,
          borderRadius: RADIUS.lg, 
          height: 56, 
          paddingHorizontal: 16,
          backgroundColor: theme.surfaceContainerLowest,
        }}
      >
        {leftIcon ? <View style={{ marginRight: 12, justifyContent: 'center' }}>{leftIcon}</View> : null}
        <TextInput
          placeholderTextColor={theme.outline}
          style={{ 
            flex: 1, 
            fontSize: Platform.OS === 'web' ? 16 : 15,
            color: theme.onSurface, 
            fontFamily: SCREEN_FONTS.body,
            outlineStyle: 'none' // For web
          } as any}
          {...props}
        />
      </View>
      {hint ? (
        <Text 
          style={{ 
            color: theme.outline, 
            fontFamily: SCREEN_FONTS.body, 
            fontSize: 12, 
            lineHeight: 18,
            paddingLeft: 4,
            marginTop: -4
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  )
}
