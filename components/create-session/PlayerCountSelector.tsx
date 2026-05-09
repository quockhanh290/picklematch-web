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

      <View style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
              {'SỬ DỤNG SÂN CON'}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, marginTop: 2 }}>
              Chọn các sân sử dụng cho kèo này (1-16)
            </Text>
          </View>
          
          <TouchableOpacity 
            onPress={() => {
              if (selectedSubCourts.length === 16) onSubCourtsChange([1])
              else onSubCourtsChange(Array.from({ length: 16 }, (_, i) => i + 1))
            }}
            style={{ backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.outlineVariant }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 10, color: theme.primary }}>
              {selectedSubCourts.length === 16 ? 'BỎ CHỌN HẾT' : 'CHỌN TẤT CẢ'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: 16 }, (_, i) => i + 1).map((num) => {
            const isSelected = selectedSubCourts.includes(num)
            return (
              <TouchableOpacity
                key={num}
                onPress={() => {
                  if (isSelected) {
                    if (selectedSubCourts.length > 1) {
                      onSubCourtsChange(selectedSubCourts.filter(n => n !== num))
                    }
                  } else {
                    onSubCourtsChange([...selectedSubCourts, num].sort((a, b) => a - b))
                  }
                }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: isSelected ? theme.primary : theme.surfaceContainerLowest,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: isSelected ? theme.primary : theme.outlineVariant,
                }}
              >
                <Text style={{ 
                  fontFamily: SCREEN_FONTS.bold, 
                  fontSize: 14, 
                  color: isSelected ? theme.onPrimary : theme.onSurfaceVariant 
                }}>
                  {num}
                </Text>
              </TouchableOpacity>
            )
          })}
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
