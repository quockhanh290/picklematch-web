import React from 'react'
import { Modal, View, Pressable, Text, ScrollView } from 'react-native'
import { X } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, BORDER } from '@/constants/screenLayout'

const HISTORY_STATUS_OPTIONS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'done', label: 'Đã chơi' },
  { id: 'pending_completion', label: 'Chờ chốt' },
  { id: 'cancelled', label: 'Đã hủy' },
]
const HISTORY_ROLE_OPTIONS = [
  { id: 'all', label: 'Mọi vai trò' },
  { id: 'host', label: 'Host' },
  { id: 'player', label: 'Người chơi' },
]
const HISTORY_TIME_OPTIONS = [
  { id: 'all', label: 'Tất cả thời gian' },
  { id: '7d', label: '7 ngày' },
  { id: '30d', label: '30 ngày' },
  { id: '90d', label: '3 tháng' },
]
const HISTORY_RATING_OPTIONS = [
  { id: 'all', label: 'Tất cả đánh giá' },
  { id: 'rated', label: 'Đã đánh giá' },
  { id: 'not_rated', label: 'Chưa đánh giá' },
]
const HISTORY_RESULT_OPTIONS = [
  { id: 'all', label: 'Tất cả kết quả' },
  { id: 'submitted', label: 'Đã nhập kết quả' },
  { id: 'not_submitted', label: 'Chưa nhập kết quả' },
]

type HistoryFilterModalProps = {
  visible: boolean
  onClose: () => void
  filters: {
    status: string
    role: string
    time: string
    rating: string
    result: string
  }
  onFilterChange: (key: string, value: any) => void
}

export function HistoryFilterModal({
  visible,
  onClose,
  filters,
  onFilterChange,
}: HistoryFilterModalProps) {
  const theme = useAppTheme()
  const renderHistoryFilterChip = (
    id: string,
    label: string,
    isActive: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={id}
      onPress={onPress}
      className="rounded-full px-4 py-2.5 mr-2 mb-2"
      style={{
        backgroundColor: isActive ? theme.primary : theme.surfaceContainerLow,
        borderWidth: BORDER.base,
        borderColor: isActive ? theme.primary : theme.outlineVariant,
      }}
    >
      <Text
        style={{
          color: isActive ? theme.onPrimary : theme.onSurfaceVariant,
          fontFamily: SCREEN_FONTS.label,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            backgroundColor: theme.background,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: theme.outlineVariant,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 32,
            maxHeight: '90%',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -8 },
            elevation: 12,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 24,
                textTransform: 'uppercase',
              }}
            >
              Bộ lọc lịch sử
            </Text>
            <Pressable
              onPress={onClose}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.surfaceContainerLow,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} color={theme.onSurfaceVariant} strokeWidth={2.6} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Trạng thái
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 16 }}>
              {HISTORY_STATUS_OPTIONS.map((option) =>
                renderHistoryFilterChip(
                  `status-${option.id}`,
                  option.label,
                  filters.status === option.id,
                  () => onFilterChange('status', option.id),
                ),
              )}
            </View>

            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Vai trò
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 16 }}>
              {HISTORY_ROLE_OPTIONS.map((option) =>
                renderHistoryFilterChip(
                  `role-${option.id}`,
                  option.label,
                  filters.role === option.id,
                  () => onFilterChange('role', option.id),
                ),
              )}
            </View>

            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Thời gian
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 16 }}>
              {HISTORY_TIME_OPTIONS.map((option) =>
                renderHistoryFilterChip(
                  `time-${option.id}`,
                  option.label,
                  filters.time === option.id,
                  () => onFilterChange('time', option.id),
                ),
              )}
            </View>

            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Đánh giá
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 16 }}>
              {HISTORY_RATING_OPTIONS.map((option) =>
                renderHistoryFilterChip(
                  `rating-${option.id}`,
                  option.label,
                  filters.rating === option.id,
                  () => onFilterChange('rating', option.id),
                ),
              )}
            </View>

            <Text
              style={{
                color: theme.primary,
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 14,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Kết quả
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 24 }}>
              {HISTORY_RESULT_OPTIONS.map((option) =>
                renderHistoryFilterChip(
                  `result-${option.id}`,
                  option.label,
                  filters.result === option.id,
                  () => onFilterChange('result', option.id),
                ),
              )}
            </View>
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              height: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS.full,
              backgroundColor: theme.primary,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 16, textTransform: 'uppercase' }}>
              Áp dụng bộ lọc
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
