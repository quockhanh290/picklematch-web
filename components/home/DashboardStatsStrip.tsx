import type { LucideIcon } from 'lucide-react-native'
import { ShieldCheck, TrendingUp, Zap } from 'lucide-react-native'
import { Text, View } from 'react-native'

import { SCREEN_FONTS } from '@/constants/typography'
import { getShadowStyle } from '@/lib/designSystem'
import { useAppTheme } from '@/lib/theme-context'

export type DashboardStatItem = {
  id: string
  label: string
  value: string
  icon: LucideIcon
}

const iconStroke = 2.7

export function buildDashboardStats(
  profile: { current_elo?: number | null; elo?: number | null; reliability_score?: number | null } | null,
  playerStats: { current_win_streak?: number | null } | null,
): DashboardStatItem[] {
  const eloValue = profile?.current_elo ?? profile?.elo ?? 0
  const reliabilityValue = profile?.reliability_score ?? 100

  return [
    { id: 'elo', label: 'ELO', value: eloValue ? eloValue.toLocaleString('vi-VN') : '--', icon: TrendingUp },
    { id: 'streak', label: 'Streak', value: String(playerStats?.current_win_streak ?? 0).padStart(2, '0'), icon: Zap },
    { id: 'reputation', label: 'Uy tín', value: `${reliabilityValue}%`, icon: ShieldCheck },
  ]
}

export function DashboardStatsStrip({ items }: { items: DashboardStatItem[] }) {
  const theme = useAppTheme()

  return (
    <View
      className="mt-6 flex-row rounded-[24px] border px-4 py-6"
      style={{
        backgroundColor: theme.surfaceContainerLowest,
        borderColor: theme.outlineVariant,
        ...getShadowStyle(theme),
      }}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        const valueColor =
          item.id === 'elo'
            ? theme.primary
            : item.id === 'streak'
              ? theme.onPrimaryFixedVariant
              : theme.surfaceTint
        const iconColor =
          item.id === 'elo'
            ? theme.primary
            : item.id === 'streak'
              ? theme.onPrimaryFixedVariant
              : theme.surfaceTint

        return (
          <View key={item.id} className="flex-1 flex-row items-stretch">
            <View className="flex-1 px-3">
              <View className="flex-row items-center justify-center">
                <Icon size={15} color={iconColor} strokeWidth={iconStroke} />
                <Text className="ml-2 text-[11px] uppercase tracking-[1px]" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta }}>
                  {item.label}
                </Text>
              </View>
              <Text className="mt-4 text-center text-[28px]" style={{ color: valueColor, fontFamily: SCREEN_FONTS.headline, lineHeight: 36 }}>
                {item.value}
              </Text>
            </View>
            {index < items.length - 1 ? (
              <View className="my-1 w-px self-stretch" style={{ backgroundColor: theme.outlineVariant }} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

