import React from 'react'
import { Pressable, Text, TextInput, View, Linking, TouchableOpacity } from 'react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { Phone, Navigation, MapPin, Info } from 'lucide-react-native'
import type { NearByCourt } from '@/lib/useNearbyCourts'

interface BookingStatusSectionProps {
  selectedCourt: NearByCourt | null
  bookingStatus: 'confirmed' | 'unconfirmed'
  setBookingStatus: (s: 'confirmed' | 'unconfirmed') => void
  wantsBookingNow: boolean | null
  setWantsBookingNow: (value: boolean | null) => void
  showBookingLinkCta: boolean
  onOpenBookingLink: () => void
  shouldShowBookingDetails: boolean
  bookingReference: string
  setBookingReference: (value: string) => void
  bookingName: string
  setBookingName: (value: string) => void
  bookingPhone: string
  setBookingPhone: (value: string) => void
  bookingNotes: string
  setBookingNotes: (value: string) => void
}

export function BookingStatusSection({
  selectedCourt,
  bookingStatus,
  setBookingStatus,
  wantsBookingNow,
  setWantsBookingNow,
  showBookingLinkCta,
  onOpenBookingLink,
  shouldShowBookingDetails,
  bookingReference,
  setBookingReference,
  bookingName,
  setBookingName,
  bookingPhone,
  setBookingPhone,
  bookingNotes,
  setBookingNotes,
}: BookingStatusSectionProps) {
  const theme = useAppTheme()
  const { onOpenCourt } = useSessionNav()
  const handleCall = () => {
    if (selectedCourt?.phone) {
      Linking.openURL(`tel:${selectedCourt.phone}`)
    }
  }

  const handleOpenMaps = () => {
    if (selectedCourt?.google_maps_url) {
      Linking.openURL(selectedCourt.google_maps_url)
    }
  }

  return (
    <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 10 }}>
        TÌNH TRẠNG SÂN
      </Text>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.onSecondaryContainer, marginBottom: 8 }}>
        Trạng thái đặt sân
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {[
          { value: 'confirmed' as const, label: 'Đã đặt sân' },
          { value: 'unconfirmed' as const, label: 'Chưa đặt sân' },
        ].map((item) => {
          const active = bookingStatus === item.value
          return (
            <Pressable
              key={item.value}
              onPress={() => setBookingStatus(item.value)}
              style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
            >
              <View style={{
                borderRadius: RADIUS.full, borderWidth: BORDER.base,
                borderColor: active ? theme.primary : theme.outlineVariant,
                backgroundColor: active ? theme.primary : theme.surfaceContainerLowest,
                paddingHorizontal: SPACING.md, paddingVertical: 11, alignItems: 'center',
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: active ? theme.onPrimary : theme.onSecondaryContainer }}>
                  {item.label}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>

      {bookingStatus === 'unconfirmed' ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.onSecondaryContainer, marginBottom: 8 }}>
            Bạn có muốn đặt ngay bây giờ không?
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[
              { value: true, label: 'Có' },
              { value: false, label: 'Không' },
            ].map((item) => {
              const active = wantsBookingNow === item.value
              return (
                <Pressable
                  key={item.label}
                  onPress={() => setWantsBookingNow(item.value)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}
                >
                  <View style={{
                    borderRadius: RADIUS.full, borderWidth: BORDER.base,
                    borderColor: active ? theme.primary : theme.outlineVariant,
                    backgroundColor: active ? theme.primary : theme.surfaceContainerLowest,
                    paddingHorizontal: SPACING.md, paddingVertical: 9, alignItems: 'center',
                  }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: active ? theme.onPrimary : theme.onSecondaryContainer }}>
                      {item.label}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      {bookingStatus === 'unconfirmed' && wantsBookingNow === true && selectedCourt ? (
        <View style={{ 
          backgroundColor: theme.surface, 
          borderRadius: RADIUS.lg, 
          padding: 16, 
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.outlineVariant
        }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 15, color: theme.onSurface, marginBottom: 4, textTransform: 'uppercase' }}>
            {selectedCourt.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
            <MapPin size={12} color={theme.onSurfaceVariant} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, marginLeft: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant }}>
              {selectedCourt.address}
            </Text>
          </View>

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity 
                onPress={handleCall}
                style={{ 
                  flex: 1.2, 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  backgroundColor: theme.primary, 
                  paddingVertical: 10, 
                  borderRadius: RADIUS.md 
                }}
              >
                <Phone size={14} color={theme.surface} />
                <Text style={{ marginLeft: 8, color: theme.surface, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>ĐẶT SÂN NGAY</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleOpenMaps}
                style={{ 
                  flex: 1, 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  backgroundColor: theme.surfaceContainerLow, 
                  paddingVertical: 10, 
                  borderRadius: RADIUS.md,
                  borderWidth: 1,
                  borderColor: theme.outlineVariant
                }}
              >
                <Navigation size={14} color={theme.primary} />
                <Text style={{ marginLeft: 8, color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>CHỈ ĐƯỜNG</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity 
              onPress={() => onOpenCourt(selectedCourt.id)}
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'center', 
                backgroundColor: theme.secondaryContainer, 
                paddingVertical: 10, 
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.outlineVariant
              }}
            >
              <Info size={14} color={theme.surfaceTint} />
              <Text style={{ marginLeft: 8, color: theme.surfaceTint, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>XEM CHI TIẾT SÂN</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {shouldShowBookingDetails ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.onSecondaryContainer }}>
            Thông tin booking
          </Text>
          <View style={{ borderRadius: RADIUS.md, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 12, paddingVertical: 9 }}>
            <TextInput
              value={bookingReference}
              onChangeText={setBookingReference}
              placeholder="Mã đặt sân"
              placeholderTextColor={theme.outline}
              style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.primary, padding: 0 }}
            />
          </View>
          <View style={{ borderRadius: RADIUS.md, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 12, paddingVertical: 9 }}>
            <TextInput
              value={bookingName}
              onChangeText={setBookingName}
              placeholder="Tên người đặt sân"
              placeholderTextColor={theme.outline}
              style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.primary, padding: 0 }}
            />
          </View>
          <View style={{ borderRadius: RADIUS.md, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 12, paddingVertical: 9 }}>
            <TextInput
              value={bookingPhone}
              onChangeText={setBookingPhone}
              placeholder="Số điện thoại"
              placeholderTextColor={theme.outline}
              keyboardType="phone-pad"
              style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.primary, padding: 0 }}
            />
          </View>
          <View style={{ borderRadius: RADIUS.md, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 12, paddingVertical: SPACING.sm }}>
            <TextInput
              value={bookingNotes}
              onChangeText={setBookingNotes}
              placeholder="Ghi chú booking (tuỳ chọn)"
              placeholderTextColor={theme.outline}
              multiline
              textAlignVertical="top"
              style={{ minHeight: 68, fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.primary, padding: 0 }}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}
