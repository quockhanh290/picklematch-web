import { Minus, Plus, User, Users } from 'lucide-react-native'
import {  Text, TouchableOpacity, View, TextInput } from 'react-native'

import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

interface PlayerCountSelectorProps {
  maxPlayers: number
  setMaxPlayers: (n: number) => void
  playMode: 'singles' | 'doubles'
  setPlayMode: (v: 'singles' | 'doubles') => void
  
  // Sub-court props
  subCourtCount: number
  selectedSubCourts: number[]
  onSubCourtsChange: (nums: number[]) => void
}

export function PlayerCountSelector({ 
  maxPlayers, 
  setMaxPlayers,
  playMode,
  setPlayMode,
  subCourtCount,
  selectedSubCourts,
  onSubCourtsChange
}: PlayerCountSelectorProps) {
  const theme = useAppTheme()

  const increment = () => {
    if (maxPlayers < 20) setMaxPlayers(maxPlayers + 1)
  }

  const decrement = () => {
    const min = playMode === 'singles' ? 2 : 4
    if (maxPlayers > min) setMaxPlayers(maxPlayers - 1)
  }

  const courts = Array.from({ length: subCourtCount || 1 }, (_, i) => i + 1)
  const isAllSelected = selectedSubCourts.length === subCourtCount

  const handleToggleAll = () => {
    if (isAllSelected) onSubCourtsChange([])
    else onSubCourtsChange(courts)
  }

  const handleSelectCourt = (num: number) => {
    if (selectedSubCourts.includes(num)) {
      onSubCourtsChange(selectedSubCourts.filter(n => n !== num))
    } else {
      onSubCourtsChange([...selectedSubCourts, num])
    }
  }

  return (
    <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
      {/* 1. Hình thức thi đấu */}
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 12 }}>
        {'HÌNH THỨC THI ĐẤU'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        {[
          { value: 'singles', label: 'ĐƠN', icon: User, defaultPlayers: 2 },
          { value: 'doubles', label: 'ĐÔI', icon: Users, defaultPlayers: 4 },
        ].map(({ value, label, icon: Icon, defaultPlayers }) => {
          const isSelected = playMode === value
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                setPlayMode(value as any)
                if (maxPlayers < defaultPlayers) setMaxPlayers(defaultPlayers)
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
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 16, opacity: 0.5 }} />

      {/* 2. Sử dụng sân con */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
            {'SỬ DỤNG SÂN CON'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, marginTop: 2 }}>
            Chọn sân con trong cụm sân
          </Text>
        </View>

        <View style={{ 
          flexDirection: 'row', 
          alignItems: 'center', 
          borderRadius: RADIUS.md, 
          borderWidth: BORDER.base, 
          borderColor: theme.outlineVariant, 
          backgroundColor: theme.surfaceContainerLowest, 
          paddingHorizontal: 8, 
          paddingVertical: 4,
          width: 110
        }}>
          <TextInput
            value={selectedSubCourts.join(', ')}
            onChangeText={(text) => {
              // Parse numbers from string like "1, 2, 3" or "1 2 3"
              const nums = text.split(/[\s,]+/)
                .map(s => parseInt(s.trim()))
                .filter(n => !isNaN(n) && n > 0 && n <= subCourtCount)
              
              // Remove duplicates and sort
              onSubCourtsChange([...new Set(nums)].sort((a, b) => a - b))
            }}
            placeholder="1, 2..."
            placeholderTextColor={theme.outline}
            keyboardType="numbers-and-punctuation"
            style={{ 
              flex: 1, 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 18, 
              color: theme.primary, 
              textAlign: 'center',
              padding: 0
            }}
          />
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 16, opacity: 0.5 }} />

      {/* 3. Số người tối đa */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
            {'SỐ NGƯỜI TỐI ĐA'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, marginTop: 2 }}>
            Tổng số người có thể tham gia
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={decrement}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Minus size={18} color={theme.primary} />
          </TouchableOpacity>

          <Text style={{ 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 22, 
            color: theme.primary,
            minWidth: 28,
            textAlign: 'center'
          }}>
            {maxPlayers}
          </Text>

          <TouchableOpacity
            onPress={increment}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Plus size={18} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
