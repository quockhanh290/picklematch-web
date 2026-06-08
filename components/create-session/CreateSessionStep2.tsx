import { ScreenHeader } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { SectionDivider } from './SectionDivider'
import { SkillRangeSelector } from './SkillRangeSelector'
import { PlayerCountSelector } from './PlayerCountSelector'
import { SessionToggles } from './SessionToggles'
import { CostInput } from './CostInput'
import { BookingStatusSection } from './BookingStatusSection'
import { SkillToleranceSelector } from './SkillToleranceSelector'
import type { NearByCourt } from '@/lib/useNearbyCourts'

type Props = {
  selectedCourt: NearByCourt | null
  onBack: () => void
  maxPlayers: number
  setMaxPlayers: (n: number) => void
  minSkill: number
  setMinSkill: (n: number) => void
  maxSkill: number
  setMaxSkill: (n: number) => void
  bookingStatus: 'confirmed' | 'unconfirmed'
  setBookingStatus: (s: 'confirmed' | 'unconfirmed') => void
  wantsBookingNow: boolean | null
  setWantsBookingNow: (value: boolean | null) => void
  bookingReference: string
  setBookingReference: (value: string) => void
  bookingName: string
  setBookingName: (value: string) => void
  bookingPhone: string
  setBookingPhone: (value: string) => void
  bookingNotes: string
  setBookingNotes: (value: string) => void
  canOpenBookingLink: boolean
  onOpenBookingLink: () => void
  deadlineMinutes: number
  setDeadlineMinutes: (minutes: number) => void
  requireApproval: boolean
  setRequireApproval: (value: boolean) => void
  isRanked: boolean
  setIsRanked: (value: boolean) => void
  canToggleRanked: boolean
  rankedHelperText: string | null
  totalCostStr: string
  setTotalCostStr: (value: string) => void
  costPerPerson: number
  onContinue: () => void
  skillTolerance: number
  setTolerance: (n: number) => void
  hideHeader?: boolean
}

export function CreateSessionStep2({
  selectedCourt,
  onBack,
  maxPlayers,
  setMaxPlayers,
  minSkill,
  setMinSkill,
  maxSkill,
  setMaxSkill,
  bookingStatus,
  setBookingStatus,
  wantsBookingNow,
  setWantsBookingNow,
  bookingReference,
  setBookingReference,
  bookingName,
  setBookingName,
  bookingPhone,
  setBookingPhone,
  bookingNotes,
  setBookingNotes,
  canOpenBookingLink,
  onOpenBookingLink,
  deadlineMinutes,
  setDeadlineMinutes,
  requireApproval,
  setRequireApproval,
  isRanked,
  setIsRanked,
  canToggleRanked,
  rankedHelperText,
  totalCostStr,
  setTotalCostStr,
  costPerPerson,
  onContinue,
  skillTolerance,
  setTolerance,
  hideHeader = false,
}: Props) {
  const theme = useAppTheme()
  const showBookingLinkCta = bookingStatus === 'unconfirmed' && wantsBookingNow === true && canOpenBookingLink
  const shouldShowBookingDetails =
    bookingStatus === 'confirmed' ||
    (bookingStatus === 'unconfirmed' && wantsBookingNow === true)

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
      <View style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          style={{ flex: 1 }}
        >
          {!hideHeader && (
            <>
              <ScreenHeader
                variant="brand"
                title="KINETIC"
                onBackPress={onBack}
                style={{ marginHorizontal: -20, marginTop: -12 }}
                rightSlot={<View style={{ width: 32, height: 32 }} />}
              />

              {/* Progress bar */}
              <View style={{ height: 3, backgroundColor: theme.outlineVariant, borderRadius: RADIUS.full, marginTop: 12, marginBottom: 24, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: '66%', backgroundColor: theme.primary, borderRadius: RADIUS.full }} />
              </View>
            </>
          )}

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
            playMode={'doubles'}
            setPlayMode={() => {}}
            subCourtCount={1}
            selectedSubCourts={[1]}
            onSubCourtsChange={() => {}}
          />

          <SessionToggles
            isRanked={isRanked}
            setIsRanked={setIsRanked}
            canToggleRanked={canToggleRanked}
            rankedHelperText={rankedHelperText}
            requireApproval={requireApproval}
            setRequireApproval={setRequireApproval}
          />

          {/* Skill range */}
          <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 14 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 10 }}>
              {'PHẠM VI TRÌNH ĐỘ'}
            </Text>

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

          <SectionDivider index="02" title="Booking và chi phí" />

          <CostInput
            totalCostStr={totalCostStr}
            setTotalCostStr={setTotalCostStr}
            costPerPerson={costPerPerson}
          />

          {/* Deadline */}
          <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, letterSpacing: 1.2, color: theme.primary, marginBottom: 10 }}>
              HẠN CHỐT VÀO KÈO
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginBottom: 8 }}>
              Chọn mốc trước giờ bắt đầu
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                { value: 30, label: '30 phút' },
                { value: 45, label: '45 phút' },
                { value: 60, label: '1 giờ' },
                { value: 120, label: '2 giờ' },
              ].map((option) => {
                const active = deadlineMinutes === option.value
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setDeadlineMinutes(option.value)}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 8,
                      borderRadius: RADIUS.md,
                      backgroundColor: active ? theme.primary : theme.surface,
                      borderWidth: BORDER.medium,
                      borderColor: active ? theme.primary : theme.outlineVariant,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.label, color: active ? theme.onPrimary : theme.onSurface }}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          <BookingStatusSection
            selectedCourt={selectedCourt}
            bookingStatus={bookingStatus}
            setBookingStatus={setBookingStatus}
            wantsBookingNow={wantsBookingNow}
            setWantsBookingNow={setWantsBookingNow}
            showBookingLinkCta={showBookingLinkCta}
            onOpenBookingLink={onOpenBookingLink}
            shouldShowBookingDetails={shouldShowBookingDetails}
            bookingReference={bookingReference}
            setBookingReference={setBookingReference}
            bookingName={bookingName}
            setBookingName={setBookingName}
            bookingPhone={bookingPhone}
            setBookingPhone={setBookingPhone}
            bookingNotes={bookingNotes}
            setBookingNotes={setBookingNotes}
          />
        </ScrollView>

        {/* Bottom bar */}
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: -20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, backgroundColor: theme.surfaceContainerLow, borderTopWidth: 0.5, borderTopColor: theme.outlineVariant }}>
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
    </KeyboardAvoidingView>
  )
}
