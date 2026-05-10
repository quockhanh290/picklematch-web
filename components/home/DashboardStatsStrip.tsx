import type { LucideIcon } from 'lucide-react-native'
import { ShieldCheck, TrendingUp, Zap, Swords, Percent } from 'lucide-react-native'
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
  profile: { sessions_joined?: number | null; reliability_score?: number | null; current_elo?: number | null; elo?: number | null; pvna?: number | null } | null,
  playerStats: { win_rate?: number | null } | null,
): DashboardStatItem[] {
  const matchesValue = profile?.sessions_joined ?? 0
  const winRateValue = playerStats?.win_rate ?? 0
  const pvnaValue = profile?.pvna
  const reliabilityValue = profile?.reliability_score ?? 100

  return [
    { id: 'matches', label: 'Số trận', value: String(matchesValue).padStart(2, '0'), icon: Swords },
    { id: 'win_rate', label: 'Thắng', value: `${Math.round(winRateValue)}%`, icon: Percent },
    { id: 'elo', label: 'ĐIỂM PVNA', value: (pvnaValue !== null && pvnaValue !== undefined) ? pvnaValue.toLocaleString('vi-VN') : '--', icon: TrendingUp },
    { id: 'reputation', label: 'Uy tín', value: `${reliabilityValue}%`, icon: ShieldCheck },
  ]
}

export function DashboardStatsStrip({ items }: { items: DashboardStatItem[] }) {
  const theme = useAppTheme()

  return (
    <View
      style={{
        marginTop: 0,
        marginBottom: 0,
        flexDirection: 'row',
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: 'white',
        borderColor: '#F1EFE9',
      }}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        const valueColor =
          item.id === 'matches'
            ? theme.primary
            : item.id === 'win_rate'
              ? theme.onPrimaryFixedVariant
              : theme.surfaceTint
        const iconColor =
          item.id === 'matches'
            ? theme.primary
            : item.id === 'win_rate'
              ? theme.onPrimaryFixedVariant
              : theme.surfaceTint

        return (
          <View key={item.id} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={14} color={iconColor} strokeWidth={iconStroke} />
                <Text style={{ 
                  marginLeft: 6, 
                  fontSize: 11, 
                  textTransform: 'uppercase', 
                  letterSpacing: 0.5,
                  color: theme.onSurfaceVariant, 
                  fontFamily: SCREEN_FONTS.headline 
                }}>
                  {item.label}
                </Text>
              </View>
              <Text style={{ 
                marginTop: 4, 
                textAlign: 'center', 
                fontSize: 22,
                color: valueColor, 
                fontFamily: SCREEN_FONTS.headline, 
                lineHeight: 28 
              }}>
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

