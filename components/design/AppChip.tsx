import type { ReactNode } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { appRadii, getTonePalette, type BadgeTone } from '@/lib/designSystem'
import { useAppTheme } from '@/lib/theme-context'

type Props = {
  label: string
  icon?: ReactNode
  tone?: BadgeTone
  active?: boolean
  onPress?: () => void
  className?: string
  labelClassName?: string
  activeClassName?: string
  inactiveClassName?: string
  iconClassName?: string
}

export function AppChip({
  label,
  icon,
  tone = 'neutral',
  active = false,
  onPress,
  className = '',
  labelClassName = '',
  activeClassName,
  inactiveClassName,
  iconClassName = '',
}: Props) {
  const theme = useAppTheme()
  const palette = getTonePalette(theme, tone)
  const stateClassName = active ? activeClassName ?? '' : inactiveClassName ?? ''
  const activeStyle = active
    ? {
        backgroundColor: palette.activeBackgroundColor,
        borderColor: palette.activeBackgroundColor,
      }
    : {
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
      }
  const textStyle = {
    color: active ? palette.activeTextColor : palette.textColor,
  }

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      disabled={!onPress}
      className={`${appRadii.sm} border px-4 py-2.5 ${stateClassName} ${className}`}
      style={activeStyle}
    >
      <View className="flex-row items-center">
        {icon ? <View className={`mr-1.5 ${iconClassName}`}>{icon}</View> : null}
        <Text className={`text-sm font-semibold ${labelClassName}`} style={textStyle}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  )
}
