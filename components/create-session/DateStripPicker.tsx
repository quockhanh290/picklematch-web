import React, { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Calendar } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, BORDER } from '@/constants/screenLayout'

interface DateStripPickerProps {
  selectedDate: Date | null
  isCourtScheduleLocked: boolean
  onDateSelect: (date: Date) => void
  openDatePicker: () => void
  selectedCourt: any
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function isSameDay(left: Date | null, right: Date) {
  return !!left && left.toDateString() === right.toDateString()
}

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

function formatHeroDateLabel(date: Date | null) {
  if (!date) return 'Chưa chọn ngày'
  const weekdayLong = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][date.getDay()]
  return `${weekdayLong}, ngày ${date.getDate()} tháng ${date.getMonth() + 1}`
}

export function DateStripPicker({
  selectedDate,
  isCourtScheduleLocked,
  onDateSelect,
  openDatePicker,
  selectedCourt,
}: DateStripPickerProps) {
  const theme = useAppTheme()
  const dateStrip = useMemo(() => {
    const today = startOfDay(new Date())
    const selected = selectedDate ? startOfDay(selectedDate) : today
    const diffDays = Math.floor((selected.getTime() - today.getTime()) / 86_400_000)
    const offset = diffDays > 6 ? diffDays - 3 : 0
    const stripStart = addDays(today, Math.max(0, offset))
    return Array.from({ length: 7 }, (_, index) => addDays(stripStart, index))
  }, [selectedDate])

  return (
    <Pressable
      disabled={!selectedCourt || isCourtScheduleLocked}
      onPress={openDatePicker}
      style={({ pressed }) => ({
        opacity: !selectedCourt || isCourtScheduleLocked ? 0.55 : pressed ? 0.86 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
          <Calendar size={14} color={theme.surfaceTint} strokeWidth={2.6} />
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2, color: theme.outline }}>
          Ngày chơi
        </Text>
      </View>
      {selectedCourt ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ flexGrow: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingHorizontal: 4 }}
        >
          {dateStrip.map((day) => {
            const active = isSameDay(selectedDate, day)
            const weekend = isWeekend(day)
            return (
              <Pressable
                key={day.toISOString()}
                disabled={isCourtScheduleLocked}
                onPress={() => onDateSelect(day)}
                style={({ pressed }) => ({
                  width: 54,
                  alignItems: 'center',
                  borderRadius: RADIUS.md,
                  borderWidth: BORDER.base,
                  borderColor: active ? theme.primary : theme.outlineVariant,
                  backgroundColor: theme.surfaceContainerLow,
                  paddingVertical: 12,
                  paddingHorizontal: 8,
                  opacity: isCourtScheduleLocked ? 0.55 : pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, textTransform: 'uppercase', textAlign: 'center', color: active ? theme.primary : weekend ? theme.error : theme.outline }}>
                  {WEEKDAY_LABELS[day.getDay()]}
                </Text>
                <View style={{ marginTop: 4, width: 36, height: 36, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.primary : 'transparent' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 22, lineHeight: 26, textAlign: 'center', color: active ? theme.onPrimary : weekend ? theme.error : theme.onSurface }}>
                    {day.getDate().toString().padStart(2, '0')}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
      {selectedCourt ? (
        <>
          <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginVertical: 12 }} />
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: theme.surfaceTint, lineHeight: 36 }}>
            {formatHeroDateLabel(selectedDate)}
          </Text>
        </>
      ) : null}
    </Pressable>
  )
}
