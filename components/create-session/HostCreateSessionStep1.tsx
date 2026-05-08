import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { ScrollView, Text, TouchableOpacity, View, Pressable } from 'react-native'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { SelectedCourtCard } from './SelectedCourtCard'
import { DateStripPicker } from './DateStripPicker'
import { TimeRangePicker } from './TimeRangePicker'
import { SectionDivider } from './SectionDivider'
import DateTimePicker from '@react-native-community/datetimepicker'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Users, CheckCircle2, Trophy } from 'lucide-react-native'

type Format = 'social' | 'round_robin' | 'open_play'

type Props = {
  onBack: () => void
  selectedCourt: any
  selectedDate: Date | null
  startTime: Date | null
  endTime: Date | null
  onDateSelect: (date: Date) => void
  onStartTimeChange: (date: Date) => void
  onEndTimeChange: (date: Date) => void
  onContinue: () => void
  showStartPicker: boolean
  showEndPicker: boolean
  onToggleStartPicker: () => void
  onToggleEndPicker: () => void
  onCloseStartPicker: () => void
  onCloseEndPicker: () => void
  defaultPickerValue: (type: 'start' | 'end') => Date
  timeError: string | null
  format: Format | null
  setFormat: (format: Format) => void
}

const MONTH_LABELS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function HostCreateSessionStep1({
  onBack,
  selectedCourt,
  selectedDate,
  startTime,
  endTime,
  onDateSelect,
  onStartTimeChange,
  onEndTimeChange,
  onContinue,
  showStartPicker,
  showEndPicker,
  onToggleStartPicker,
  onToggleEndPicker,
  onCloseStartPicker,
  onCloseEndPicker,
  defaultPickerValue,
  timeError,
  format,
  setFormat
}: Props) {
  const theme = useAppTheme()
  const scrollRef = useRef<ScrollView | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [pickerAnchorY, setPickerAnchorY] = useState(0)
  
  const [draftDate, setDraftDate] = useState(selectedDate ?? new Date())
  const [draftStartTime, setDraftStartTime] = useState(startTime ?? defaultPickerValue('start'))
  const [draftEndTime, setDraftEndTime] = useState(endTime ?? defaultPickerValue('end'))

  useEffect(() => {
    if (showStartPicker) setDraftStartTime(startTime ?? defaultPickerValue('start'))
  }, [showStartPicker])

  useEffect(() => {
    if (showEndPicker) setDraftEndTime(endTime ?? defaultPickerValue('end'))
  }, [showEndPicker])

  useEffect(() => {
    if (!(showDatePicker || showStartPicker || showEndPicker)) return
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, pickerAnchorY - 12), animated: true })
    }, 60)
    return () => clearTimeout(timer)
  }, [pickerAnchorY, showDatePicker, showEndPicker, showStartPicker])

  function openDatePicker() {
    setDraftDate(selectedDate ?? new Date())
    setShowDatePicker(true)
  }

  function confirmDraftDate() {
    onDateSelect(startOfDay(draftDate))
    setShowDatePicker(false)
  }

  const pickerHeader = useMemo(() => ({
    width: '100%' as any,
    maxWidth: 360,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    borderBottomWidth: 1,
    borderBottomColor: theme.outlineVariant,
    paddingHorizontal: 16,
    paddingVertical: 12,
  }), [theme.outlineVariant])

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ flex: 1 }}
        scrollEnabled={!(showStartPicker || showEndPicker || showDatePicker)}
      >
        {/* Step title */}
        <View style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 52, color: theme.primary, lineHeight: 54, opacity: 0.2, letterSpacing: -1, paddingRight: 6, paddingTop: 6 }}>
              01/
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 28, color: theme.primary, lineHeight: 30, letterSpacing: -0.3, flex: 1, paddingBottom: 2 }}>
              Sân & Thời gian
            </Text>
          </View>
          <View style={{ width: 32, height: 3, backgroundColor: theme.tertiary, borderRadius: 2 }} />
        </View>

        {/* Selected Court (Fixed) */}
        <View style={{ marginBottom: 24 }}>
          <SelectedCourtCard
            selectedCourt={selectedCourt}
            isCourtScheduleLocked={false}
            showCourtPicker={false}
            setIsChoosingCourt={() => {}}
          />
        </View>

        <SectionDivider index="01/" title="Hình thức thi đấu" />
        <View style={{ gap: 10, marginBottom: 24 }}>
          {[
            { id: 'social', title: 'Giao lưu Social', desc: 'Dành cho hội nhóm, vui vẻ là chính.', icon: Users },
            { id: 'open_play', title: 'Open Play', desc: 'Sân mở cho mọi người đăng ký thoải mái.', icon: CheckCircle2 },
            { id: 'round_robin', title: 'Giải Round Robin', desc: 'Thi đấu vòng tròn, tính điểm Elo.', icon: Trophy },
          ].map((item) => {
            const isSelected = format === item.id
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => setFormat(item.id as Format)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isSelected ? theme.primary : theme.surface,
                  borderRadius: RADIUS.xl,
                  padding: 16,
                  gap: 16,
                  borderWidth: isSelected ? 0 : BORDER.base,
                  borderColor: theme.outlineVariant,
                  ...SHADOW.xs
                }}
              >
                <View style={{ 
                  width: 44, 
                  height: 44, 
                  borderRadius: RADIUS.lg, 
                  backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : theme.surfaceVariant, 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <item.icon size={22} color={isSelected ? theme.onPrimary : theme.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.headline, 
                    fontSize: 16, 
                    color: isSelected ? theme.onPrimary : theme.onSurface 
                  }}>
                    {item.title}
                  </Text>
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.body, 
                    fontSize: 12, 
                    color: isSelected ? theme.onPrimary : theme.onSurfaceVariant,
                    opacity: isSelected ? 0.8 : 1,
                    marginTop: 2
                  }}>
                    {item.desc}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        <SectionDivider index="02/" title="Chọn ngày giờ chơi" />

        <View style={{
          borderRadius: RADIUS.xl,
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
          backgroundColor: theme.surfaceContainerLowest,
          padding: SPACING.lg,
          marginBottom: 18,
        }}>
          <DateStripPicker
            selectedDate={selectedDate}
            isCourtScheduleLocked={false}
            onDateSelect={onDateSelect}
            openDatePicker={openDatePicker}
            selectedCourt={selectedCourt}
          />

          <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginVertical: 12 }} />

          {selectedDate && (
            <TimeRangePicker
              startTime={startTime}
              endTime={endTime}
              onToggleStartPicker={onToggleStartPicker}
              onToggleEndPicker={onToggleEndPicker}
              selectedCourt={selectedCourt}
              selectedDate={selectedDate}
              isCourtScheduleLocked={false}
              timeError={timeError}
            />
          )}
        </View>

        <View onLayout={(e) => setPickerAnchorY(e.nativeEvent.layout.y)} />

        {/* Pickers */}
        {showDatePicker && (
          <View style={{ marginBottom: 14, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, alignItems: 'center' }}>
            <View style={pickerHeader}>
              <Pressable onPress={() => setShowDatePicker(false)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurfaceVariant }}>Hủy</Text>
              </Pressable>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>{MONTH_LABELS[draftDate.getMonth()]}</Text>
              <Pressable onPress={confirmDraftDate} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.primary }}>Xong</Text>
              </Pressable>
            </View>
            {Platform.OS === 'web' ? (
              <View style={{ width: '100%', padding: 20, alignItems: 'center', backgroundColor: theme.surfaceContainerLow }}>
                <Text style={{ color: theme.onSurface, marginBottom: 12, fontFamily: SCREEN_FONTS.body }}>Chọn ngày (Web):</Text>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {/* Basic fallback for web: next 7 days selection */}
                  {Array.from({ length: 14 }).map((_, i) => {
                    const d = new Date()
                    d.setDate(d.getDate() + i)
                    const isSelected = draftDate.toDateString() === d.toDateString()
                    return (
                      <TouchableOpacity 
                        key={i} 
                        onPress={() => setDraftDate(d)}
                        style={{ 
                          padding: 10, 
                          borderRadius: 8, 
                          backgroundColor: isSelected ? theme.primary : theme.surfaceVariant,
                          minWidth: 60,
                          alignItems: 'center'
                        }}
                      >
                        <Text style={{ color: isSelected ? theme.onPrimary : theme.onSurface, fontSize: 12 }}>
                          {d.getDate()}/{d.getMonth() + 1}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            ) : (
              <DateTimePicker mode="date" display="spinner" themeVariant="light" value={draftDate} minimumDate={new Date()} locale="vi-VN" style={{ width: '100%', maxWidth: 360, height: 216, backgroundColor: theme.surfaceContainerLow }} onChange={(_e, d) => d && setDraftDate(d)} />
            )}
          </View>
        )}
 
        {showStartPicker && (
          <View style={{ marginBottom: 14, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, alignItems: 'center' }}>
            <View style={pickerHeader}>
              <Pressable onPress={onCloseStartPicker} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurfaceVariant }}>Hủy</Text>
              </Pressable>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Giờ bắt đầu</Text>
              <Pressable onPress={() => { onStartTimeChange(draftStartTime); onCloseStartPicker(); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.primary }}>Xong</Text>
              </Pressable>
            </View>
            {Platform.OS === 'web' ? (
              <ScrollView style={{ height: 216, width: '100%', backgroundColor: theme.surfaceContainerLowest }} contentContainerStyle={{ padding: 10 }}>
                {Array.from({ length: 48 }).map((_, i) => {
                  const hours = Math.floor(i / 2)
                  const minutes = (i % 2) * 30
                  const d = new Date(draftStartTime)
                  d.setHours(hours, minutes, 0, 0)
                  const label = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
                  const isSelected = draftStartTime.getHours() === hours && draftStartTime.getMinutes() === minutes
                  return (
                    <TouchableOpacity 
                      key={i} 
                      onPress={() => setDraftStartTime(d)}
                      style={{ padding: 15, borderBottomWidth: 0.5, borderColor: theme.outlineVariant, backgroundColor: isSelected ? theme.primaryContainer : 'transparent' }}
                    >
                      <Text style={{ color: isSelected ? theme.primary : theme.onSurface, textAlign: 'center', fontFamily: SCREEN_FONTS.headline, fontSize: 18 }}>{label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            ) : (
              <DateTimePicker mode="time" display="spinner" themeVariant="light" value={draftStartTime} is24Hour locale="vi-VN" style={{ width: '100%', maxWidth: 360, height: 216, backgroundColor: theme.surfaceContainerLowest }} onChange={(_e, d) => d && setDraftStartTime(d)} />
            )}
          </View>
        )}
 
        {showEndPicker && (
          <View style={{ marginBottom: 14, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, alignItems: 'center' }}>
            <View style={pickerHeader}>
              <Pressable onPress={onCloseEndPicker} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurfaceVariant }}>Hủy</Text>
              </Pressable>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Giờ kết thúc</Text>
              <Pressable onPress={() => { onEndTimeChange(draftEndTime); onCloseEndPicker(); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.primary }}>Xong</Text>
              </Pressable>
            </View>
            {Platform.OS === 'web' ? (
              <ScrollView style={{ height: 216, width: '100%', backgroundColor: theme.surfaceContainerLowest }} contentContainerStyle={{ padding: 10 }}>
                {Array.from({ length: 48 }).map((_, i) => {
                  const hours = Math.floor(i / 2)
                  const minutes = (i % 2) * 30
                  const d = new Date(draftEndTime)
                  d.setHours(hours, minutes, 0, 0)
                  const label = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
                  const isSelected = draftEndTime.getHours() === hours && draftEndTime.getMinutes() === minutes
                  return (
                    <TouchableOpacity 
                      key={i} 
                      onPress={() => setDraftEndTime(d)}
                      style={{ padding: 15, borderBottomWidth: 0.5, borderColor: theme.outlineVariant, backgroundColor: isSelected ? theme.primaryContainer : 'transparent' }}
                    >
                      <Text style={{ color: isSelected ? theme.primary : theme.onSurface, textAlign: 'center', fontFamily: SCREEN_FONTS.headline, fontSize: 18 }}>{label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            ) : (
              <DateTimePicker mode="time" display="spinner" themeVariant="light" value={draftEndTime} is24Hour locale="vi-VN" style={{ width: '100%', maxWidth: 360, height: 216, backgroundColor: theme.surfaceContainerLowest }} onChange={(_e, d) => d && setDraftEndTime(d)} />
            )}
          </View>
        )}
      </ScrollView>

      {/* Fixed Bottom bar */}
      <View style={{ 
        position: 'absolute',
        bottom: 0,
        left: -SPACING.xl,
        right: -SPACING.xl,
        flexDirection: 'row', 
        gap: 10, 
        paddingHorizontal: 16, 
        paddingTop: 12, 
        paddingBottom: 28, 
        backgroundColor: theme.surface, 
        borderTopWidth: 0.5, 
        borderTopColor: theme.outlineVariant,
        ...SHADOW.md
      }}>
        <TouchableOpacity
          onPress={onBack}
          style={{ flex: 1, borderRadius: RADIUS.md, borderWidth: BORDER.medium, borderColor: theme.outlineVariant, paddingVertical: 13, alignItems: 'center', backgroundColor: theme.surface }}
        >
          <Text style={{ fontSize: 15, color: theme.onSurface, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase' }}>Quay lại</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onContinue}
          style={{ flex: 2, borderRadius: RADIUS.md, backgroundColor: theme.primary, paddingVertical: 13, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 15, color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase' }}>Tiếp tục →</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
