import React from 'react'
import { Text, View } from 'react-native'
import { LucideIcon } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { BORDER } from '@/constants/screenLayout'

export function MiniBadgeLight({
  icon: Icon,
  label,
  tone = 'neutral',
  size = 'md',
}: {
  icon: LucideIcon
  label: string
  tone?: 'neutral' | 'success' | 'urgent'
  size?: 'md' | 'lg'
}) {
  const theme = useAppTheme()
  const isLarge = size === 'lg'
  const palette =
    tone === 'success'
      ? { bg: theme.primaryContainer, border: theme.primaryFixedDim, text: theme.onPrimaryContainer, icon: theme.onPrimaryContainer }
      : tone === 'urgent'
        ? { bg: theme.secondaryContainer, border: theme.secondaryFixedDim, text: theme.onSecondaryContainer, icon: theme.onSecondaryContainer }
        : {
            bg: theme.surfaceContainerLow,
            border: theme.outlineVariant,
            text: theme.onSurfaceVariant,
            icon: theme.onSurfaceVariant,
          }

  return (
    <View
      className={`flex-row items-center rounded-full ${isLarge ? 'px-3.5 py-2' : 'px-3 py-1.5'}`}
      style={{ backgroundColor: palette.bg, borderWidth: BORDER.base, borderColor: palette.border }}
    >
      <Icon size={isLarge ? 15 : 14} color={palette.icon} strokeWidth={2.5} />
      <Text
        className="ml-1.5"
        style={{
          color: palette.text,
          fontFamily: SCREEN_FONTS.label,
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {label}
      </Text>
    </View>
  )
}
