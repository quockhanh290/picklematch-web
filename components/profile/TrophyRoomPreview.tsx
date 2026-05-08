import type { LucideIcon } from 'lucide-react-native'
import { Check, Lock } from 'lucide-react-native'
import { Text, View } from 'react-native'
import React from 'react'

import { getTrophyBadgePalette } from '@/constants/profileTheme'
import { useAppTheme } from '@/lib/theme-context'

type BadgeTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'

export type TrophyBadge = {
  key: string
  title: string
  category: 'progression' | 'performance' | 'momentum' | 'conduct'
  description: string
  requirement: string
  icon: LucideIcon
  tone: BadgeTone
  earned: boolean
  earnedAt?: string
}

function categoryLabel(category: TrophyBadge['category']) {
  switch (category) {
    case 'progression':
      return 'Tiến trình'
    case 'performance':
      return 'Thành tích'
    case 'momentum':
      return 'Phong độ'
    case 'conduct':
      return 'Uy tín'
  }
}

function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const normalized = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean
  const n = Number.parseInt(normalized, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

type Props = {
  badges?: TrophyBadge[]
}

export function TrophyRoom({ badges = [] }: Props) {
  const theme = useAppTheme()
  const earnedCount = badges.filter((badge) => badge.earned).length

  function tonePalette(tone: BadgeTone) {
    const badge = getTrophyBadgePalette(tone, theme)

    switch (tone) {
      case 'emerald':
        return {
          card: theme.primaryFixed,
          border: theme.secondaryFixedDim,
          text: theme.onPrimaryFixedVariant,
          subtext: withAlpha(theme.onPrimaryFixedVariant, 0.8),
          divider: withAlpha(theme.onPrimaryFixedVariant, 0.1),
          icon: badge.icon,
          watermark: withAlpha(theme.surfaceTint, 0.1),
        }
      case 'amber':
        return {
          card: theme.secondaryFixed,
          border: theme.secondaryFixedDim,
          text: theme.onSecondaryFixedVariant,
          subtext: withAlpha(theme.onSecondaryFixedVariant, 0.8),
          divider: withAlpha(theme.onSecondaryFixedVariant, 0.1),
          icon: badge.icon,
          watermark: withAlpha(theme.onPrimaryFixedVariant, 0.1),
        }
      case 'rose':
        return {
          card: theme.errorContainer,
          border: theme.outlineVariant,
          text: theme.onErrorContainer,
          subtext: withAlpha(theme.onErrorContainer, 0.8),
          divider: withAlpha(theme.onErrorContainer, 0.1),
          icon: badge.icon,
          watermark: withAlpha(theme.error, 0.1),
        }
      case 'sky':
        return {
          card: theme.tertiaryFixed,
          border: theme.secondaryFixedDim,
          text: theme.onTertiaryFixedVariant,
          subtext: withAlpha(theme.onTertiaryFixedVariant, 0.8),
          divider: withAlpha(theme.onTertiaryFixedVariant, 0.1),
          icon: badge.icon,
          watermark: withAlpha(theme.onTertiaryFixedVariant, 0.1),
        }
      case 'violet':
        return {
          card: theme.secondaryContainer,
          border: theme.outlineVariant,
          text: theme.onSecondaryContainer,
          subtext: withAlpha(theme.onSecondaryContainer, 0.8),
          divider: withAlpha(theme.onSecondaryContainer, 0.1),
          icon: badge.icon,
          watermark: withAlpha(theme.onSecondaryContainer, 0.1),
        }
    }
  }

  return (
    <View className="gap-4">
      <View className="px-1">
        <Text className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: theme.outline }}>
          Badges
        </Text>
        <Text className="mt-2 text-2xl font-black" style={{ color: theme.onBackground }}>
          Trophy Room
        </Text>
        <Text className="mt-2 text-sm leading-6" style={{ color: theme.onSurfaceVariant }}>
          {earnedCount}/{badges.length} danh hiệu đã mở khóa dựa trên phong độ, độ uy tín và chất lượng host.
        </Text>
      </View>

      <View className="flex-row flex-wrap justify-between gap-y-3">
        {badges.map((badge) => {
          const palette = tonePalette(badge.tone)
          const Icon = badge.icon
          const isEarned = badge.earned

          return (
            <View
              key={badge.key}
              className="relative w-[48%] overflow-hidden rounded-[20px] border p-4 flex flex-col"
              style={{
                borderColor: isEarned ? palette.border : theme.outlineVariant,
                backgroundColor: isEarned ? palette.card : theme.surfaceContainer,
                opacity: isEarned ? 1 : 0.75,
              }}
            >
              <Icon
                size={80}
                color={isEarned ? palette.watermark : withAlpha(theme.outline, 0.18)}
                strokeWidth={1.8}
                style={{ position: 'absolute', right: -16, bottom: -16 }}
              />

              <View className="relative z-10 flex-row items-start justify-between">
                <Icon size={24} color={isEarned ? palette.icon : theme.outline} strokeWidth={2.1} />
                {isEarned ? <Check size={16} color={palette.icon} /> : <Lock size={16} color={theme.outline} />}
              </View>

              <Text
                className="relative z-10 mt-4 text-[9px] font-extrabold uppercase tracking-widest opacity-60"
                style={{ color: isEarned ? palette.text : theme.onSurfaceVariant }}
              >
                {categoryLabel(badge.category)}
              </Text>
              <Text
                className="relative z-10 mt-2 text-sm font-extrabold"
                style={{ color: isEarned ? palette.text : theme.onSurfaceVariant }}
              >
                {badge.title}
              </Text>
              <Text
                className="relative z-10 mt-2 text-[11px] leading-5 opacity-80"
                style={{ color: isEarned ? palette.subtext : theme.onSurfaceVariant }}
              >
                {badge.description}
              </Text>

              <View
                className="relative z-10 mt-4 border-t pt-3"
                style={{ borderColor: isEarned ? palette.divider : withAlpha(theme.onSurfaceVariant, 0.1) }}
              >
                <Text
                  className="relative z-10 text-[11px] font-bold opacity-80"
                  style={{ color: isEarned ? palette.text : theme.onSurfaceVariant }}
                >
                  {isEarned ? `Mở khóa: ${badge.earnedAt}` : `Yêu cầu: ${badge.requirement}`}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}

export default TrophyRoom

