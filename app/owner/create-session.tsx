import { useAppTheme } from '@/lib/theme-context'
import { ScreenHeader, AppDialog, SecondaryNavbar, NavbarStepCounter } from '@/components/design'
import { OwnerCreateSessionStep1 } from '@/components/create-session/OwnerCreateSessionStep1'
import { OwnerCreateSessionStep2 } from '@/components/create-session/OwnerCreateSessionStep2'
import { OwnerCreateSessionStep3 } from '@/components/create-session/OwnerCreateSessionStep3'
import { useOwnerCreateSessionController } from '@/features/owner/create-session/hooks/useOwnerCreateSessionController'
import { useState, useEffect } from 'react'
import { View, ScrollView, Text, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'

export default function OwnerCreateSessionScreen() {
  const theme = useAppTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { userId, isLoading: authLoading } = useAuth()
  
  const params = useLocalSearchParams<{ editSessionId?: string }>()
  const editSessionId = params.editSessionId || null
  const isEditMode = Boolean(editSessionId)

  const controller = useOwnerCreateSessionController(editSessionId)
  
  const {
    step, setStep,
    selectedCourt, setSelectedCourt,
    selectedDate,
    startTime, endTime,
    setStartTime, setEndTime,
    showStartPicker, setShowStartPicker,
    showEndPicker, setShowEndPicker,
    timeError,
    format, setFormat,
    playMode, setPlayMode,
    maxPlayers, setMaxPlayers,
    minSkill, setMinSkill,
    maxSkill, setMaxSkill,
    skillTolerance, setSkillTolerance,
    isNewbie, setIsNewbie,
    selectedSubCourts, setSelectedSubCourts,
    requireResults, setRequireResults,
    requireApproval, setRequireApproval,
    hostIsPlaying, setHostIsPlaying,
    hostGender, setHostGender,
    hostSkill, setHostSkill,
    costPerPersonStr, setCostPerPersonStr,
    deadlineMinutes, setDeadlineMinutes,
    bookingStatus,
    submitting, isHydrating,
    dialogConfig, setDialogConfig,
    onDatePress, goToStep2, goToStep3, submit,
    defaultPickerValue,
    costPerPerson
  } = controller

  const [ownerCourt, setOwnerCourt] = useState<any>(null)
  const [fetchingCourt, setFetchingCourt] = useState(true)

  useEffect(() => {
    if (authLoading) return
    fetchOwnerCourt()
  }, [authLoading, userId])

  async function fetchOwnerCourt() {
    try {
      if (!userId) return
      const { data, error } = await supabase.from('courts').select('*').eq('owner_id', userId).single()
      if (!error && data) {
        setOwnerCourt(data)
        if (!isEditMode && !selectedCourt) {
          setSelectedCourt(data)
        }
      }
    } catch (err) {
      console.error('Fetch owner court error:', err)
    } finally {
      setFetchingCourt(false)
    }
  }

  if (isHydrating || fetchingCourt) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: theme.onSurfaceVariant }}>Đang tải dữ liệu...</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <SecondaryNavbar 
        title={isEditMode ? "SỬA KÈO CHỦ SÂN" : "TẠO KÈO CHỦ SÂN"} 
        onBackPress={() => {
          if (step === 3) setStep(2)
          else if (step === 2) setStep(1)
          else router.back()
        }}
        showProgress={true}
        progress={step / 3}
        rightSlot={<NavbarStepCounter current={step} total={3} />}
      />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10 }}>
          {step === 1 && (
            <OwnerCreateSessionStep1
              onBack={() => router.back()}
              selectedCourt={selectedCourt}
              selectedDate={selectedDate}
              startTime={startTime}
              endTime={endTime}
              onDateSelect={onDatePress}
              onStartTimeChange={setStartTime}
              onEndTimeChange={setEndTime}
              onContinue={goToStep2}
              showStartPicker={showStartPicker}
              showEndPicker={showEndPicker}
              onToggleStartPicker={() => setShowStartPicker(!showStartPicker)}
              onToggleEndPicker={() => setShowEndPicker(!showEndPicker)}
              onCloseStartPicker={() => setShowStartPicker(false)}
              onCloseEndPicker={() => setShowEndPicker(false)}
              defaultPickerValue={defaultPickerValue}
              timeError={timeError}
              format={format}
              setFormat={setFormat}
            />
          )}

          {step === 2 && (
            <OwnerCreateSessionStep2
              onBack={() => setStep(1)}
              maxPlayers={maxPlayers}
              setMaxPlayers={setMaxPlayers}
              minSkill={minSkill}
              setMinSkill={setMinSkill}
              maxSkill={maxSkill}
              setMaxSkill={setMaxSkill}
              requireApproval={requireApproval}
              setRequireApproval={setRequireApproval}
              requireResults={requireResults}
              setRequireResults={setRequireResults}
              costPerPersonStr={costPerPersonStr}
              setCostPerPersonStr={setCostPerPersonStr}
              onContinue={goToStep3}
              skillTolerance={skillTolerance}
              setTolerance={setSkillTolerance}
              subCourtCount={ownerCourt?.sub_court_count || 1}
              selectedSubCourts={selectedSubCourts}
              onSubCourtsChange={setSelectedSubCourts}
              isNewbie={isNewbie}
              setIsNewbie={setIsNewbie}
              hostIsPlaying={hostIsPlaying}
              setHostIsPlaying={setHostIsPlaying}
              hostGender={hostGender}
              setHostGender={setHostGender}
              hostSkill={hostSkill}
              setHostSkill={setHostSkill}
              playMode={playMode}
              setPlayMode={setPlayMode}
            />
          )}

          {step === 3 && (
            <OwnerCreateSessionStep3
              selectedCourt={selectedCourt!}
              selectedDate={selectedDate!}
              startTime={startTime!}
              endTime={endTime!}
              maxPlayers={maxPlayers}
              minSkill={minSkill}
              maxSkill={maxSkill}
              bookingStatus={bookingStatus}
              deadlineMinutes={deadlineMinutes}
              requireApproval={requireApproval}
              requireResults={requireResults}
              pricePerPerson={costPerPerson}
              hostIsPlaying={hostIsPlaying}
              hostGender={hostGender}
              hostSkill={hostSkill}
              onBack={() => setStep(2)}
              onCreate={submit}
              submitting={submitting}
              skillTolerance={skillTolerance}
              format={format}
              selectedSubCourts={selectedSubCourts}
              isEditMode={isEditMode}
              isNewbie={isNewbie}
              playMode={playMode}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}
