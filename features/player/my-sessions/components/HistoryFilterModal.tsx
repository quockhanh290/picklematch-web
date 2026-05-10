import React from 'react'
import { Modal, View, Pressable, Text, ScrollView } from 'react-native'
import { X, RotateCcw } from 'lucide-react-native'
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
  isInline?: boolean
  filters: {
    status: string
    role: string
    time: string
    rating: string
    result: string
  }
  onFilterChange: (key: string, value: any) => void
  onReset?: () => void
}

export function HistoryFilterModal({
  visible,
  onClose,
  isInline = false,
  filters,
  onFilterChange,
  onReset,
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
      style={{
        backgroundColor: isActive ? theme.primary : theme.surfaceContainerLow,
        borderWidth: BORDER.hairline,
        borderColor: isActive ? theme.primary : theme.outlineVariant,
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      <Text
        style={{
          color: isActive ? theme.onPrimary : theme.onSurfaceVariant,
          fontFamily: SCREEN_FONTS.bold,
          fontSize: 11,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )

  const content = (
    <View style={{ gap: 20 }}>
      {/* Header */}
      {!isInline && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 24, textTransform: 'uppercase' }}>
            Bộ lọc lịch sử
          </Text>
          <Pressable onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} color={theme.onSurfaceVariant} strokeWidth={2.6} />
          </Pressable>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20 }}>
        {/* Status & Role Row */}
        <View style={{ flexDirection: isInline ? 'row' : 'column', gap: isInline ? 32 : 20 }}>
           <View style={{ flex: 1 }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13, marginBottom: 8, opacity: 0.8 }}>TRẠNG THÁI</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {HISTORY_STATUS_OPTIONS.map((opt) => renderHistoryFilterChip(`st-${opt.id}`, opt.label, filters.status === opt.id, () => onFilterChange('status', opt.id)))}
              </View>
           </View>
           <View style={{ flex: 1 }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13, marginBottom: 8, opacity: 0.8 }}>VAI TRÒ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {HISTORY_ROLE_OPTIONS.map((opt) => renderHistoryFilterChip(`ro-${opt.id}`, opt.label, filters.role === opt.id, () => onFilterChange('role', opt.id)))}
              </View>
           </View>
        </View>

        {/* Time & Rating Row */}
        <View style={{ flexDirection: isInline ? 'row' : 'column', gap: isInline ? 32 : 20 }}>
           <View style={{ flex: 1 }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13, marginBottom: 8, opacity: 0.8 }}>THỜI GIAN</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {HISTORY_TIME_OPTIONS.map((opt) => renderHistoryFilterChip(`ti-${opt.id}`, opt.label, filters.time === opt.id, () => onFilterChange('time', opt.id)))}
              </View>
           </View>
           <View style={{ flex: 1 }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13, marginBottom: 8, opacity: 0.8 }}>ĐÁNH GIÁ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {HISTORY_RATING_OPTIONS.map((opt) => renderHistoryFilterChip(`ra-${opt.id}`, opt.label, filters.rating === opt.id, () => onFilterChange('rating', opt.id)))}
              </View>
           </View>
        </View>

        {/* Result */}
        <View>
           <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.bold, fontSize: 13, marginBottom: 8, opacity: 0.8 }}>KẾT QUẢ</Text>
           <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
             {HISTORY_RESULT_OPTIONS.map((opt) => renderHistoryFilterChip(`re-${opt.id}`, opt.label, filters.result === opt.id, () => onFilterChange('result', opt.id)))}
           </View>
        </View>
      </ScrollView>

      {/* Footer Buttons */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        {onReset && (
          <Pressable
            onPress={onReset}
            style={{ 
              flex: 1, 
              height: 44, 
              borderRadius: RADIUS.md, 
              borderWidth: 1, 
              borderColor: theme.outlineVariant,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <RotateCcw size={14} color={theme.onSurfaceVariant} />
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>XÓA BỘ LỌC</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onClose}
          style={{ 
            flex: 2, 
            height: 44, 
            borderRadius: RADIUS.md, 
            backgroundColor: theme.primary,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>
            {isInline ? 'ẨN BỘ LỌC' : 'ÁP DỤNG'}
          </Text>
        </Pressable>
      </View>
    </View>
  )

  if (isInline) {
    if (!visible) return null
    return (
      <View 
        style={{ 
          backgroundColor: theme.surfaceContainerLow, 
          borderRadius: RADIUS.lg, 
          padding: 20,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
        }}
      >
        {content}
      </View>
    )
  }

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
          {content}
        </View>
      </View>
    </Modal>
  )
}
