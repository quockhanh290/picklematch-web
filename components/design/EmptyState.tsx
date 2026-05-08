import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

type Props = {
  icon: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: Props) {
  const theme = useAppTheme()
  return (
    <View className="mt-16 items-center px-8">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: theme.surfaceAlt }}>{icon}</View>
      <Text className="mb-1 text-center text-base font-semibold" style={{ color: theme.text, fontFamily: SCREEN_FONTS.cta }}>{title}</Text>
      {description ? <Text className="text-center text-sm leading-6" style={{ color: theme.textMuted, fontFamily: SCREEN_FONTS.body }}>{description}</Text> : null}
    </View>
  )
}
