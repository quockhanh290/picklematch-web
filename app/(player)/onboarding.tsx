import { router, useLocalSearchParams } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { CheckCircle2, Smartphone, User } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppButton } from '@/components/design/AppButton'
import { NavbarStepCounter, SecondaryNavbar } from '@/components/design/SecondaryNavbar'
import { WebContainer } from '@/components/design/WebContainer'
import { BORDER, RADIUS, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { SCREEN_FONTS } from '@/constants/typography'
import { getEloBandForElo } from '@/lib/eloSystem'
import {
  calculatePvnaResult,
  getNextQuestions,
  getPvnaQuestions,
  type PvnaResult
} from '@/lib/pvnaQuizEngine'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { withAlpha } from '@/lib/utils/ui'

function OTPDots({ value }: { value: string }) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      {Array.from({ length: 6 }).map((_, index) => {
        const digit = value[index]
        const active = !!digit
        const isCurrent = value.length === index

        return (
          <View
            key={index}
            style={{
              height: 64,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS.lg,
              backgroundColor: theme.surfaceAlt,
              borderWidth: 2,
              borderColor: isCurrent ? theme.primary : active ? withAlpha(theme.primary, 0.5) : theme.outlineVariant,
              ...SHADOW.xs
            }}
          >
            <Text
              style={{
                color: theme.onSurface,
                fontSize: 28,
                fontFamily: SCREEN_FONTS.headlineBlack,
              }}
            >
              {digit ?? ''}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export default function OnboardingScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams()
  const advanceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const otpInputRef = useRef<TextInput>(null)

  const initialName = typeof params.name === 'string' ? params.name : ''
  const initialPhone = typeof params.phone === 'string' ? params.phone : ''

  const [stepIndex, setStepIndex] = useState(0) // Start at Gender (0)
  const [personalInfo, setPersonalInfo] = useState({ name: initialName, phone: initialPhone, email: '' })
  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [partnerPref, setPartnerPref] = useState('any')
  const [opponentPref, setOpponentPref] = useState('any')
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const [submitting, setSubmitting] = useState(false)
  const [resultPreview, setResultPreview] = useState<PvnaResult | null>(null)
  const [_errorVisible, setErrorVisible] = useState(false)

  // Auth steps for new players
  const [authStep, setAuthStep] = useState<'none' | 'confirm' | 'phone' | 'otp'>('none')
  const [otp, setOtp] = useState('')
  const [authError, setAuthError] = useState('')
  const [showQuizIntro, setShowQuizIntro] = useState(false)

  const allQuestions = getPvnaQuestions()
  const questionSequence = useMemo(() => {
    if (!gender) return []
    return getNextQuestions({ answers, gender })
  }, [answers, gender])

  const currentQuestionId = stepIndex > 1 ? questionSequence[stepIndex - 2] : null
  const currentQuestion = allQuestions.find(q => q.id === currentQuestionId)

  const totalSteps = questionSequence.length + 2 // Gender + Preferences + Questions

  const isBasicInfo = stepIndex < 2
  const sectionTitle = isBasicInfo ? 'Thông tin cơ bản' : 'Đánh giá trình độ'
  const sectionCurrent = isBasicInfo ? stepIndex + 1 : stepIndex - 1
  const sectionTotal = isBasicInfo ? 2 : questionSequence.length
  const progress = isBasicInfo ? (stepIndex + 1) / 2 : (stepIndex - 1) / questionSequence.length

  const isLastQuestion = useMemo(() => {
    if (stepIndex <= 1) return false
    // We check if the next questions list after answering current one would be empty or finished
    // But for UI stability, we use the current sequence length
    return stepIndex === questionSequence.length + 1
  }, [stepIndex, questionSequence.length])

  const isAnswered = useMemo(() => {
    if (stepIndex === 0) return !!gender
    if (stepIndex === 1) return true
    if (currentQuestionId) return answers[currentQuestionId] !== undefined
    return false
  }, [stepIndex, gender, currentQuestionId, answers])

  useEffect(() => {
    async function loadAuthInfo() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Fetch existing profile data
        const { data: profile } = await supabase.from('players').select('*').eq('id', user.id).single()

        console.log('[Onboarding] Profile:', profile)
        console.log('[Onboarding] Auth Metadata:', user.user_metadata)

        if (profile?.gender) {
          const mappedGender = profile.gender === 'nam' ? 'male' : (profile.gender === 'nu' ? 'female' : profile.gender)
          console.log('[Onboarding] Setting gender from profile:', mappedGender)
          setGender(prev => prev || (mappedGender as any))
        } else if (user.user_metadata?.gender) {
          // Zalo/Social metadata often uses numbers or strings
          const metaGender = user.user_metadata.gender
          const mappedMeta = (metaGender === 1 || metaGender === '1' || metaGender === 'male') ? 'male' :
            (metaGender === 2 || metaGender === '2' || metaGender === 'female' || metaGender === 'nu') ? 'female' : null
          if (mappedMeta) {
            console.log('[Onboarding] Setting gender from metadata:', mappedMeta)
            setGender(prev => prev || mappedMeta)
          }
        }
        setPersonalInfo(p => ({
          ...p,
          email: user.email ?? profile?.email ?? '',
          phone: user.phone ?? profile?.phone ?? '',
          name: profile?.name ?? user.user_metadata?.full_name ?? ''
        }))
        if (profile?.partner_gender_pref) setPartnerPref(profile.partner_gender_pref)
        if (profile?.opponent_gender_pref) setOpponentPref(profile.opponent_gender_pref)
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

    setAnswers(prev => {
      const nextAnswers = { ...prev, [currentQuestionId]: value }

      // Calculate what the sequence WILL be after this answer
      const nextSequence = getNextQuestions({ answers: nextAnswers, gender: gender! })
      const willBeLast = stepIndex === nextSequence.length + 1

      if (advanceTimeout.current) clearTimeout(advanceTimeout.current)
      advanceTimeout.current = setTimeout(() => {
        if (willBeLast) {
          const result = calculatePvnaResult({ answers: nextAnswers, gender: gender! })
          setResultPreview(result)
        } else {
          setStepIndex(s => s + 1)
        }
      }, 400)

      return nextAnswers
    })
  }

  function handleBack() {
    if (submitting) return
    if (resultPreview) {
      setResultPreview(null)
      return
    }
    if (showQuizIntro) {
      setShowQuizIntro(false)
      setStepIndex(1)
      return
    }
    if (stepIndex === 0) {
      if (router.canGoBack()) router.back()
      else router.replace('/login')
      return
    }

    if (stepIndex === 2 && !showQuizIntro) {
      setShowQuizIntro(true)
      return
    }

    setStepIndex(prev => prev - 1)
  }

  function handleNext() {
    if (submitting || !isAnswered) return

    if (stepIndex === 1) {
      setShowQuizIntro(true)
      setStepIndex(2)
      return
    }

    if (isLastQuestion) {
      const result = calculatePvnaResult({ answers, gender: gender! })
      setResultPreview(result)
      return
    }

    setStepIndex(prev => prev + 1)
  }

  async function confirmOnboardingResult() {
    if (submitting || !resultPreview || !gender) return
    setAuthStep('confirm')
  }

  async function sendOTP() {
    setAuthError('')
    const phoneNum = personalInfo.phone.replace(/\D/g, '')
    if (!phoneNum || phoneNum.length < 9) {
      setAuthError('Số điện thoại không hợp lệ')
      return
    }

    // Duplicate check
    try {
      setSubmitting(true)
      const submitPhone = phoneNum.startsWith('84') ? `0${phoneNum.slice(2)}` : phoneNum

      // BYPASS FOR TESTING
      if (phoneNum === '0123456789') {
        setAuthStep('otp')
        setSubmitting(false)
        return
      }

      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('phone', submitPhone)
        .maybeSingle()

      if (existingPlayer) {
        setSubmitting(false)
        alert('Tài khoản đã tồn tại, chuyển sang màn đăng nhập.')
        router.replace('/login')
        return
      }

      const formattedPhone = phoneNum.startsWith('0') ? `+84${phoneNum.slice(1)}` :
        phoneNum.startsWith('84') ? `+${phoneNum}` : `+84${phoneNum}`


      const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone })
      if (error) throw error

      setAuthStep('otp')
    } catch (err: any) {
      setAuthError(err.message || 'Không thể gửi OTP')
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyOTPAndSave() {
    setAuthError('')
    if (!otp || otp.length < 6) {
      setAuthError('Nhập đủ 6 số OTP')
      return
    }

    try {
      setSubmitting(true)
      const phoneNum = personalInfo.phone.replace(/\D/g, '')
      const formattedPhone = phoneNum.startsWith('0') ? `+84${phoneNum.slice(1)}` :
        phoneNum.startsWith('84') ? `+${phoneNum}` : `+84${phoneNum}`

      // BYPASS FOR TESTING
      if (otp === '123456' && phoneNum === '0123456789') {
        alert('DEBUG: Bypassed OTP verification for testing.')
        router.replace('/profile')
        return
      }

      const { data, error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: 'sms'
      })

      if (error) throw error
      if (!data.user) throw new Error('Không xác thực được OTP')

      const elo = Math.round(parseFloat(resultPreview!.pvnaLevel) * 400)
      const band = getEloBandForElo(elo)
      const submitPhone = phoneNum.startsWith('84') ? `0${phoneNum.slice(2)}` : phoneNum

      const { error: dbError } = await supabase
        .from('players')
        .upsert({
          id: data.user.id,
          name: personalInfo.name.trim(),
          phone: submitPhone,
          gender: gender,
          pavn_level: resultPreview!.pvnaLevel,
          pavn_raw_score: resultPreview!.rawScore,
          elo: elo,
          current_elo: elo,
          onboarding_completed: true,
          skill_tier: band?.tier || 'beginner',
          skill_label: band?.legacySkillLabel || 'beginner',
          self_assessed_level: band?.levelId || 'pvna_1',
          is_provisional: true,
          auto_accept: true,
          partner_gender_pref: partnerPref,
          opponent_gender_pref: opponentPref,
        })

      if (dbError) throw dbError

      router.replace(Platform.OS === 'web' ? '/player-hub/profile' : '/profile')
    } catch (err: any) {
      setAuthError(err.message || 'Xác thực OTP thất bại')
    } finally {
      setSubmitting(false)
    }
  }

  function restartQuiz() {
    setResultPreview(null)
    setAnswers({})
    setStepIndex(0)
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      {!resultPreview && (
        <SecondaryNavbar
          onBackPress={handleBack}
          title={sectionTitle}
          rightSlot={authStep === 'none' && !showQuizIntro && (
            <NavbarStepCounter
              current={sectionCurrent}
              total={sectionTotal}
            />
          )}
        />
      )}
      <ScrollView
        bounces={false}
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 20),
          paddingTop: 32,
          paddingHorizontal: 20,
          flexGrow: 1
        }}
        showsVerticalScrollIndicator={false}
      >
        {showQuizIntro ? (
          <View style={{ flex: 1, paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{
              width: 100, height: 100, borderRadius: 50,
              backgroundColor: withAlpha(theme.primary, 0.1),
              alignItems: 'center', justifyContent: 'center', marginBottom: 32
            }}>
              <CheckCircle2 size={48} color={theme.primary} />
            </View>

            <Text style={{
              fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 32,
              color: theme.onSurface, textAlign: 'center', marginBottom: 16,
              textTransform: 'uppercase'
            }}>
              Thông tin cơ bản hoàn tất
            </Text>

            <Text style={{
              fontFamily: SCREEN_FONTS.body, fontSize: 16,
              color: theme.onSurfaceVariant, textAlign: 'center',
              lineHeight: 24, marginBottom: 40, maxWidth: 320
            }}>
              Bây giờ, chúng tôi sẽ đưa ra một số câu hỏi chuyên sâu về kỹ năng để xác định chính xác trình độ PVNA của bạn.
            </Text>

            <AppButton
              label="Bắt đầu đánh giá trình độ"
              onPress={() => setShowQuizIntro(false)}
              style={{ width: '100%' }}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ marginBottom: 32 }}>
              <View style={{
                backgroundColor: withAlpha(theme.primary, 0.1),
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: RADIUS.md,
                alignSelf: 'flex-start',
                marginBottom: 16
              }}>
                <Text style={{
                  color: theme.primary,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  fontFamily: SCREEN_FONTS.cta,
                  textTransform: 'uppercase'
                }}>
                  {isBasicInfo ? `BƯỚC ${stepIndex + 1} / 2` : `CÂU HỎI ${stepIndex - 1} / ${questionSequence.length}`}
                </Text>
              </View>

              <Text style={{
                color: theme.onSurface,
                fontSize: 32,
                lineHeight: 38,
                fontFamily: SCREEN_FONTS.headline,
                textTransform: 'uppercase'
              }}>
                {stepIndex === 0 ? STRINGS.pvna_quiz.gender_title :
                  stepIndex === 1 ? "SỞ THÍCH GHÉP CẶP" :
                    currentQuestion?.title}
              </Text>

              <Text style={{
                marginTop: 12,
                color: theme.onSurfaceVariant,
                fontSize: 16,
                lineHeight: 24,
                fontFamily: SCREEN_FONTS.body
              }}>
                {stepIndex === 0 ? STRINGS.pvna_quiz.gender_subtitle :
                  stepIndex === 1 ? "Bạn muốn ưu tiên ghép cặp hoặc đối đầu với ai?" :
                    currentQuestion?.description}
              </Text>
            </View>

            <View style={{ gap: 16 }}>
              {stepIndex === 0 ? (
                <View style={{ gap: 16 }}>
                  {[
                    { id: 'male', label: STRINGS.pvna_quiz.gender_nam, icon: '♂' },
                    { id: 'female', label: STRINGS.pvna_quiz.gender_nu, icon: '♀' },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      activeOpacity={0.8}
                      onPress={() => {
                        setGender(opt.id as any)
                        if (advanceTimeout.current) clearTimeout(advanceTimeout.current)
                        advanceTimeout.current = setTimeout(() => {
                          setStepIndex(1)
                        }, 250)
                      }}
                      style={{
                        height: 84,
                        borderRadius: RADIUS.xl,
                        paddingHorizontal: 24,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: gender === opt.id ? theme.primary : theme.surfaceAlt,
                        borderWidth: 1.5,
                        borderColor: gender === opt.id ? theme.primary : 'transparent',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Text style={{ fontSize: 24 }}>{opt.icon}</Text>
                        <Text style={{
                          color: gender === opt.id ? theme.onPrimary : theme.onSurface,
                          fontSize: 18,
                          fontFamily: SCREEN_FONTS.label
                        }}>
                          {opt.label}
                        </Text>
                      </View>
                      {gender === opt.id && <CheckCircle2 size={24} color={theme.onPrimary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : stepIndex === 1 ? (
                <View style={{ gap: 24 }}>
                  <View>
                    <Text style={{
                      color: theme.onSurface,
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 14,
                      marginBottom: 12
                    }}>Ưu tiên đồng đội (Partner)</Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      {[
                        { id: 'any', label: 'Tất cả' },
                        { id: 'male', label: 'Nam' },
                        { id: 'female', label: 'Nữ' }
                      ].map((opt) => (
                        <TouchableOpacity
                          key={opt.id}
                          onPress={() => setPartnerPref(opt.id)}
                          style={{
                            flex: 1, height: 48, borderRadius: RADIUS.md,
                            backgroundColor: partnerPref === opt.id ? theme.primary : theme.surfaceAlt,
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 1, borderColor: partnerPref === opt.id ? theme.primary : theme.outlineVariant
                          }}
                        >
                          <Text style={{
                            color: partnerPref === opt.id ? theme.onPrimary : theme.onSurface,
                            fontFamily: SCREEN_FONTS.label, fontSize: 13
                          }}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View>
                    <Text style={{
                      color: theme.onSurface,
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 14,
                      marginBottom: 12
                    }}>Ưu tiên đối thủ (Opponent)</Text>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      {[
                        { id: 'any', label: 'Tất cả' },
                        { id: 'male', label: 'Nam' },
                        { id: 'female', label: 'Nữ' }
                      ].map((opt) => (
                        <TouchableOpacity
                          key={opt.id}
                          onPress={() => setOpponentPref(opt.id)}
                          style={{
                            flex: 1, height: 48, borderRadius: RADIUS.md,
                            backgroundColor: opponentPref === opt.id ? theme.primary : theme.surfaceAlt,
                            alignItems: 'center', justifyContent: 'center',
                            borderWidth: 1, borderColor: opponentPref === opt.id ? theme.primary : theme.outlineVariant
                          }}
                        >
                          <Text style={{
                            color: opponentPref === opt.id ? theme.onPrimary : theme.onSurface,
                            fontFamily: SCREEN_FONTS.label, fontSize: 13
                          }}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
              ) : currentQuestion?.options.map((option) => {
                const isSelected = answers[currentQuestionId!] === option.value
                return (
                  <TouchableOpacity
                    key={option.label}
                    activeOpacity={0.8}
                    onPress={() => handleAnswerSelect(option.value)}
                    style={{
                      minHeight: 72,
                      borderRadius: RADIUS.xl,
                      paddingHorizontal: 24,
                      paddingVertical: 18,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: isSelected ? theme.primary : theme.surfaceAlt,
                      borderWidth: 1.5,
                      borderColor: isSelected ? theme.primary : 'transparent',
                    }}
                  >
                    <Text style={{
                      flex: 1,
                      color: isSelected ? theme.onPrimary : theme.onSurface,
                      fontSize: 16,
                      fontFamily: SCREEN_FONTS.label,
                      paddingRight: 16
                    }}>
                      {option.label}
                    </Text>
                    {isSelected && <CheckCircle2 size={22} color={theme.onPrimary} />}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={{
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: Math.max(insets.bottom, 24),
        backgroundColor: theme.background,
        borderTopWidth: 1,
        borderTopColor: theme.outlineVariant
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AppButton
              label={STRINGS.common.back}
              variant="secondary"
              onPress={handleBack}
              disabled={submitting}
            />
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

      {resultPreview && authStep === 'none' && (
        <View style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: theme.background,
          paddingTop: 0,
          paddingBottom: insets.bottom
        }}>
          <ScrollView
            bounces={false}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <WebContainer maxWidth={600}>
              <View style={{
                backgroundColor: theme.primary,
                paddingTop: insets.top + 40,
                paddingBottom: 90,
                paddingHorizontal: 24,
                borderBottomLeftRadius: RADIUS.hero,
                borderBottomRightRadius: RADIUS.hero,
                minHeight: 300
              }}>
                <View style={{ marginBottom: 24 }}>
                  <View style={{ width: 48, height: 6, backgroundColor: 'white', borderRadius: RADIUS.full, marginBottom: 20, opacity: 0.8 }} />
                  <Text style={{
                    fontFamily: SCREEN_FONTS.headlineItalic,
                    fontSize: 48,
                    color: 'white',
                    lineHeight: 52,
                    letterSpacing: -2
                  }}>
                    PICKLEMATCHVN
                  </Text>
                  <Text style={{
                    fontFamily: SCREEN_FONTS.headlineItalic,
                    fontSize: 32,
                    color: 'white',
                    lineHeight: 34,
                    letterSpacing: -1,
                    marginTop: -2,
                    opacity: 0.9
                  }}>
                    KẾT QUẢ ĐÁNH GIÁ
                  </Text>
                </View>

                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: RADIUS.sm,
                  alignSelf: 'flex-start',
                  marginBottom: 16
                }}>
                  <Text style={{
                    color: 'white',
                    fontFamily: SCREEN_FONTS.cta,
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: 'uppercase'
                  }}>
                    Chứng nhận trình độ
                  </Text>
                </View>

                <Text style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 15,
                  lineHeight: 22,
                  maxWidth: 300
                }}>
                  Chúc mừng! Bạn đã hoàn thành bài đánh giá trình độ PVNA.
                </Text>
              </View>

              <View style={{ paddingHorizontal: 24, marginTop: -40 }}>
                <View style={{
                  maxWidth: 480,
                  width: '100%',
                  alignSelf: 'center',
                  backgroundColor: 'white',
                  borderRadius: RADIUS.xl,
                  padding: 28,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant,
                  ...SHADOW.md
                }}>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{
                      height: 80,
                      width: 80,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 40,
                      backgroundColor: withAlpha(theme.primary, 0.1),
                      marginBottom: 24
                    }}>
                      <CheckCircle2 size={40} color={theme.primary} />
                    </View>

                    <Text style={{
                      color: theme.primary,
                      fontSize: 13,
                      letterSpacing: 2,
                      fontFamily: SCREEN_FONTS.cta,
                      textTransform: 'uppercase',
                      marginBottom: 8
                    }}>
                      {STRINGS.pvna_quiz.result_title}
                    </Text>

                    <Text style={{
                      color: theme.onSurface,
                      fontSize: 64,
                      textAlign: 'center',
                      fontFamily: SCREEN_FONTS.headlineBlack,
                      lineHeight: 70
                    }}>
                      PVNA {resultPreview.pvnaLevel}
                    </Text>

                    <View style={{
                      backgroundColor: theme.primary,
                      paddingHorizontal: 16,
                      paddingVertical: 6,
                      borderRadius: RADIUS.md,
                      marginTop: 12
                    }}>
                      <Text style={{
                        color: theme.onPrimary,
                        fontSize: 16,
                        fontFamily: SCREEN_FONTS.headline,
                        textTransform: 'uppercase'
                      }}>
                        {(STRINGS.pvna_quiz.level_names as any)[resultPreview.levelName] || resultPreview.levelName}
                      </Text>
                    </View>

                    <View style={{
                      marginTop: 32,
                      backgroundColor: theme.surfaceAlt,
                      borderRadius: RADIUS.hero,
                      padding: 24,
                      width: '100%',
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: theme.outlineVariant
                    }}>
                      <Text style={{
                        color: theme.onSurfaceVariant,
                        fontSize: 12,
                        letterSpacing: 1.5,
                        fontFamily: SCREEN_FONTS.cta,
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        marginBottom: 12
                      }}>
                        DUPR DỰ PHÓNG
                      </Text>
                      <Text style={{
                        color: theme.onSurface,
                        fontSize: 40,
                        textAlign: 'center',
                        fontFamily: SCREEN_FONTS.headlineBlack
                      }}>
                        {resultPreview.duprRange}
                      </Text>
                    </View>

                    <View style={{ marginTop: 32, width: '100%', gap: 16 }}>
                      <AppButton
                        label={STRINGS.pvna_quiz.confirm_level}
                        onPress={confirmOnboardingResult}
                        loading={submitting}
                      />
                      <AppButton
                        label={STRINGS.pvna_quiz.redo_quiz}
                        onPress={restartQuiz}
                        disabled={submitting}
                        style={{ backgroundColor: theme.error }}
                      />
                    </View>
                  </View>
                </View>
              </View>
            </WebContainer>
          </ScrollView>
        </View>
      )}

      {resultPreview && authStep !== 'none' && (
        <View style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: theme.background,
          paddingTop: 0,
          paddingBottom: insets.bottom
        }}>
          <ScrollView
            bounces={false}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <WebContainer maxWidth={600}>
              <View style={{
                backgroundColor: theme.primary,
                paddingTop: insets.top + 40,
                paddingBottom: 90,
                paddingHorizontal: 24,
                borderBottomLeftRadius: RADIUS.hero,
                borderBottomRightRadius: RADIUS.hero,
                minHeight: 300
              }}>
                <View style={{ marginBottom: 24 }}>
                  <View style={{ width: 48, height: 6, backgroundColor: 'white', borderRadius: RADIUS.full, marginBottom: 20, opacity: 0.8 }} />
                  <Text style={{
                    fontFamily: SCREEN_FONTS.headlineItalic,
                    fontSize: 48,
                    color: 'white',
                    lineHeight: 52,
                    letterSpacing: -2
                  }}>
                    PICKLEMATCHVN
                  </Text>
                  <Text style={{
                    fontFamily: SCREEN_FONTS.headlineItalic,
                    fontSize: 32,
                    color: 'white',
                    lineHeight: 34,
                    letterSpacing: -1,
                    marginTop: -2,
                    opacity: 0.9
                  }}>
                    TẠO HỒ SƠ NGƯỜI CHƠI
                  </Text>
                </View>

                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: RADIUS.sm,
                  alignSelf: 'flex-start',
                  marginBottom: 16
                }}>
                  <Text style={{
                    color: 'white',
                    fontFamily: SCREEN_FONTS.cta,
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: 'uppercase'
                  }}>
                    Xác thực tài khoản
                  </Text>
                </View>


                <Text style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 15,
                  lineHeight: 22,
                  maxWidth: 320
                }}>
                  Bạn có thể xem lại hồ sơ, trình độ PVNA và lịch sử thi đấu của mình sau khi hoàn tất đăng ký.
                </Text>
              </View>

              {/* Card nội dung */}
              <View style={{ paddingHorizontal: 24, marginTop: -40 }}>
                <View style={{
                  maxWidth: 480,
                  width: '100%',
                  alignSelf: 'center',
                  backgroundColor: 'white',
                  borderRadius: RADIUS.xl,
                  padding: 28,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant,
                  ...SHADOW.md
                }}>

                  {authStep === 'confirm' && (
                    <View style={{ gap: 20 }}>
                      <View style={{ alignItems: 'center', marginBottom: 8 }}>
                        <Text style={{
                          fontSize: 14,
                          fontFamily: SCREEN_FONTS.label,
                          color: theme.onSurfaceVariant,
                          textTransform: 'uppercase',
                          letterSpacing: 1
                        }}>
                          Trình độ PVNA của bạn
                        </Text>
                        <View style={{
                          backgroundColor: withAlpha(theme.primary, 0.08),
                          paddingHorizontal: 24,
                          paddingVertical: 12,
                          borderRadius: RADIUS.lg,
                          marginTop: 12,
                          borderWidth: 1,
                          borderColor: withAlpha(theme.primary, 0.2),
                          alignItems: 'center'
                        }}>
                          <Text style={{
                            fontSize: 40,
                            fontFamily: SCREEN_FONTS.headlineBlack,
                            color: theme.primary
                          }}>
                            PVNA {resultPreview.pvnaLevel}
                          </Text>
                        </View>
                        <Text style={{
                          fontSize: 15,
                          fontFamily: SCREEN_FONTS.body,
                          color: theme.onSurfaceVariant,
                          textAlign: 'center',
                          marginTop: 16,
                          lineHeight: 22
                        }}>
                          Xác nhận để hoàn tất tạo hồ sơ người chơi của bạn.
                        </Text>
                      </View>
                      <View style={{ gap: 12, marginTop: 8 }}>
                        <TouchableOpacity
                          onPress={() => setAuthStep('phone')}
                          style={{
                            height: 56, borderRadius: RADIUS.md, backgroundColor: theme.primary,
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Đồng ý, tạo hồ sơ
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setAuthStep('none')}
                          style={{
                            height: 56, borderRadius: RADIUS.md, backgroundColor: theme.error,
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Hủy
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {authStep === 'phone' && (
                    <View style={{ gap: 20 }}>
                      {/* Ô Họ và Tên - cùng style với ô SĐT */}
                      <View>
                        <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.label, color: theme.onSurfaceVariant, marginBottom: 8, textTransform: 'uppercase' }}>Họ và tên</Text>
                        <View style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.lg,
                          borderWidth: BORDER.base, borderColor: theme.outlineVariant,
                          height: 56, paddingHorizontal: 16,
                        }}>
                          <User size={20} color={theme.primary} />
                          <View style={{ width: 1, height: 24, backgroundColor: theme.outlineVariant, marginHorizontal: 12 }} />
                          <TextInput
                            value={personalInfo.name}
                            onChangeText={t => setPersonalInfo(p => ({ ...p, name: t }))}
                            placeholder="Nhập họ và tên"
                            placeholderTextColor={theme.outline}
                            style={{
                              flex: 1,
                              color: theme.onSurface, fontSize: 16,
                              fontFamily: SCREEN_FONTS.body,
                              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {})
                            }}
                          />
                        </View>
                      </View>

                      {/* Ô Số điện thoại */}
                      <View>
                        <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.label, color: theme.onSurfaceVariant, marginBottom: 8, textTransform: 'uppercase' }}>Số điện thoại</Text>
                        <View style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.lg,
                          borderWidth: BORDER.base, borderColor: theme.outlineVariant,
                          height: 56, paddingHorizontal: 16,
                        }}>
                          <Smartphone size={20} color={theme.primary} />
                          <Text style={{ marginLeft: 12, marginRight: 12, fontSize: 16, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>+84</Text>
                          <View style={{ width: 1, height: 24, backgroundColor: theme.outlineVariant }} />
                          <TextInput
                            value={personalInfo.phone}
                            onChangeText={t => setPersonalInfo(p => ({ ...p, phone: t }))}
                            placeholder="Nhập số điện thoại"
                            placeholderTextColor={theme.outline}
                            keyboardType="phone-pad"
                            maxLength={10}
                            style={{
                              flex: 1, marginLeft: 12,
                              color: theme.onSurface, fontSize: 16,
                              fontFamily: SCREEN_FONTS.body,
                              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {})
                            }}
                          />
                        </View>
                      </View>

                      {authError ? <Text style={{ color: theme.error, fontFamily: SCREEN_FONTS.body }}>{authError}</Text> : null}

                      <View style={{ gap: 12, marginTop: 8 }}>
                        <TouchableOpacity
                          onPress={sendOTP}
                          disabled={submitting || !personalInfo.name || !personalInfo.phone}
                          style={{
                            height: 56, borderRadius: RADIUS.md,
                            backgroundColor: (!personalInfo.name || !personalInfo.phone || submitting) ? theme.outlineVariant : theme.primary,
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            {submitting ? STRINGS.auth.processing : STRINGS.auth.submit_phone}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setAuthStep('confirm')}
                          disabled={submitting}
                          style={{
                            height: 56, borderRadius: RADIUS.md, borderWidth: BORDER.base,
                            borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: theme.onSurfaceVariant, fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Quay lại
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {authStep === 'otp' && (
                    <View style={{ gap: 20 }}>
                      <View style={{ marginBottom: 12 }}>
                        <Text style={{
                          color: theme.onSurface,
                          fontSize: 24,
                          fontFamily: SCREEN_FONTS.headline,
                          textTransform: 'uppercase'
                        }}>
                          Xác thực OTP
                        </Text>
                        <Text style={{
                          marginTop: 4,
                          color: theme.onSurfaceVariant,
                          fontSize: 14,
                          fontFamily: SCREEN_FONTS.body
                        }}>
                          Mã xác thực đã được gửi đến +84 {personalInfo.phone.replace(/^0/, '')}
                        </Text>
                      </View>

                      <Pressable onPress={() => otpInputRef.current?.focus()}>
                        <OTPDots value={otp} />
                      </Pressable>
                      <TextInput
                        ref={otpInputRef}
                        value={otp}
                        onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                        autoFocus
                        keyboardType="number-pad"
                        maxLength={6}
                        style={{ height: 1, opacity: 0 }}
                      />

                      <TouchableOpacity
                        onPress={sendOTP}
                        disabled={submitting}
                        style={{ alignSelf: 'center' }}
                      >
                        <Text style={{
                          color: theme.primary, fontFamily: SCREEN_FONTS.headline,
                          fontSize: 14, textDecorationLine: 'underline'
                        }}>
                          {STRINGS.auth.resend_otp}
                        </Text>
                      </TouchableOpacity>

                      {authError ? <Text style={{ color: theme.error, fontFamily: SCREEN_FONTS.body }}>{authError}</Text> : null}

                      <View style={{ gap: 12, marginTop: 8 }}>
                        <TouchableOpacity
                          onPress={verifyOTPAndSave}
                          disabled={submitting || otp.length < 6}
                          style={{
                            height: 56, borderRadius: RADIUS.md,
                            backgroundColor: (otp.length < 6 || submitting) ? theme.outlineVariant : theme.primary,
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            {submitting ? STRINGS.auth.processing : STRINGS.auth.submit_otp}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setAuthStep('phone')}
                          disabled={submitting}
                          style={{
                            height: 56, borderRadius: RADIUS.md, borderWidth: BORDER.base,
                            borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: theme.onSurfaceVariant, fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Đổi số điện thoại
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </WebContainer>
          </ScrollView>
        </View>
      )}
    </View>
  )
}
