import { Text, View } from 'react-native'

import { appRadii, getShadowStyle, getSurfaceStyle } from '@/lib/designSystem'
import { useAppTheme } from '@/lib/theme-context'

type Props = {
  value: string | number
  label: string
  valueClassName?: string
}

export function AppStatCard({ value, label, valueClassName = '' }: Props) {
  const theme = useAppTheme()

  return (
    <View className={`flex-1 ${appRadii.md} border px-4 py-5`} style={{ ...getSurfaceStyle(theme), ...getShadowStyle(theme) }}>
      <Text className={`text-2xl font-black ${valueClassName}`} style={{ color: theme.text }}>
        {value}
      </Text>
      <Text className="mt-1 text-xs font-semibold uppercase tracking-[1px]" style={{ color: theme.textSoft }}>
        {label}
      </Text>
    </View>
  )
}
