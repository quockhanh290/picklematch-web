import type { LucideIcon } from 'lucide-react-native'
import { Text, View } from 'react-native'

import { useAppTheme } from '@/lib/theme-context'
import { getCommunityFeedbackPalette } from '@/constants/profileTheme'
import { SCREEN_FONTS } from '@/constants/typography'

type FeedbackTone = 'positive' | 'negative'

export type FeedbackTrait = {
  key: string
  icon: LucideIcon
  label: string
  count: string
  context: string
  tone: FeedbackTone
}

function parseCount(value: string) {
  const numericValue = Number(value.replace(/[^\d]/g, ''))
  return Number.isFinite(numericValue) ? numericValue : 0
}

type Props = {
  eyebrow?: string
  title?: string
  traits?: FeedbackTrait[]
  flushBottom?: boolean
}

export function CommunityFeedbackSection({ title = 'Đánh giá từ cộng đồng', traits = [], flushBottom = false }: Props) {
  const theme = useAppTheme()
  if (traits.length === 0) return null

  return (
    <View className={flushBottom ? '' : 'mb-6'}>
      {title ? (
        <View className="mb-0">
          <Text className="text-[24px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{title}</Text>
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        {traits.map((trait) => {
          const count = parseCount(trait.count)
          const palette = getCommunityFeedbackPalette(trait.tone, count, theme)
          const Icon = trait.icon

          return (
            <View
              key={trait.key}
              className="flex-row items-center rounded-full px-4 py-2"
              style={{ backgroundColor: palette.backgroundColor }}
            >
              <Icon size={14} color={palette.iconColor} strokeWidth={2.2} />
              <Text className="ml-2 text-[15px]" style={{ color: palette.textColor, fontFamily: SCREEN_FONTS.cta }}>
                {trait.label} <Text style={{ opacity: 0.7 }}>({count})</Text>
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

export default CommunityFeedbackSection

