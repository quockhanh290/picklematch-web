import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Clock } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS } from '@/constants/screenLayout'

interface TimeRangePickerProps {
  startTime: Date | null
  endTime: Date | null
  onToggleStartPicker: () => void
  onToggleEndPicker: () => void
  selectedCourt: any
  selectedDate: Date | null
  isCourtScheduleLocked: boolean
  timeError: string | null
}

function formatTime(date: Date | null) {
  if (!date) return '--:--'
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

export function TimeRangePicker({
  startTime,
  endTime,
  onToggleStartPicker,
  onToggleEndPicker,
  selectedCourt,
  selectedDate,
  isCourtScheduleLocked,
  timeError,
}: TimeRangePickerProps) {
  const theme = useAppTheme()
  const durationHours = startTime && endTime
    ? (() => {
        const h = (endTime.getTime() - startTime.getTime()) / 3600000
        return Number.isInteger(h) ? `${h}` : h.toFixed(1)
      })()
    : null

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable
          disabled={!selectedCourt || isCourtScheduleLocked}
          onPress={onToggleStartPicker}
          style={({ pressed }) => ({
            paddingVertical: 8, opacity: !selectedCourt || isCourtScheduleLocked ? 0.55 : pressed ? 0.86 : 1, alignItems: 'flex-start'
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={14} color={theme.surfaceTint} strokeWidth={2.6} />
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2, color: theme.outline }}>Bắt đầu</Text>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: theme.surfaceTint, marginTop: 12, lineHeight: 36, textAlign: 'left' }}>
            {formatTime(startTime)}
          </Text>
        </Pressable>

        <View style={{ width: 1, height: '80%', backgroundColor: theme.outlineVariant }} />

        <Pressable
          disabled={!selectedDate || !startTime || isCourtScheduleLocked}
          onPress={onToggleEndPicker}
          style={({ pressed }) => ({
            paddingVertical: 8, opacity: !selectedDate || !startTime || isCourtScheduleLocked ? 0.45 : pressed ? 0.86 : 1, alignItems: 'flex-end'
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2, color: theme.outline }}>Kết thúc</Text>
            <View style={{ width: 28, height: 28, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={14} color={theme.surfaceTint} strokeWidth={2.6} />
            </View>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: theme.surfaceTint, marginTop: 12, lineHeight: 36, textAlign: 'right' }}>
            {formatTime(endTime)}
          </Text>
        </Pressable>
      </View>

      {/* Duration chip */}
      {durationHours ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>Thời lượng:</Text>
          <View style={{ backgroundColor: theme.secondaryContainer, paddingHorizontal: 12, paddingVertical: 3, borderRadius: RADIUS.full }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.primary }}>{durationHours} tiếng</Text>
          </View>
        </View>
      ) : null}

      {timeError ? (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: theme.error, marginTop: 10 }}>
          {timeError}
        </Text>
      ) : null}
    </View>
  )
}
