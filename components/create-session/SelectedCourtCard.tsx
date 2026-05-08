import React from 'react'
import { Text, TouchableOpacity, View, Platform } from 'react-native'
import { MapPin, Info, Star } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, BORDER, SHADOW } from '@/constants/screenLayout'
import type { NearByCourt } from '@/lib/useNearbyCourts'
import { isCurrentlyOpen } from '@/lib/utils/court'

interface SelectedCourtCardProps {
  selectedCourt: NearByCourt
  isCourtScheduleLocked: boolean
  showCourtPicker: boolean
  setIsChoosingCourt: (val: boolean) => void
  onChangeCourt?: () => void
}

function formatDistance(distance?: number) {
  if (distance == null) return null
  return distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`
}

function formatCourtPricePerHour(price: number | null) {
  if (price == null) return null
  if (price >= 1000) return `${Math.round(price / 1000)}K/giờ`
  return `${price.toLocaleString('vi-VN')} VNĐ/giờ`
}

export function SelectedCourtCard({
  selectedCourt,
  isCourtScheduleLocked,
  showCourtPicker,
  setIsChoosingCourt,
  onChangeCourt,
}: SelectedCourtCardProps) {
  const theme = useAppTheme()
  const { onOpenCourt } = useSessionNav()

  if (!selectedCourt) return null

  const selectedCourtAddress = `${selectedCourt.address}${selectedCourt.city ? ` · ${selectedCourt.city}` : ''}`
  const isBusinessOpen = isCurrentlyOpen(selectedCourt.hours_open, selectedCourt.hours_close)
  const hasSlots = !!selectedCourt.hasSlots
  const selectedCourtPriceLabel = formatCourtPricePerHour(selectedCourt.price_per_hour)

  return (
    <View style={{
      borderRadius: RADIUS.lg,
      overflow: 'hidden',
      backgroundColor: theme.surfaceContainerLowest,
      borderWidth: BORDER.base,
      borderColor: theme.outlineVariant,
      ...SHADOW.sm,
    }}>
      <View style={{
        backgroundColor: theme.primary,
        paddingHorizontal: 16,
        paddingVertical: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.onPrimary }} />
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 13, letterSpacing: 0.5 }}>
            {'SÂN ĐÃ CHỌN'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>

          {!isCourtScheduleLocked && onChangeCourt && (
            <TouchableOpacity
              onPress={() => {
                if (showCourtPicker) {
                  setIsChoosingCourt(false)
                  return
                }
                onChangeCourt()
                setIsChoosingCourt(true)
              }}
            >
              <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 13, textTransform: 'uppercase' }}>
                {showCourtPicker ? 'Đóng' : 'Đổi sân'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={{ padding: 16 }}>
        <TouchableOpacity 
          onPress={() => onOpenCourt(selectedCourt.id)}
          style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}
        >
          <Text
            numberOfLines={Platform.OS === 'web' ? undefined : 2}
            style={{
              color: theme.onSurface,
              fontFamily: SCREEN_FONTS.headline,
              fontSize: 31,
              lineHeight: 36,
              letterSpacing: 0,
              marginBottom: 4,
              textTransform: 'uppercase',
              flex: 1,
            }}
          >
            {selectedCourt.name}
          </Text>
          <View style={{ marginTop: 6 }}>
            <Info size={24} color={theme.primary} strokeWidth={2.5} />
          </View>
        </TouchableOpacity>

        {selectedCourt.rating != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Star size={12} color="#FBC02D" fill="#FBC02D" />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurface }}>
                {selectedCourt.rating.toFixed(1)}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.outline }}>
                ({selectedCourt.rating_count ?? 0} đánh giá)
              </Text>
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 6, marginBottom: 12 }}>
          <MapPin size={13} color={theme.onSurfaceVariant} strokeWidth={2.5} />
          <Text numberOfLines={1} style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 18, flexShrink: 1 }}>
            {selectedCourtAddress}
          </Text>
        </View>
      </View>


      <View style={{ backgroundColor: theme.surfaceAlt, padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              {'CHI PHÍ'}
            </Text>
            <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 24, lineHeight: 24 }}>
              {selectedCourtPriceLabel ?? '—'}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: isBusinessOpen ? theme.primary : theme.error }} />
              <Text style={{
                marginLeft: 6,
                color: isBusinessOpen ? theme.primary : theme.error,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {isBusinessOpen ? 'Đang mở' : 'Đã đóng'}
              </Text>
            </View>


          </View>
        </View>
      </View>
    </View>
  )
}
