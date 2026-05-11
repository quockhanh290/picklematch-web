import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import Slider from '@react-native-community/slider'
import React, { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { AppButton } from '@/components/design/AppButton'
import { useAppTheme } from '@/lib/theme-context'

import { STRINGS } from '@/constants/strings'
import { withAlpha } from '@/lib/utils/ui'

export type AdvancedFilter = {
  date: string
  weekend: boolean
  timeSlot: string | null
  skillLevel: string | null
  priceMin: number | undefined
  priceMax: number | undefined
  slotsLeft: number | undefined
}

export const ADVANCED_FILTER_INITIAL: AdvancedFilter = {
  date: '',
  weekend: false,
  timeSlot: null,
  skillLevel: null,
  priceMin: undefined,
  priceMax: undefined,
  slotsLeft: undefined,
}

type Props = {
  visible: boolean
  onClose: () => void
  filter: AdvancedFilter
  setFilter: React.Dispatch<React.SetStateAction<AdvancedFilter>>
  onApply: () => void
  onReset: () => void
  skillLevels?: { id: string; label: string }[]
}

const PRICE_SLIDER_MAX = 300
const FILTER_FONTS = {
  headline: SCREEN_FONTS.headline,
  body: SCREEN_FONTS.body,
  label: SCREEN_FONTS.label,
  cta: SCREEN_FONTS.cta,
} as const


function fmtDate(d: Date): string {
  const pad = (v: number) => v.toString().padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function addDays(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function buildDateChips(): { label: string; value: string }[] {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysToSat = ((6 - dayOfWeek) + 7) % 7
  const daysToSun = (7 - dayOfWeek) % 7

  const chips: { label: string; value: string }[] = [
    { label: STRINGS.find_session.advanced_filter.quick_dates.today, value: fmtDate(today) },
    { label: STRINGS.find_session.advanced_filter.quick_dates.tomorrow, value: fmtDate(addDays(1)) },
  ]

  if (daysToSat >= 2) chips.push({ label: STRINGS.find_session.advanced_filter.quick_dates.sat, value: fmtDate(addDays(daysToSat)) })
  if (daysToSun >= 2) chips.push({ label: STRINGS.find_session.advanced_filter.quick_dates.sun, value: fmtDate(addDays(daysToSun)) })
  return chips
}

function parseDateStr(s: string): Date {
  const [d, m, y] = s.split('/')
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export function AdvancedSessionFilterModal({
  visible,
  onClose,
  filter,
  setFilter,
  onApply,
  onReset,
  skillLevels = [],
}: Props) {
  const theme = useAppTheme()
  const [showDatePicker, setShowDatePicker] = useState(false)

  const chipStyle = (active: boolean) => ({
    backgroundColor: active ? theme.primary : theme.surfaceContainerLow,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 9,
    marginRight: 8,
    borderWidth: BORDER.base,
    borderColor: active ? theme.primary : theme.outlineVariant,
  })

  const chipTextStyle = (active: boolean) => ({
    color: active ? theme.onPrimary : theme.onSurfaceVariant,
    fontFamily: FILTER_FONTS.label,
    fontSize: 12,
  })

  const sectionLabel = {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 14,
    textTransform: 'uppercase',
    color: theme.primary,
    marginBottom: 10,
  } as const

  const dateChips = React.useMemo(() => buildDateChips(), [])
  const isQuickDate = dateChips.some((c) => c.value === filter.date)
  const hasCustomDate = !!filter.date && !isQuickDate

  const pickerDate = React.useMemo(
    () => (filter.date && /^\d{2}\/\d{2}\/\d{4}$/.test(filter.date) ? parseDateStr(filter.date) : new Date()),
    [filter.date],
  )

  const priceMin = filter.priceMin ?? 0
  const priceMax = filter.priceMax ?? PRICE_SLIDER_MAX
  const priceInvalid =
    typeof filter.priceMin === 'number' &&
    typeof filter.priceMax === 'number' &&
    filter.priceMin > filter.priceMax

  const priceMinLabel = priceMin === 0 ? STRINGS.find_session.advanced_filter.any : `${priceMin}k`
  const priceMaxLabel = priceMax >= PRICE_SLIDER_MAX ? `${PRICE_SLIDER_MAX}k+` : `${priceMax}k`

  function handleDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false)
    if (event.type === 'dismissed') return
    if (selected) {
      setFilter((f) => ({ ...f, date: fmtDate(selected), weekend: false }))
    }
  }

  function selectQuickDate(value: string) {
    setShowDatePicker(false)
    setFilter((f) => ({ ...f, date: f.date === value ? '' : value, weekend: false }))
  }

  function toggleWeekend() {
    setShowDatePicker(false)
    setFilter((f) => ({ ...f, weekend: !f.weekend, date: '' }))
  }

  function openDatePicker() {
    setFilter((f) => ({ ...f, weekend: false }))
    setShowDatePicker((v) => !v)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: withAlpha(theme.onBackground, 0.36), justifyContent: 'flex-end' }}>
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
            maxHeight: '92%',
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 24, color: theme.primary, textTransform: 'uppercase' }}>
              {STRINGS.find_session.advanced_filter.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={onReset} hitSlop={8}>
                <Text style={{ color: theme.primary, fontFamily: FILTER_FONTS.cta, fontSize: 13, textTransform: 'uppercase' }}>{STRINGS.find_session.advanced_filter.reset}</Text>
              </Pressable>
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
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <Text style={sectionLabel}>{STRINGS.find_session.advanced_filter.date}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 12 }}
              contentContainerStyle={{ paddingRight: 8 }}
            >
              {dateChips.map((chip) => (
                <Pressable
                  key={chip.value}
                  onPress={() => selectQuickDate(chip.value)}
                  style={chipStyle(filter.date === chip.value)}
                >
                  <Text style={chipTextStyle(filter.date === chip.value)}>{chip.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={toggleWeekend} style={chipStyle(filter.weekend)}>
                <Text style={chipTextStyle(filter.weekend)}>{STRINGS.find_session.advanced_filter.weekend}</Text>
              </Pressable>
              <Pressable onPress={openDatePicker} style={chipStyle(hasCustomDate || showDatePicker)}>
                <Text
                  style={{
                    fontFamily: FILTER_FONTS.label,
                    fontSize: 13,
                    color: theme.onSurface,
                  }}
                >
                  {hasCustomDate ? filter.date.slice(0, 5) : STRINGS.find_session.advanced_filter.select_date}
                </Text>
              </Pressable>
            </ScrollView>

            {showDatePicker && (
              <View
                style={{
                  marginBottom: 12,
                  padding: 12,
                  backgroundColor: theme.surfaceContainerLow,
                  borderRadius: RADIUS.md,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant,
                }}
              >
                {Platform.OS === 'web' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {[2, 3, 4, 5, 6].map(days => {
                      const d = addDays(days)
                      const val = fmtDate(d)
                      const label = `${d.getDate()}/${d.getMonth() + 1}`
                      return (
                        <Pressable
                          key={val}
                          onPress={() => selectQuickDate(val)}
                          style={chipStyle(filter.date === val)}
                        >
                          <Text style={chipTextStyle(filter.date === val)}>{label}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : (
                  <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={new Date()}
                    onChange={handleDateChange}
                    style={{ width: '100%', maxWidth: 360, backgroundColor: theme.surfaceContainerLow }}
                    accentColor={theme.primary}
                    themeVariant="light"
                  />
                )}
              </View>
            )}

            <Text style={sectionLabel}>{STRINGS.find_session.advanced_filter.time_slot}</Text>
            <View style={{ flexDirection: 'row', marginBottom: 16, justifyContent: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
              {[
                { id: 'morning', label: STRINGS.find_session.advanced_filter.time_slots.morning },
                { id: 'afternoon', label: STRINGS.find_session.advanced_filter.time_slots.afternoon },
                { id: 'evening', label: STRINGS.find_session.advanced_filter.time_slots.evening },
              ].map((slot) => (
                <Pressable
                  key={slot.id}
                  onPress={() => setFilter((f) => ({ ...f, timeSlot: f.timeSlot === slot.label ? null : slot.label }))}
                  style={chipStyle(filter.timeSlot === slot.label)}
                >
                  <Text style={chipTextStyle(filter.timeSlot === slot.label)}>{slot.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={sectionLabel}>{STRINGS.find_session.advanced_filter.skill_level}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {skillLevels.map((level) => (
                <Pressable
                  key={level.id}
                  onPress={() =>
                    setFilter((f) => ({ ...f, skillLevel: f.skillLevel === level.id ? null : level.id }))
                  }
                  style={chipStyle(filter.skillLevel === level.id)}
                >
                  <Text style={chipTextStyle(filter.skillLevel === level.id)}>{level.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={sectionLabel}>{STRINGS.find_session.advanced_filter.price}</Text>
            <View
              style={{
                backgroundColor: theme.surfaceContainerLow,
                borderRadius: RADIUS.lg,
                padding: 12,
                marginBottom: priceInvalid ? 4 : 16,
                borderWidth: BORDER.base,
                borderColor: theme.outlineVariant,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ fontFamily: FILTER_FONTS.label, fontSize: 12, color: theme.onSurfaceVariant }}>
                  {STRINGS.find_session.advanced_filter.price_from}
                </Text>
                <Text style={{ fontFamily: FILTER_FONTS.cta, fontSize: 13, color: theme.primary }}>
                  {priceMinLabel}
                </Text>
              </View>
              <Slider
                value={priceMin}
                onValueChange={(v) =>
                  setFilter((f) => ({ ...f, priceMin: Math.round(v) === 0 ? undefined : Math.round(v) }))
                }
                minimumValue={0}
                maximumValue={PRICE_SLIDER_MAX}
                step={10}
                minimumTrackTintColor={theme.primary}
                maximumTrackTintColor={theme.surfaceContainerHighest}
                thumbTintColor={theme.primary}
                style={{ marginHorizontal: -4 }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 2 }}>
                <Text style={{ fontFamily: FILTER_FONTS.label, fontSize: 12, color: theme.onSurfaceVariant }}>
                  {STRINGS.find_session.advanced_filter.price_to}
                </Text>
                <Text style={{ fontFamily: FILTER_FONTS.cta, fontSize: 13, color: theme.primary }}>
                  {priceMaxLabel}
                </Text>
              </View>
              <Slider
                value={priceMax}
                onValueChange={(v) =>
                  setFilter((f) => ({
                    ...f,
                    priceMax: Math.round(v) >= PRICE_SLIDER_MAX ? undefined : Math.round(v),
                  }))
                }
                minimumValue={0}
                maximumValue={PRICE_SLIDER_MAX}
                step={10}
                minimumTrackTintColor={theme.primary}
                maximumTrackTintColor={theme.surfaceContainerHighest}
                thumbTintColor={theme.primary}
                style={{ marginHorizontal: -4 }}
              />
            </View>
            {priceInvalid && (
              <Text style={{ color: theme.error, fontFamily: FILTER_FONTS.body, fontSize: 11, marginBottom: 16 }}>
                {STRINGS.find_session.advanced_filter.price_error}
              </Text>
            )}


            <Text style={sectionLabel}>{STRINGS.find_session.advanced_filter.slots_left}</Text>
            <View style={{ flexDirection: 'row', marginBottom: 24 }}>
              {[1, 2, 3, 4].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setFilter((f) => ({ ...f, slotsLeft: f.slotsLeft === n ? undefined : n }))}
                  style={chipStyle(filter.slotsLeft === n)}
                >
                  <Text style={chipTextStyle(filter.slotsLeft === n)}>{STRINGS.find_session.advanced_filter.slots_suffix.replace('{count}', n.toString())}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={{ marginTop: 24 }}>
            <AppButton
              label={STRINGS.find_session.advanced_filter.apply}
              onPress={onApply}
              disabled={priceInvalid}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}
