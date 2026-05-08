import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { CheckCircle2, Swords, Timer } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getEloBandForElo } from '@/lib/eloSystem'
import { useAppTheme } from '@/lib/theme-context'
import { supabase } from '@/lib/supabase'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { AppButton } from '@/components/design/AppButton'
import { SecondaryNavbar } from '@/components/design/SecondaryNavbar'
import { AppInput } from '@/components/design/AppInput'
import { STRINGS } from '@/constants/strings'
import { withAlpha } from '@/lib/utils/ui'
import { 
  calculatePvnaResult, 
  getNextQuestions, 
  getPvnaQuestions, 
  type PvnaResult 
} from '@/lib/pvnaQuizEngine'

export default function OnboardingScreen() {
  const theme = useAppTheme()
  const ONBOARDING_THEME = {
    accent: theme.surfaceTint,
    accentDeep: theme.primary,
    panel: theme.surfaceContainerLowest,
    border: theme.outlineVariant,
    text: theme.onSurface,
    textMuted: theme.onSurfaceVariant,
    background: theme.background,
    white: theme.surface,
  }
  const insets = useSafeAreaInsets()
  const advanceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  const [stepIndex, setStepIndex] = useState(-1) // -1: Info, 0: Gender, 1+: Questions
  const [personalInfo, setPersonalInfo] = useState({ name: '', phone: '', email: '' })
  const [gender, setGender] = useState<'nam' | 'nu' | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  
  const [submitting, setSubmitting] = useState(false)
  const [resultPreview, setResultPreview] = useState<PvnaResult | null>(null)
  const [_errorVisible, setErrorVisible] = useState(false)

  const allQuestions = getPvnaQuestions()
  const questionSequence = useMemo(() => {
    if (!gender) return []
    return getNextQuestions({ answers, gender })
  }, [answers, gender])

  const currentQuestionId = stepIndex > 0 ? questionSequence[stepIndex - 1] : null
  const currentQuestion = allQuestions.find(q => q.id === currentQuestionId)
  
  const totalSteps = questionSequence.length + 2 // Info + Gender + Questions
  const progress = ((stepIndex + 2) / totalSteps) * 100

  const isLastQuestion = stepIndex > 0 && stepIndex === questionSequence.length
  const isAnswered = useMemo(() => {
    if (stepIndex === -1) return personalInfo.name && personalInfo.phone && personalInfo.email
    if (stepIndex === 0) return !!gender
    if (currentQuestionId) return answers[currentQuestionId] !== undefined
    return false
  }, [stepIndex, personalInfo, gender, currentQuestionId, answers])

  useEffect(() => {
    async function loadAuthInfo() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setPersonalInfo(p => ({
          ...p,
          email: user.email ?? '',
          phone: user.phone ?? '',
          name: user.user_metadata?.full_name ?? ''
        }))
      }
    }
    loadAuthInfo()

    return () => {
      isMountedRef.current = false
      if (advanceTimeout.current) clearTimeout(advanceTimeout.current)
    }
  }, [])

  function handleAnswerSelect(value: number) {
    if (submitting || !currentQuestionId) return

    setAnswers(prev => ({ ...prev, [currentQuestionId]: value }))
    
    if (!isLastQuestion) {
      if (advanceTimeout.current) clearTimeout(advanceTimeout.current)
      advanceTimeout.current = setTimeout(() => {
        setStepIndex(prev => prev + 1)
      }, 180)
    }
  }

  function handleBack() {
    if (submitting) return
    if (resultPreview) {
      setResultPreview(null)
      return
    }
    if (stepIndex === -1) {
      if (router.canGoBack()) router.back()
      else router.replace('/login')
      return
    }
    setStepIndex(prev => prev - 1)
  }

  function handleNext() {
    if (submitting || !isAnswered) return
    
    if (isLastQuestion) {
      const result = calculatePvnaResult({ answers, gender: gender! })
      setResultPreview(result)
      return
    }

    setStepIndex(prev => prev + 1)
  }

  async function confirmOnboardingResult() {
    if (submitting || !resultPreview || !gender) return

    setSubmitting(true)
    setErrorVisible(false)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(STRINGS.onboarding.errors.no_account)

      const elo = Math.round(parseFloat(resultPreview.pvnaLevel) * 400) // Rough ELO mapping
      const band = getEloBandForElo(elo)

      const { error } = await supabase
        .from('players')
        .update({
          name: personalInfo.name,
          phone: personalInfo.phone,
          email: personalInfo.email,
          gender: gender,
          pavn_level: resultPreview.pvnaLevel,
          pavn_raw_score: resultPreview.rawScore,
          elo: elo,
          current_elo: elo,
          onboarding_completed: true,
          skill_tier: band?.tier || 'beginner',
          skill_label: band?.legacySkillLabel || 'beginner',
          self_assessed_level: band?.levelId || 'pvna_1',
          is_provisional: true,
          auto_accept: true,
        })
        .eq('id', user.id)

      if (error) throw error

      router.replace('/(tabs)')
    } catch (error) {
      console.warn('[Onboarding] submit failed:', error)
      setErrorVisible(true)
      setSubmitting(false)
    }
  }

  function restartQuiz() {
    setResultPreview(null)
    setAnswers({})
    setStepIndex(0)
  }

  return (
    <View style={{ flex: 1, backgroundColor: ONBOARDING_THEME.background }}>
      <StatusBar style="dark" translucent backgroundColor="#F2F0E8" />
      <SecondaryNavbar
        title={STRINGS.onboarding.title}
        showProgress
        progress={progress / 100}
        onBackPress={handleBack}
      />
      <ScrollView
        bounces={false}
        contentContainerStyle={{ 
          paddingBottom: Math.max(insets.bottom, 20), 
          paddingTop: 32,
          paddingHorizontal: SPACING.xl,
          flexGrow: 1
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flex: 1 }}>
          <View className="mb-8 flex-row items-center justify-between">
            <View className="px-4 py-2" style={{ backgroundColor: ONBOARDING_THEME.accent, borderRadius: RADIUS.md }}>
              <Text style={{ color: ONBOARDING_THEME.accentDeep, fontSize: 12, letterSpacing: 0.8, fontFamily: SCREEN_FONTS.cta }}>
                  {STRINGS.pvna_quiz.step_label} {Math.max(0, stepIndex + 1)} / {totalSteps}
              </Text>
            </View>
            <View className="flex-row items-center px-3 py-2" style={{ backgroundColor: ONBOARDING_THEME.panel, borderRadius: RADIUS.md }}>
              <Swords size={14} color={ONBOARDING_THEME.accentDeep} />
              <Text style={{ marginLeft: 6, color: ONBOARDING_THEME.textMuted, fontSize: 12, fontFamily: SCREEN_FONTS.cta }}>
                PVNA
              </Text>
            </View>
          </View>

          <Text style={{ color: ONBOARDING_THEME.text, fontSize: 32, lineHeight: 38, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}>
            {stepIndex === -1 ? STRINGS.onboarding.personal_info_title : 
             stepIndex === 0 ? STRINGS.pvna_quiz.gender_title : 
             currentQuestion?.title}
          </Text>

          <Text style={{ marginTop: 12, color: ONBOARDING_THEME.textMuted, fontSize: 16, lineHeight: 24, fontFamily: SCREEN_FONTS.body }}>
            {stepIndex === -1 ? STRINGS.onboarding.personal_info_sub : 
             stepIndex === 0 ? STRINGS.pvna_quiz.gender_subtitle : 
             currentQuestion?.description}
          </Text>

          <View style={{ marginTop: 40, gap: 14 }}>
            {stepIndex === -1 ? (
              <View style={{ gap: 24 }}>
                <AppInput 
                  label={STRINGS.onboarding.field_name}
                  placeholder={STRINGS.onboarding.placeholders.name}
                  value={personalInfo.name}
                  onChangeText={(t) => setPersonalInfo(p => ({ ...p, name: t }))}
                />
                <AppInput 
                  label={STRINGS.onboarding.field_phone}
                  placeholder={STRINGS.onboarding.placeholders.phone}
                  keyboardType="phone-pad"
                  value={personalInfo.phone}
                  onChangeText={(t) => setPersonalInfo(p => ({ ...p, phone: t }))}
                />
                <AppInput 
                  label={STRINGS.onboarding.field_email}
                  placeholder={STRINGS.onboarding.placeholders.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={personalInfo.email}
                  onChangeText={(t) => setPersonalInfo(p => ({ ...p, email: t }))}
                />
              </View>
            ) : stepIndex === 0 ? (
              <View style={{ gap: 14 }}>
                {[
                  { id: 'nam', label: STRINGS.pvna_quiz.gender_nam },
                  { id: 'nu', label: STRINGS.pvna_quiz.gender_nu },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setGender(opt.id as any)}
                    style={{
                      height: 72, borderRadius: RADIUS.xl, paddingHorizontal: 20,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      backgroundColor: gender === opt.id ? ONBOARDING_THEME.accentDeep : ONBOARDING_THEME.panel,
                      borderWidth: 1, borderColor: gender === opt.id ? ONBOARDING_THEME.accentDeep : ONBOARDING_THEME.border,
                    }}
                  >
                    <Text style={{ color: gender === opt.id ? ONBOARDING_THEME.white : ONBOARDING_THEME.text, fontSize: 16, fontFamily: SCREEN_FONTS.label }}>
                      {opt.label}
                    </Text>
                    {gender === opt.id && <CheckCircle2 size={20} color={ONBOARDING_THEME.white} />}
                  </TouchableOpacity>
                ))}
              </View>
            ) : currentQuestion?.options.map((option) => {
              const isSelected = answers[currentQuestionId!] === option.value
              return (
                <TouchableOpacity
                  key={option.label}
                  activeOpacity={0.92}
                  onPress={() => handleAnswerSelect(option.value)}
                  style={{
                    minHeight: 64, borderRadius: RADIUS.xl, paddingHorizontal: 20, paddingVertical: 14,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: isSelected ? ONBOARDING_THEME.accentDeep : ONBOARDING_THEME.panel,
                    borderWidth: 1, borderColor: isSelected ? ONBOARDING_THEME.accentDeep : ONBOARDING_THEME.border,
                  }}
                >
                  <Text style={{ flex: 1, color: isSelected ? ONBOARDING_THEME.white : ONBOARDING_THEME.text, fontSize: 15, fontFamily: SCREEN_FONTS.label, paddingRight: 12 }}>
                    {option.label}
                  </Text>
                  {isSelected && <CheckCircle2 size={18} color={ONBOARDING_THEME.white} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: SPACING.xl, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 24), backgroundColor: ONBOARDING_THEME.background, borderTopWidth: 1, borderTopColor: ONBOARDING_THEME.border }}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AppButton label={STRINGS.common.back} variant="secondary" onPress={handleBack} disabled={submitting || stepIndex === -1} />
          </View>
          <View style={{ flex: 2 }}>
            <AppButton 
              label={isLastQuestion ? STRINGS.pvna_quiz.view_result : STRINGS.onboarding.next} 
              onPress={handleNext} 
              disabled={!isAnswered || submitting} 
            />
          </View>
        </View>
      </View>

      {resultPreview && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(25,28,30,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ width: '100%', borderRadius: RADIUS.hero, backgroundColor: ONBOARDING_THEME.white, padding: 24, alignItems: 'center' }}>
            <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: ONBOARDING_THEME.accent }}>
              <CheckCircle2 size={32} color={ONBOARDING_THEME.accentDeep} />
            </View>
            <Text style={{ marginTop: 16, color: ONBOARDING_THEME.accentDeep, fontSize: 12, letterSpacing: 1, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}>
              {STRINGS.pvna_quiz.result_title}
            </Text>
            <Text style={{ marginTop: 10, color: ONBOARDING_THEME.text, fontSize: 32, textAlign: 'center', fontFamily: SCREEN_FONTS.headline }}>
              PVNA {resultPreview.pvnaLevel}
            </Text>
            <Text style={{ marginTop: 4, color: ONBOARDING_THEME.textMuted, fontSize: 18, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}>
              {(STRINGS.pvna_quiz.level_names as any)[resultPreview.levelName] || resultPreview.levelName}
            </Text>
            
            <View className="mt-6 rounded-2xl px-4 py-4" style={{ backgroundColor: ONBOARDING_THEME.panel, borderWidth: BORDER.base, borderColor: ONBOARDING_THEME.border, width: '100%' }}>
              <Text style={{ color: ONBOARDING_THEME.textMuted, fontSize: 11, letterSpacing: 1, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase', textAlign: 'center' }}>
                DUPR DỰ PHÓNG
              </Text>
              <Text style={{ marginTop: 4, color: ONBOARDING_THEME.text, fontSize: 24, textAlign: 'center', fontFamily: SCREEN_FONTS.headline }}>
                {resultPreview.duprRange}
              </Text>
            </View>

            <View className="mt-4 rounded-2xl p-4" style={{ backgroundColor: withAlpha(theme.primary, 0.05), borderWidth: 1, borderColor: withAlpha(theme.primary, 0.1), width: '100%' }}>
              <View className="flex-row items-center mb-2">
                <Timer size={14} color={theme.primary} />
                <Text style={{ marginLeft: 6, color: theme.primary, fontSize: 11, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}>
                  CHÚ Ý
                </Text>
              </View>
              <Text style={{ color: ONBOARDING_THEME.textMuted, fontSize: 12, lineHeight: 18, fontFamily: SCREEN_FONTS.body }}>
                {STRINGS.pvna_quiz.placement_note}
              </Text>
            </View>

            <View className="mt-8 w-full flex-row items-center" style={{ gap: 12 }}>
              <View style={{ flex: 1 }}>
                <AppButton label={STRINGS.pvna_quiz.redo_quiz} variant="secondary" onPress={restartQuiz} disabled={submitting} />
              </View>
              <View style={{ flex: 1.2 }}>
                <AppButton label={STRINGS.pvna_quiz.confirm_level} onPress={confirmOnboardingResult} loading={submitting} />
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
