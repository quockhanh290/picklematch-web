import { LinearGradient } from 'expo-linear-gradient'
import type { LucideIcon } from 'lucide-react-native'
import { Check, Lock } from 'lucide-react-native'
import { ScrollView, Text, View } from 'react-native'
import React from 'react'

import { getTrophyBadgePalette, type ProfileBadgeTone } from '@/constants/profileTheme'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'
import { withAlpha } from '@/lib/utils/ui'
import { STRINGS } from '@/constants/strings'

type BadgeTone = ProfileBadgeTone

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
      return STRINGS.profile.achievements.categories.progression
    case 'performance':
      return STRINGS.profile.achievements.categories.performance
    case 'momentum':
      return STRINGS.profile.achievements.categories.momentum
    case 'conduct':
      return STRINGS.profile.achievements.categories.conduct
    default:
      return ''
  }
}

type Props = {
  badges?: TrophyBadge[]
  hideHeader?: boolean
  flushBottom?: boolean
}


export function TrophyRoom({ badges = [], hideHeader = false, flushBottom = false }: Props) {
  const theme = useAppTheme()
  const earnedCount = badges.filter((badge) => badge.earned).length

  return (
    <View className={flushBottom ? '' : 'mb-6'}>
      {!hideHeader ? (
        <View className="mb-4">
          <Text className="text-[24px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta }}>{STRINGS.profile.achievements.title}</Text>
          <Text className="mt-1 text-[13px]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.body }}>
            {STRINGS.profile.achievements.unlocked_count
              .replace('{count}', earnedCount.toString())
              .replace('{total}', badges.length.toString())}
          </Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
        {badges.map((badge) => {
          const palette = getTrophyBadgePalette(badge.tone, theme)
          const Icon = badge.icon

          return (
            <View
              key={badge.key}
              className="mr-4 w-[160px] overflow-hidden rounded-[24px] p-5 flex flex-col justify-between"
              style={{ backgroundColor: badge.earned ? theme.primary : theme.surfaceContainerLow }}
            >
              {badge.earned ? (
                <LinearGradient
                  colors={[theme.primary, theme.surfaceTint]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
                />
              ) : null}

              <View className="flex-row justify-between items-start">
                <View
                  className="rounded-full px-3 py-2"
                  style={{ backgroundColor: badge.earned ? palette.card : theme.surfaceContainerHigh }}
                >
                  <Icon size={20} color={badge.earned ? palette.icon : theme.outline} strokeWidth={2.2} />
                </View>
                {badge.earned ? <Check size={16} color={theme.primaryFixed} /> : <Lock size={16} color={theme.outline} />}
              </View>

              <View className="mt-6">
                <Text
                  className="self-start rounded-full px-3 py-1 text-[10px] uppercase tracking-wider"
                  style={{
                    color: badge.earned ? palette.text : theme.outline,
                    backgroundColor: badge.earned ? palette.card : theme.surfaceContainerHigh,
                    fontFamily: SCREEN_FONTS.cta,
                  }}
                >
                  {categoryLabel(badge.category)}
                </Text>
                <Text
                  className="mt-3 text-[16px] leading-tight"
                  style={{
                    color: badge.earned ? theme.onPrimary : theme.onSurfaceVariant,
                    fontFamily: SCREEN_FONTS.cta,
                  }}
                >
                  {badge.title}
                </Text>
                <Text
                  className="mt-2 text-[12px] leading-5"
                  style={{
                    color: badge.earned ? theme.inverseOnSurface : theme.outline,
                    fontFamily: SCREEN_FONTS.body,
                  }}
                >
                  {badge.earned ? badge.requirement : STRINGS.profile.achievements.not_earned}
                </Text>
              </View>

              <Icon
                size={56}
                color={badge.earned ? withAlpha(theme.onPrimary, 0.14) : theme.outlineVariant}
                strokeWidth={1.8}
                style={{ position: 'absolute', right: 12, bottom: 12 }}
              />

            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

export default TrophyRoom

