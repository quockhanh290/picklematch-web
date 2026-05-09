import type { LucideIcon } from 'lucide-react-native'
import { Star, TrendingUp, Users, Zap } from 'lucide-react-native'
import { Platform, Text, View } from 'react-native'

import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

export type DashboardStatItem = {
  id: string
  label: string
  value: string
  icon: LucideIcon
}

const iconStroke = 2.7

export function buildDashboardStats(
  stats: {
    hostedCount: number;
    fillRate: number;
    rating: number;
    totalPlayers: number;
  }
): DashboardStatItem[] {
  return [
    { id: 'hosted', label: 'Số kèo', value: String(stats.hostedCount).padStart(2, '0'), icon: TrendingUp },
    { id: 'players', label: 'Người chơi', value: String(stats.totalPlayers), icon: Users },
    { id: 'fill', label: 'Lấp đầy', value: `${Math.round(stats.fillRate)}%`, icon: Zap },
    { id: 'rating', label: 'Đánh giá', value: stats.rating.toFixed(1), icon: Star },
  ]
}

export function DashboardStatsStrip({ items }: { items: DashboardStatItem[] }) {
  const theme = useAppTheme()
  const isWeb = Platform.OS === 'web'

  return (
    <View
      style={{
        marginTop: -12,
        marginBottom: -22,
        zIndex: 999,
        flexDirection: 'row',
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'white',
        borderColor: '#F1EFE9',
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
          <View key={item.id} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} color={iconColor} strokeWidth={iconStroke} />
                <Text
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                    color: theme.onSurfaceVariant,
                    fontFamily: SCREEN_FONTS.headline
                  }}
                >
                  {item.label}
                </Text>
              </View>
              <Text
                style={{
                  marginTop: 4,
                  textAlign: 'center',
                  fontSize: 24,
                  color: valueColor,
                  fontFamily: SCREEN_FONTS.headline,
                  lineHeight: 30
                }}
              >
                {item.value}
              </Text>
            </View>
            {index < items.length - 1 ? (
              <View style={{ height: 32, width: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
