import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { appRadii, getShadowStyle, getSurfaceStyle } from '@/lib/designSystem'
import { useAppTheme } from '@/lib/theme-context'

type Props = {
  title?: string
  subtitle?: string
  rightSlot?: ReactNode
  children: ReactNode
  className?: string
}

export function SectionCard({ title, subtitle, rightSlot, children, className = '' }: Props) {
  const theme = useAppTheme()

  return (
    <View className={`${appRadii.md} border p-4 ${className}`} style={{ ...getSurfaceStyle(theme), ...getShadowStyle(theme) }}>
      {title || subtitle || rightSlot ? (
        <View className="mb-4 flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            {title ? <Text className="text-lg font-extrabold" style={{ color: theme.text }}>{title}</Text> : null}
            {subtitle ? (
              <Text className="mt-1 text-sm leading-6" style={{ color: theme.textMuted }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {rightSlot}
        </View>
      ) : null}
      {children}
    </View>
  )
}
