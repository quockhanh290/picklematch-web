import { CreateSessionStep1 } from '@/components/create-session/CreateSessionStep1'
import { CreateSessionStep2 } from '@/components/create-session/CreateSessionStep2'
import { CreateSessionStep3 } from '@/components/create-session/CreateSessionStep3'
import { useAppTheme } from '@/lib/theme-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { SPACING } from '@/constants/screenLayout'
import { AppDialog, AppLoading, SecondaryNavbar } from '@/components/design'
import { STRINGS } from '@/constants/strings'
import { useCreateSessionController } from './hooks/useCreateSessionController'

export function CreateSessionScreen() {
  const theme = useAppTheme()
  const params = useLocalSearchParams<{ editSessionId?: string }>()
  const router = useRouter()
  const editSessionId = typeof params.editSessionId === 'string' ? params.editSessionId : null
  const isEditMode = Boolean(editSessionId)

  const {
    isLoading,
    step,
    setStep,
    courts,
    loadingCourts,
    fallbackMode,
    keyword,
    setKeyword,
    searching,
    selectedCourt,
    setSelectedCourt,
    selectedDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    showStartPicker,
    setShowStartPicker,
    showEndPicker,
    setShowEndPicker,
    timeError,
    setTimeError,
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
    submitting,
    isHydratingEdit,
    editHydrated,
    dialogConfig,
    setDialogConfig,
    lockCourtSchedule,
    costPerPerson,
    totalCostStr,
    setTotalCostStr,
    onCourtSelect,
    onDatePress,
    goToStep2,
    goToStep3FromNew,
    submit,
    openCourtBookingLink,
    defaultPickerValue,
    canToggleRanked,
    rankedHelperText,
    isRanked,
    setIsRanked,
    deadlineMinutes,
    setDeadlineMinutes,
    requireApproval,
    setRequireApproval,
    skillTolerance,
    setSkillTolerance,
  } = useCreateSessionController(editSessionId)

  if (isLoading || (isEditMode && isHydratingEdit && !editHydrated)) {
    return <AppLoading fullScreen />
  }

  const progressMap = { 1: 0.33, 2: 0.66, 3: 1 }

  function withTime(base: Date, time: Date): Date {
    const next = new Date(base)
    next.setHours(time.getHours(), time.getMinutes(), 0, 0)
    return next
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaceAlt }}>
      <SecondaryNavbar
        title={STRINGS.create_session.title}
        showProgress
        progress={progressMap[step as keyof typeof progressMap]}
        onBackPress={() => {
          if (step === 1) router.back()
          else if (step === 2) setStep(1)
          else if (step === 3) setStep(2)
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.background, paddingHorizontal: SPACING.xl, paddingTop: 16 }}>
        {step === 1 && (
          <CreateSessionStep1
            onBack={() => router.back()}
            courts={courts}
            loadingCourts={loadingCourts}
            fallbackMode={fallbackMode}
            keyword={keyword}
            setKeyword={setKeyword}
            searching={searching}
            selectedCourt={selectedCourt}
            selectedDate={selectedDate}
            startTime={startTime}
            endTime={endTime}
            showStartPicker={showStartPicker}
            showEndPicker={showEndPicker}
            timeError={timeError}
            onCourtSelect={onCourtSelect}
            onChangeCourt={() => {
              setSelectedCourt(null)
              setStartTime(null)
              setEndTime(null)
              setTimeError(null)
              setShowStartPicker(false)
              setShowEndPicker(false)
            }}
            onDateSelect={onDatePress}
            onStartTimeChange={(date) => {
              if (!selectedDate || !date) return
              setStartTime(withTime(selectedDate, date))
            }}
            onEndTimeChange={(date) => {
              if (!selectedDate || !date) return
              setEndTime(withTime(selectedDate, date))
            }}
            onToggleStartPicker={() => {
              setShowEndPicker(false)
              setShowStartPicker(value => !value)
            }}
            onToggleEndPicker={() => {
              setShowStartPicker(false)
              setShowEndPicker(value => !value)
            }}
            onCloseStartPicker={() => setShowStartPicker(false)}
            onCloseEndPicker={() => setShowEndPicker(false)}
            defaultPickerValue={defaultPickerValue}
            onContinue={goToStep2}
            lockCourtSchedule={lockCourtSchedule}
            hideHeader
          />
        )}

        {step === 2 && (
          <CreateSessionStep2
            selectedCourt={selectedCourt}
            onBack={() => setStep(1)}
            maxPlayers={maxPlayers}
            setMaxPlayers={setMaxPlayers}
            minSkill={minSkill}
            setMinSkill={setMinSkill}
            maxSkill={maxSkill}
            setMaxSkill={setMaxSkill}
            bookingStatus={bookingStatus}
            setBookingStatus={setBookingStatus}
            wantsBookingNow={wantsBookingNow}
            setWantsBookingNow={setWantsBookingNow}
            bookingReference={bookingReference}
            setBookingReference={setBookingReference}
            bookingName={bookingName}
            setBookingName={setBookingName}
            bookingPhone={bookingPhone}
            setBookingPhone={setBookingPhone}
            bookingNotes={bookingNotes}
            setBookingNotes={setBookingNotes}
            canOpenBookingLink={Boolean(selectedCourt?.booking_url ?? selectedCourt?.google_maps_url)}
            onOpenBookingLink={openCourtBookingLink}
            deadlineMinutes={deadlineMinutes}
            setDeadlineMinutes={setDeadlineMinutes}
            requireApproval={requireApproval}
            setRequireApproval={setRequireApproval}
            isRanked={isRanked}
            setIsRanked={setIsRanked}
            canToggleRanked={canToggleRanked}
            rankedHelperText={rankedHelperText}
            totalCostStr={totalCostStr}
            setTotalCostStr={setTotalCostStr}
            costPerPerson={costPerPerson}
            onContinue={goToStep3FromNew}
            skillTolerance={skillTolerance}
            setTolerance={setSkillTolerance}
            hideHeader
          />
        )}

        {step === 3 && selectedCourt && selectedDate && startTime && endTime && (
          <CreateSessionStep3
            selectedCourt={selectedCourt}
            selectedDate={selectedDate}
            startTime={startTime}
            endTime={endTime}
            maxPlayers={maxPlayers}
            minSkill={minSkill}
            maxSkill={maxSkill}
            skillTolerance={skillTolerance}
            bookingStatus={wantsBookingNow === true ? 'confirmed' : bookingStatus}
            deadlineMinutes={deadlineMinutes}
            requireApproval={requireApproval}
            pricePerPerson={costPerPerson}
            onBack={() => setStep(2)}
            onCreate={submit}
            submitting={submitting}
            submitLabel={isEditMode ? STRINGS.create_session.actions.save : STRINGS.create_session.actions.submit}
            hideHeader
          />
        )}
        <AppDialog
          visible={Boolean(dialogConfig)}
          config={dialogConfig}
          onClose={() => setDialogConfig(null)}
        />
      </View>
    </View>
  )
}
