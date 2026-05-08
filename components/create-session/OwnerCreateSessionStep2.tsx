import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View, Switch, TextInput } from 'react-native'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { SectionDivider } from './SectionDivider'
import { PlayerCountSelector } from './PlayerCountSelector'
import { SkillRangeSelector } from './SkillRangeSelector'
import { SkillToleranceSelector } from './SkillToleranceSelector'
import { AppDialog } from '@/components/design'
import * as Haptics from 'expo-haptics'
import React, { useState } from 'react'

type Props = {
  onBack: () => void
  maxPlayers: number
  setMaxPlayers: (n: number) => void
  minSkill: number
  setMinSkill: (n: number) => void
  maxSkill: number
  setMaxSkill: (n: number) => void
  requireApproval: boolean
  setRequireApproval: (value: boolean) => void
  requireResults: boolean
  setRequireResults: (value: boolean) => void
  costPerPersonStr: string
  setCostPerPersonStr: (value: string) => void
  onContinue: () => void
  skillTolerance: number
  setTolerance: (n: number) => void
  // Owner Specific
  subCourtCount: number
  selectedSubCourts: number[]
  onSubCourtsChange: (nums: number[]) => void
  isNewbie: boolean
  setIsNewbie: (v: boolean) => void
  hostIsPlaying: boolean
  setHostIsPlaying: (v: boolean) => void
  hostGender: 'male' | 'female'
  setHostGender: (v: 'male' | 'female') => void
  hostSkill: number
  setHostSkill: (v: number) => void
  playMode: 'singles' | 'doubles'
  setPlayMode: (v: 'singles' | 'doubles') => void
}

function formatCurrencyInput(nextValue: string) {
  const digits = nextValue.replace(/\D/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('vi-VN')
}

export function OwnerCreateSessionStep2({
  onBack,
  maxPlayers,
  setMaxPlayers,
  minSkill,
  setMinSkill,
  maxSkill,
  setMaxSkill,
  requireApproval,
  setRequireApproval,
  requireResults,
  setRequireResults,
  costPerPersonStr,
  setCostPerPersonStr,
  onContinue,
  skillTolerance,
  setTolerance,
  subCourtCount,
  selectedSubCourts,
  onSubCourtsChange,
  isNewbie,
  setIsNewbie,
  hostIsPlaying,
  setHostIsPlaying,
  hostGender,
  setHostGender,
  hostSkill,
  setHostSkill,
  playMode,
  setPlayMode
}: Props) {
  const theme = useAppTheme()
  const canHaptics = Platform.OS !== 'web'
  const [dialogConfig, setDialogConfig] = useState<any>(null)

  const courts = Array.from({ length: subCourtCount || 1 }, (_, i) => i + 1)
  const isAllSelected = selectedSubCourts.length === subCourtCount

  const handleToggleAll = () => {
    try { if (canHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch {}
    if (isAllSelected) onSubCourtsChange([])
    else onSubCourtsChange(courts)
  }

  const handleSelectCourt = (num: number) => {
    try { if (canHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch {}
    if (selectedSubCourts.includes(num)) {
      onSubCourtsChange(selectedSubCourts.filter(n => n !== num))
    } else {
      onSubCourtsChange([...selectedSubCourts, num])
    }
  }

  const toggleRequireResults = (value: boolean) => {
    if (value) {
      setDialogConfig({
        title: 'Bật yêu cầu kết quả?',
        message: 'Khi bật tính năng này, người tham gia sẽ bắt buộc phải cập nhật tỉ số sau khi trận đấu kết thúc.',
        actions: [
          { label: 'Hủy', onPress: () => setDialogConfig(null), style: 'cancel' },
          { 
            label: 'Đồng ý', 
            onPress: () => {
              setRequireResults(true)
              setDialogConfig(null)
            }
          }
        ]
      })
    } else {
      setRequireResults(false)
    }
  }

  const toggleRequireApproval = (value: boolean) => {
    if (value) {
      setDialogConfig({
        title: 'Bật phê duyệt?',
        message: 'Bạn sẽ cần duyệt thủ công từng người chơi trước khi họ có thể tham gia vào kèo đấu này.',
        actions: [
          { label: 'Hủy', onPress: () => setDialogConfig(null), style: 'cancel' },
          { 
            label: 'Đồng ý', 
            onPress: () => {
              setRequireApproval(true)
              setDialogConfig(null)
            }
          }
        ]
      })
    } else {
      setRequireApproval(false)
    }
  }

  const toggleNewbie = (value: boolean) => {
    try { if (canHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch {}
    setIsNewbie(value)
    if (value) {
      setMinSkill(2.0)
      setMaxSkill(2.5)
      setTolerance(0)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        style={{ flex: 1 }}
      >
        {/* Step title */}
        <View style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 52, color: theme.primary, lineHeight: 54, opacity: 0.2, letterSpacing: -1, paddingRight: 6, paddingTop: 6 }}>
              02
            </Text>
            <Text
              style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 28, color: theme.primary, lineHeight: 30, letterSpacing: -0.3, flex: 1, paddingBottom: 2 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Cấu hình Trận đấu
            </Text>
          </View>
          <View style={{ width: 32, height: 3, backgroundColor: theme.tertiary, borderRadius: 2 }} />
        </View>

        <SectionDivider index="01" title="Cấu hình trận đấu" />

        <PlayerCountSelector 
          maxPlayers={maxPlayers} 
          setMaxPlayers={setMaxPlayers} 
          playMode={playMode}
          setPlayMode={setPlayMode}
        />

        {/* Sub-court Selector (Refined) */}
        <View style={{ 
          marginBottom: 16, 
          padding: SPACING.lg, 
          backgroundColor: theme.surfaceContainerLow, 
          borderRadius: RADIUS.xl, 
          borderWidth: BORDER.base, 
          borderColor: theme.outlineVariant 
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
                SỬ DỤNG SÂN CON SỐ
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, marginTop: 2 }}>
                Đã chọn: {selectedSubCourts.length} / {subCourtCount} sân
              </Text>
            </View>
            <TouchableOpacity 
              onPress={handleToggleAll}
              style={{ 
                paddingHorizontal: 12, 
                paddingVertical: 6, 
                borderRadius: RADIUS.full, 
                backgroundColor: isAllSelected ? theme.primaryContainer : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: theme.primary }}>
                {isAllSelected ? 'BỎ CHỌN HẾT' : 'CHỌN TẤT CẢ'}
              </Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ 
            flexDirection: 'row', 
            flexWrap: 'wrap', 
            gap: 10, 
            justifyContent: 'center'
          }}>
            {courts.map((num) => {
              const isSelected = selectedSubCourts.includes(num)
              return (
                <TouchableOpacity
                  key={num}
                  activeOpacity={0.8}
                  onPress={() => handleSelectCourt(num)}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: RADIUS.sm,
                    backgroundColor: isSelected ? theme.primary : theme.surfaceContainerLowest,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: BORDER.medium,
                    borderColor: isSelected ? theme.primary : theme.outlineVariant,
                    ...SHADOW.xs
                  }}
                >
                  <Text style={{ 
                    color: isSelected ? theme.onPrimary : theme.onSurfaceVariant, 
                    fontFamily: SCREEN_FONTS.headline,
                    fontSize: 18
                  }}>
                    {num}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>{'Yêu cầu nhập kết quả'}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginTop: 2 }}>{'Yêu cầu người chơi nhập tỉ số sau mỗi trận'}</Text>
            </View>
            <Switch
              value={requireResults}
              onValueChange={toggleRequireResults}
              trackColor={{ false: theme.surfaceDim, true: theme.surfaceTint }}
              thumbColor={theme.surfaceContainerLowest}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>{'Yêu cầu phê duyệt'}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginTop: 2 }}>{'Chủ sân cần duyệt người tham gia'}</Text>
            </View>
            <Switch
              value={requireApproval}
              onValueChange={toggleRequireApproval}
              trackColor={{ false: theme.surfaceDim, true: theme.surfaceTint }}
              thumbColor={theme.surfaceContainerLowest}
            />
          </View>

          <View style={{ width: '100%', height: 1, backgroundColor: theme.outlineVariant, marginVertical: 14, opacity: 0.5 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>{'Chủ sân cùng tham gia'}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginTop: 2 }}>{'Tên chủ sân sẽ hiện trong danh sách người chơi'}</Text>
            </View>
            <Switch
              value={hostIsPlaying}
              onValueChange={setHostIsPlaying}
              trackColor={{ false: theme.surfaceDim, true: theme.surfaceTint }}
              thumbColor={theme.surfaceContainerLowest}
            />
          </View>

          {hostIsPlaying && (
            <View style={{ 
              marginTop: 16, 
              paddingTop: 16, 
              borderTopWidth: 1, 
              borderTopColor: theme.outlineVariant, 
              borderStyle: 'dashed',
              gap: 16 
            }}>
              {/* Host Gender */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurfaceVariant }}>
                  Giới tính chủ sân
                </Text>
                <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderRadius: RADIUS.md, padding: 4, gap: 4, borderWidth: 1, borderColor: theme.outlineVariant }}>
                  {(['male', 'female'] as const).map((g) => {
                    const isSelected = hostGender === g
                    return (
                      <TouchableOpacity
                        key={g}
                        onPress={() => setHostGender(g)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: RADIUS.sm,
                          backgroundColor: isSelected ? (g === 'male' ? '#E1F5EE' : '#FAECE7') : 'transparent',
                          borderWidth: isSelected ? 1 : 0,
                          borderColor: g === 'male' ? '#0F6E5630' : '#993C1D30'
                        }}
                      >
                        <Text style={{ 
                          fontFamily: SCREEN_FONTS.headline, 
                          fontSize: 11, 
                          color: isSelected ? (g === 'male' ? '#0F6E56' : '#993C1D') : theme.onSurfaceVariant 
                        }}>
                          {g === 'male' ? 'NAM' : 'NỮ'}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>

              {/* Host Skill */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurfaceVariant }}>
                    Trình độ cá nhân
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline }}>
                    Dùng để sắp xếp đội cân bằng
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => setHostSkill(Math.max(2.0, Math.round((hostSkill - 0.1) * 10) / 10))}
                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: theme.primary, fontSize: 18, fontWeight: 'bold' }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary, minWidth: 36, textAlign: 'center' }}>
                    {hostSkill.toFixed(1)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setHostSkill(Math.min(7.0, Math.round((hostSkill + 0.1) * 10) / 10))}
                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: theme.primary, fontSize: 18, fontWeight: 'bold' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Skill range */}
        <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary }}>
                {'PHẠM VI TRÌNH ĐỘ'}
              </Text>
              {isNewbie && (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.tertiary, marginTop: 2 }}>
                  Đang bật chế độ cho người mới
                </Text>
              )}
            </View>
            <TouchableOpacity 
              onPress={() => toggleNewbie(!isNewbie)}
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                gap: 6,
                backgroundColor: isNewbie ? theme.primary : theme.surface,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: RADIUS.full,
                borderWidth: 1,
                borderColor: isNewbie ? theme.primary : theme.outlineVariant
              }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isNewbie ? theme.onPrimary : theme.outline }} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: isNewbie ? theme.onPrimary : theme.onSurfaceVariant }}>
                NEWBIE
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ opacity: isNewbie ? 0.4 : 1 }} pointerEvents={isNewbie ? 'none' : 'auto'}>
            <SkillRangeSelector
              minSkill={minSkill}
              maxSkill={maxSkill}
              setMinSkill={setMinSkill}
              setMaxSkill={setMaxSkill}
            />

            <SkillToleranceSelector
              tolerance={skillTolerance}
              setTolerance={setTolerance}
            />
          </View>
        </View>

        <SectionDivider index="02" title="Chi phí tham gia" />

        {/* Unified Cost Input Box */}
        <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 10 }}>
            CHI PHÍ / NGƯỜI
          </Text>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest, paddingHorizontal: 12, paddingVertical: 9 }}>
              <TextInput
                value={costPerPersonStr}
                onChangeText={(value) => {
                  const formatted = formatCurrencyInput(value);
                  console.log('[Step 2] cost input:', value, 'formatted:', formatted);
                  setCostPerPersonStr(formatted);
                }}
                placeholder="Nhập số tiền mỗi người đóng"
                placeholderTextColor={theme.outline}
                keyboardType="number-pad"
                style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.primary, padding: 0 }}
              />
              <Text style={{ fontSize: 12, color: theme.outline, marginLeft: 8 }}>VNĐ</Text>
            </View>
            
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, lineHeight: 16 }}>
                Đây là chi phí cố định mà mỗi người tham gia sẽ phải đóng.
              </Text>
            </View>
          </View>
        </View>
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

      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}
