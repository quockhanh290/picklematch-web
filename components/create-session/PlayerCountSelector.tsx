import { Minus, Plus, User, Users } from 'lucide-react-native'
import {  Text, TouchableOpacity, View } from 'react-native'

import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

interface PlayerCountSelectorProps {
  maxPlayers: number
  setMaxPlayers: (n: number) => void
  playMode: 'singles' | 'doubles'
  setPlayMode: (v: 'singles' | 'doubles') => void
}

export function PlayerCountSelector({ 
  maxPlayers, 
  setMaxPlayers,
  playMode,
  setPlayMode
}: PlayerCountSelectorProps) {
  const theme = useAppTheme()

  const increment = () => {
    if (maxPlayers < 20) setMaxPlayers(maxPlayers + 1)
  }

  const decrement = () => {
    const min = playMode === 'singles' ? 2 : 4
    if (maxPlayers > min) setMaxPlayers(maxPlayers - 1)
  }

  return (
    <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
      {/* 1. Hình thức thi đấu */}
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 12 }}>
        {'HÌNH THỨC THI ĐẤU'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        {[
          { value: 'singles', label: 'Đơn (2)', icon: User, defaultPlayers: 2 },
          { value: 'doubles', label: 'Đôi (4)', icon: Users, defaultPlayers: 4 },
        ].map(({ value, label, icon: Icon, defaultPlayers }) => {
          const isSelected = playMode === value
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                setPlayMode(value as any)
                // Also reset max players to default if current is too low
                if (maxPlayers < defaultPlayers) {
                  setMaxPlayers(defaultPlayers)
                }
              }}
              style={{
                flex: 1,
                backgroundColor: isSelected ? theme.primary : theme.surfaceContainerLowest,
                borderRadius: RADIUS.lg,
                paddingVertical: 14,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                borderWidth: BORDER.medium,
                borderColor: isSelected ? theme.primary : theme.outlineVariant,
              }}
            >
              <Icon size={20} color={isSelected ? theme.onPrimary : theme.onSurfaceVariant} />
              <Text style={{ 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 15, 
                color: isSelected ? theme.onPrimary : theme.onSurface 
              }}>
                {value === 'singles' ? 'ĐƠN' : 'ĐÔI'}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 16, opacity: 0.5 }} />

      {/* 2. Số người tối đa */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
            {'SỐ NGƯỜI TỐI ĐA'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, marginTop: 2 }}>
            Tổng số người có thể tham gia kèo
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <TouchableOpacity
            onPress={decrement}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Minus size={20} color={theme.primary} />
          </TouchableOpacity>

          <Text style={{ 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 24, 
            color: theme.primary,
            minWidth: 30,
            textAlign: 'center'
          }}>
            {maxPlayers}
          </Text>

          <TouchableOpacity
            onPress={increment}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Plus size={20} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
