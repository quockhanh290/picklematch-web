import type { LucideIcon } from 'lucide-react-native'
import { ShieldCheck, TrendingUp, Zap } from 'lucide-react-native'
import { Text, View, Platform } from 'react-native'

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
  stats: { 
    hostedCount: number; 
    fillRate: number; 
    reliability: number 
  }
): DashboardStatItem[] {
  return [
    { id: 'hosted', label: 'Số kèo', value: String(stats.hostedCount).padStart(2, '0'), icon: TrendingUp },
    { id: 'fill', label: 'Lấp đầy', value: `${Math.round(stats.fillRate)}%`, icon: Zap },
    { id: 'reputation', label: 'Uy tín', value: `${Math.round(stats.reliability)}%`, icon: ShieldCheck },
  ]
}

export function DashboardStatsStrip({ items }: { items: DashboardStatItem[] }) {
  const theme = useAppTheme()
  const isWeb = Platform.OS === 'web'

  return (
    <View
      style={{
        marginTop: -12,
        marginBottom: -22, // Adjusted for smaller height
        zIndex: 999,
        flexDirection: 'row',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
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
            <View style={{ flex: 1, paddingHorizontal: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={12} color={iconColor} />
                <Text 
                  style={{ 
                    marginLeft: 4, 
                    fontSize: 9, 
                    textTransform: 'uppercase', 
                    letterSpacing: 0.5,
                    color: theme.onSurfaceVariant, 
                    fontFamily: SCREEN_FONTS.headline
                  }}
                >
                  {item.label}
                </Text>
              </View>
              <Text 
                style={{ 
                  marginTop: 2, 
                  textAlign: 'center', 
                  fontSize: 16, 
                  color: valueColor, 
                  fontFamily: SCREEN_FONTS.headline, 
                  lineHeight: 20 
                }}
              >
                {item.value}
              </Text>
            </View>
            {index < items.length - 1 ? (
              <View style={{ height: 24, width: 1, backgroundColor: theme.outlineVariant, opacity: 0.3 }} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
