import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Pressable
} from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { Users, ChevronDown, ChevronUp } from 'lucide-react-native'
import Slider from '@react-native-community/slider'
import { useLocalSearchParams, router } from 'expo-router'
import { safeStorageSetItem, safeStorageGetItem, safeStorageRemoveItem } from '@/lib/storage'

import { AppButton, AppLoading, SecondaryNavbar, BrandedFooter } from '@/components/design'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { useAuth } from '@/lib/useAuth'
import { formatTimeRange } from '@/lib/sessionDetail'
import { getEloBandForSessionRange } from '@/lib/eloSystem'
import { getSessionSkillLabel, pvnaToElo } from '@/lib/skillAssessment'
import { getStatusLabel, type MatchSession } from '@/lib/homeFeed'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { supabase } from '@/lib/supabase'
import { RegistrationSuccessView } from '@/components/register/RegistrationSuccessView'
import { STRINGS } from '@/constants/strings'

const REGISTER_INFO_STORAGE_PREFIX = 'zalo_player_info:'
const REGISTER_INFO_TTL_MS = 24 * 60 * 60 * 1000

function getRegisterInfoStorageKey() {
  return `${REGISTER_INFO_STORAGE_PREFIX}v2`
}

type StoredRegisterInfo = {
  name?: string
  phone?: string
  gender?: 'male' | 'female'
  pvna?: string
  elo?: number
  savedAt?: number
}


const normalizePhoneInput = (value: string) => value.replace(/\D/g, '').slice(0, 11)

const normalizePhoneForSubmit = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('84')) return `0${digits.slice(2)}`
  return digits
}

const validateName = (value: string) => {
  const cleaned = value.trim().replace(/\s+/g, ' ')
  if (!cleaned) return STRINGS.common.validation.name_required
  if (cleaned.length < 2) return STRINGS.common.validation.name_min_length
  if (!/^[\p{L}\s'.-]+$/u.test(cleaned)) return STRINGS.common.validation.name_invalid
  return null
}

const validatePhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (!digits) return STRINGS.common.validation.phone_required
  if (digits.startsWith('0') && digits.length === 10) return null
  if (digits.startsWith('84') && digits.length === 11) return null
  return STRINGS.common.validation.phone_invalid
}

export default function ZaloRegisterScreen() {
  const { id, drop_in } = useLocalSearchParams<{ id: string; drop_in?: string }>()
  const isDropIn = drop_in === 'true'
  const { userId } = useAuth()
  const theme = useAppTheme()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState<'male' | 'female'>('male')
  const [pvna, setPvna] = useState('2.5')
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [success, setSuccess] = useState(false)
  const [isNewbie, setIsNewbie] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [showPlayerList, setShowPlayerList] = useState(false)
  const [partnerPref, setPartnerPref] = useState<'any' | 'male' | 'female'>('any')
  const [opponentPref, setOpponentPref] = useState<'any' | 'male' | 'female'>('any')

  useEffect(() => {
    if (!id) return
    const loadSavedData = async () => {
      try {
        // Load sticky preferences using safeStorage
        const savedPartnerPref = await safeStorageGetItem('pm_partner_pref')
        const savedOpponentPref = await safeStorageGetItem('pm_opponent_pref')
        if (savedPartnerPref) setPartnerPref(savedPartnerPref as any)
        if (savedOpponentPref) setOpponentPref(savedOpponentPref as any)

        const storageKey = getRegisterInfoStorageKey()
        const savedData = await safeStorageGetItem(storageKey)
        if (!savedData) return
        const parsed = JSON.parse(savedData) as StoredRegisterInfo
        const savedAt = parsed?.savedAt ?? 0
        if (!savedAt || Date.now() - savedAt > REGISTER_INFO_TTL_MS) {
          await safeStorageRemoveItem(storageKey)
          return
        }
        if (parsed?.name) setName(parsed.name)
        if (parsed?.phone) setPhone(parsed.phone)
        if (parsed?.gender) setGender(parsed.gender)
        if (parsed?.pvna) setPvna(parsed.pvna)
        else if (parsed?.elo) setPvna('2.5')
      } catch (e) {
        console.warn('Failed to load saved data', e)
      }
    }
    void loadSavedData()
  }, [id])

  const { loading, session, error, fetchSession } = useSessionDetail(id, userId)

  const sessionSkillLabel = useMemo(
    () => (session ? getSessionSkillLabel(session.elo_min, session.elo_max) : ''),
    [session]
  )

  const isEnded = useMemo(() => {
    if (!session) return false
    const now = new Date()
    const endTime = new Date(session.slot?.end_time ?? 0)
    return ['done', 'cancelled', 'pending_completion'].includes(session.status) || now > endTime
  }, [session])

  const nameError = useMemo(() => validateName(name), [name])
  const phoneError = useMemo(() => validatePhone(phone), [phone])
  const _canSubmit = !nameError && !phoneError && !submitting && !isEnded

  const pvnaRange = useMemo(() => {
    if (gender === 'female') {
      return { min: 2.1, max: 5.0, step: 0.1 }
    }
    return { min: 2.0, max: 5.5, step: 0.1 }
  }, [gender])

  const pvnaValue = useMemo(() => {
    const parsed = parseFloat(pvna)
    if (Number.isNaN(parsed)) return pvnaRange.min
    return Math.max(pvnaRange.min, Math.min(pvnaRange.max, Math.round(parsed * 10) / 10))
  }, [pvna, pvnaRange.min, pvnaRange.max])

  useEffect(() => {
    if (!isNewbie) {
      setPvna(pvnaValue.toFixed(1))
    }
  }, [pvnaValue, isNewbie])

  const toggleNewbie = () => {
    const next = !isNewbie
    setIsNewbie(next)
    if (next) {
      setPvna(pvnaRange.min.toFixed(1))
    }
  }

  // Removed previewMatch as FeaturedSessionCard now parses the raw session directly

  const [regStatus, setRegStatus] = useState<string | null>(null)

  const handleGoToAssessment = () => {
    if (nameError || phoneError) {
      setNameTouched(true)
      setPhoneTouched(true)
      setErrorMsg(nameError || phoneError || STRINGS.common.validation.generic_error)
      return
    }

    router.push({
      pathname: '/onboarding',
      params: { phone: normalizePhoneForSubmit(phone), name: name.trim() }
    } as any)
  }

  const handleRegister = async () => {
    setErrorMsg('')
    if (!id) {
      setErrorMsg('Không tìm thấy mã kèo thi đấu.')
      return
    }

    if (nameError || phoneError) {
      setNameTouched(true)
      setPhoneTouched(true)
      setErrorMsg(nameError || phoneError || STRINGS.common.validation.generic_error)
      return
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      setErrorMsg(`Mã kèo không hợp lệ: ${id}`)
      return
    }

    setSubmitting(true)
    setStatusMsg(STRINGS.register.loading_data)

    try {
      const cleanedName = name.trim().replace(/\s+/g, ' ')
      const submitPhone = normalizePhoneForSubmit(phone)
      const elo = Math.round(pvnaToElo(pvnaValue))

      console.log('[ZaloRegister] RPC Start:', { id, cleanedName, submitPhone, gender, elo })
      setStatusMsg(STRINGS.register.db_connecting)
      
      const rpcPromise = supabase.rpc('register_and_join_session', {
        p_session_id: id,
        p_name: cleanedName,
        p_phone: submitPhone,
        p_gender: gender,
        p_elo: elo,
        p_pvna: pvnaValue,
        p_metadata: {
          partner_gender_pref: partnerPref,
          opponent_gender_pref: opponentPref
        }
      })

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(STRINGS.register.db_timeout)), 15000)
      )

      const { data, error: joinError } = await Promise.race([rpcPromise, timeoutPromise]) as any

      if (joinError) {
        console.error('[ZaloRegister] DB Error:', joinError)
        setErrorMsg(`Lỗi kết nối: ${joinError.message || 'Không xác định'}`)
        setSubmitting(false)
        return
      }

      if (data?.error) {
        setErrorMsg(data.error)
        setSubmitting(false)
        return
      }

      if (isDropIn && data?.player_id && id) {
        try {
          const { data: authData } = await supabase.auth.getSession()
          const accessToken = authData.session?.access_token
          if (accessToken) {
            await fetch(
              `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/session-checkin?session_id=${id}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ player_id: data.player_id }),
              },
            )
          }
        } catch (e) {
          console.warn('[ZaloRegister] Drop-in checkin failed', e)
        }
      }

      setRegStatus(data?.status || 'confirmed')
      setStatusMsg(STRINGS.register.saving_info)
      
      if (id) {
        try {
          await safeStorageSetItem(
            getRegisterInfoStorageKey(),
            JSON.stringify({
              name: cleanedName,
              phone: submitPhone,
              gender,
              pvna: pvnaValue.toFixed(1),
              savedAt: Date.now(),
            } satisfies StoredRegisterInfo)
          )
        } catch (e) {
          console.warn('[ZaloRegister] Failed to save register info', e)
        }
        
        // Save sticky preferences for next time using safeStorage
        try {
          await safeStorageSetItem('pm_partner_pref', partnerPref)
          await safeStorageSetItem('pm_opponent_pref', opponentPref)
        } catch (e) {
          console.warn('[ZaloRegister] Failed to save preferences', e)
        }
      }

      setStatusMsg(STRINGS.register.success)
      if (isDropIn) {
        router.back()
        return
      }
      setSuccess(true)
      void fetchSession()
    } catch (err: any) {
      console.error('[ZaloRegister] Final Catch:', err)
      setErrorMsg(err.message || 'Đã có lỗi xảy ra, vui lòng thử lại.')
    } finally {
      setSubmitting(false)
      setTimeout(() => setStatusMsg(''), 3000)
    }
  }

  if (loading) return <AppLoading fullScreen />

  if (error || !session) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}
      >
        <Text
          style={{
            color: theme.onSurfaceVariant,
            fontFamily: SCREEN_FONTS.body,
            textAlign: 'center',
          }}
        >
          {error || 'Không tìm thấy thông tin kèo này.'}
        </Text>
        <AppButton label="Quay lại" onPress={() => router.replace('/')} style={{ marginTop: 24 }} />
      </View>
    )
  }

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <SecondaryNavbar title={STRINGS.register.success_title} hideBackButton={true} />
        <RegistrationSuccessView 
          session={session} 
          onBackHome={() => router.replace('/')} 
          status={regStatus}
        />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <SecondaryNavbar title={STRINGS.register.title} hideBackButton={true} />

      <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 100 }}>
        {/* Player Roster & Card */}
        {(() => {
          const rawPlayers = session?.session_players || []
          const hostId = session?.host?.id
          const isHostInPlayers = rawPlayers.some((p: any) => (p.player_id === hostId || p.id === hostId))
          const displayPlayers = [...rawPlayers]
          if (session?.host && !isHostInPlayers) {
            displayPlayers.unshift({
              id: session.host.id,
              player_id: session.host.id,
              name: session.host.name || 'Chủ kèo',
              gender: (session.host as any).gender,
              pvna: (session.host as any).pvna,
              elo: session.host.elo,
              status: 'confirmed',
              is_host: true
            } as any)
          }

          const playerListContent = displayPlayers.length === 0 ? null : (
            <Animated.View 
              entering={FadeInUp.duration(300)}
              style={{ paddingBottom: 8, paddingTop: 4 }}
            >
              {displayPlayers.map((playerItem, idx) => {
                const avatarColors = ['#E1F5EE', '#FAECE7', '#E5E7EB']
                const avatarTexts = ['#0F6E56', '#993C1D', '#374151']
                
                const p = (playerItem as any).player || playerItem
                const pName = p.name || 'Người chơi'
                
                let pInitials = p.initials
                if (!pInitials && p.name) {
                  const names = p.name.trim().split(' ').filter(Boolean)
                  if (names.length > 1) {
                    pInitials = (names[0][0] + names[names.length - 1][0]).toUpperCase()
                  } else if (names.length === 1) {
                    pInitials = names[0].substring(0, 2).toUpperCase()
                  }
                }
                if (!pInitials) pInitials = '??'

                const pGender = (p as any).gender === 'male' || (p as any).gender === 'Nam' ? 'Nam' : (p as any).gender === 'female' || (p as any).gender === 'Nữ' ? 'Nữ' : ''
                let pSkill = (p as any).pvna ? `Trình ${Number((p as any).pvna).toFixed(2)}` : ((p as any).skill_label || (p as any).self_assessed_level || '')
                if (!pSkill && ((p as any).current_elo || (p as any).elo)) {
                  pSkill = `Elo ${(p as any).current_elo || (p as any).elo}`
                }

                return (
                  <View key={p.id || idx} style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    gap: 10,
                    paddingVertical: 8,
                    marginHorizontal: 16,
                    borderBottomWidth: idx === displayPlayers.length - 1 ? 0 : 0.5,
                    borderBottomColor: theme.outlineVariant + '80',
                    opacity: 0.9
                  }}>
                    <View style={{ 
                      width: 32, height: 32, borderRadius: 16, 
                      backgroundColor: avatarColors[idx % 3], 
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: theme.surfaceVariant
                    }}>
                      <Text style={{ color: avatarTexts[idx % 3], fontSize: 11, fontFamily: SCREEN_FONTS.bold }}>
                        {pInitials}
                      </Text>
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 17 }}>{pName}</Text>
                      {p.is_host && (
                        <View style={{ backgroundColor: theme.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ color: theme.primary, fontSize: 9, fontFamily: SCREEN_FONTS.headline }}>CHỦ KÈO</Text>
                        </View>
                      )}
                    </View>
                    
                    {(pGender || pSkill) ? (
                      <View style={{ 
                        backgroundColor: pGender === 'Nam' ? theme.successContainer : (pGender === 'Nữ' ? '#FDF2F0' : '#E5E7EB'), 
                        paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm,
                        borderWidth: 1, borderColor: pGender === 'Nam' ? theme.success + '40' : (pGender === 'Nữ' ? '#D85A3040' : '#37415140'),
                        flexDirection: 'row', alignItems: 'center', gap: 4
                      }}>
                        {pGender ? (
                          <Text style={{ color: pGender === 'Nam' ? theme.success : (pGender === 'Nữ' ? '#D85A30' : '#374151'), fontSize: 12, fontFamily: SCREEN_FONTS.headline }}>
                            {pGender.toUpperCase()}
                          </Text>
                        ) : null}
                        <Text style={{ color: pGender === 'Nam' ? theme.success : (pGender === 'Nữ' ? '#D85A30' : '#374151'), fontSize: 12, fontFamily: SCREEN_FONTS.headline }}>
                          {(p as any).pvna ? Number((p as any).pvna).toFixed(2) : (pSkill.replace('Trình', '').trim())}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </Animated.View>
          )

          return (
            <FeaturedSessionCard 
              session={session} 
              isExpanded={displayPlayers.length > 0 ? showPlayerList : undefined}
              onToggleExpand={displayPlayers.length > 0 ? () => setShowPlayerList(!showPlayerList) : undefined}
              expandableContent={playerListContent}
              forcePrimaryColor={true}
            />
          )
        })()}

        {/* NEW FORM CARD */}
        <View style={{
          backgroundColor: theme.surface,
          borderRadius: 16,
          borderWidth: 0.5,
          borderColor: theme.border,
          overflow: 'hidden',
          marginTop: 24,
          ...LAYOUT_SHADOW.sm,
        }}>
          {/* Form header */}
          <View style={{
            paddingTop: 14,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
          }}>
            <View style={{
              width: 30, height: 30, borderRadius: 8,
              backgroundColor: theme.primarySoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 14 }}>👤</Text>
            </View>
            <Text style={{
              fontFamily: SCREEN_FONTS.headlineBlack,
              fontSize: 20, color: theme.onSurface, lineHeight: 22,
            }}>{STRINGS.register.player_info}</Text>
          </View>

          {/* Form body */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
            
            {/* FIELD: Họ và tên */}
            <View>
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13, fontWeight: '600',
                color: theme.onSurface, marginBottom: 6,
              }}>{STRINGS.register.name_label}</Text>

              <View style={{ position: 'relative' }}>
                <Text style={{
                  position: 'absolute', left: 14, top: 12,
                  fontSize: 15, zIndex: 1,
                }}>👤</Text>
                <TextInput
                  style={{
                    backgroundColor: theme.surfaceAlt,
                    borderRadius: 8, borderWidth: 0,
                    paddingVertical: 12,
                    paddingLeft: 40, paddingRight: 14,
                    fontSize: 16, color: theme.onSurface,
                    fontFamily: SCREEN_FONTS.body,
                  }}
                  placeholder={STRINGS.register.name_label}
                  placeholderTextColor={theme.onSurfaceVariant}
                  value={name}
                  onChangeText={setName}
                  onBlur={() => setNameTouched(true)}
                />
              </View>

              <Text style={{
                fontSize: 12, color: theme.onSurfaceVariant,
                marginTop: 4, lineHeight: 16,
                fontFamily: SCREEN_FONTS.body,
              }}>
                {nameTouched && nameError ? nameError : STRINGS.register.name_hint}
              </Text>
            </View>

            <View style={{ height: 0.5, backgroundColor: '#F0EDE5' }} />

            {/* FIELD: Số điện thoại */}
            <View>
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13, fontWeight: '600',
                color: theme.onSurface, marginBottom: 6,
              }}>{STRINGS.register.phone_label}</Text>

              <View style={{ position: 'relative' }}>
                <Text style={{
                  position: 'absolute', left: 14, top: 12,
                  fontSize: 15, zIndex: 1,
                }}>📱</Text>
                <TextInput
                  style={{
                    backgroundColor: theme.surfaceAlt,
                    borderRadius: 8, borderWidth: 0,
                    paddingVertical: 12,
                    paddingLeft: 40, paddingRight: 14,
                    fontSize: 16, color: theme.onSurface,
                    fontFamily: SCREEN_FONTS.body,
                  }}
                  placeholder="0912333333"
                  placeholderTextColor={theme.onSurfaceVariant}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(text) => setPhone(normalizePhoneInput(text))}
                  onBlur={() => setPhoneTouched(true)}
                />
              </View>

              <Text style={{
                fontSize: 12, color: theme.onSurfaceVariant,
                marginTop: 4, lineHeight: 16,
                fontFamily: SCREEN_FONTS.body,
              }}>
                {phoneTouched && phoneError ? phoneError : STRINGS.register.phone_hint}
              </Text>
            </View>

            <View style={{ height: 0.5, backgroundColor: '#F0EDE5' }} />

            {/* FIELD: Giới tính */}
            <View>
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13, fontWeight: '600',
                color: theme.onSurface, marginBottom: 6,
              }}>{STRINGS.register.gender_label}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[
                  { id: 'male', label: STRINGS.common.gender.male },
                  { id: 'female', label: STRINGS.common.gender.female }
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setGender(opt.id as any)}
                    style={{
                      flex: 1, paddingVertical: 12,
                      borderRadius: 8, alignItems: 'center',
                      backgroundColor: gender === opt.id ? theme.primary : theme.surface,
                      borderWidth: 1.5,
                      borderColor: gender === opt.id ? theme.primary : theme.border,
                    }}>
                    <Text style={{
                      fontFamily: SCREEN_FONTS.label,
                      fontSize: 15, fontWeight: '600',
                      color: gender === opt.id ? theme.onPrimary : theme.onSurfaceVariant,
                    }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ height: 0.5, backgroundColor: '#F0EDE5' }} />

            {/* PREFERENCES SECTION */}
            <View>
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13, fontWeight: '600',
                color: theme.onSurface, marginBottom: 12,
              }}>Sở thích ghép cặp (không bắt buộc)</Text>
              
              <View style={{ gap: 16 }}>
                {/* Partner Preference */}
                <View>
                  <Text style={{ fontSize: 12, color: theme.onSurfaceVariant, marginBottom: 8, fontFamily: SCREEN_FONTS.body }}>{STRINGS.register.partner_pref}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {[
                      { id: 'any', label: STRINGS.common.gender.any, icon: '🚻' },
                      { id: 'male', label: STRINGS.common.gender.male, icon: '♂' },
                      { id: 'female', label: STRINGS.common.gender.female, icon: '♀' },
                    ].map((opt) => (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => setPartnerPref(opt.id as any)}
                        style={{
                          flex: 1, paddingVertical: 10,
                          borderRadius: 8, alignItems: 'center',
                          backgroundColor: partnerPref === opt.id ? theme.primary : theme.surfaceAlt,
                          borderWidth: 1,
                          borderColor: partnerPref === opt.id ? theme.primary : 'transparent',
                        }}>
                        <Text style={{
                          fontFamily: SCREEN_FONTS.label,
                          fontSize: 13,
                          color: partnerPref === opt.id ? theme.onPrimary : theme.onSurfaceVariant,
                        }}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Opponent Preference */}
                <View>
                  <Text style={{ fontSize: 12, color: theme.onSurfaceVariant, marginBottom: 8, fontFamily: SCREEN_FONTS.body }}>{STRINGS.register.opponent_pref}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {[
                      { id: 'any', label: STRINGS.common.gender.any, icon: '🚻' },
                      { id: 'male', label: STRINGS.common.gender.male, icon: '♂' },
                      { id: 'female', label: STRINGS.common.gender.female, icon: '♀' },
                    ].map((opt) => (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => setOpponentPref(opt.id as any)}
                        style={{
                          flex: 1, paddingVertical: 10,
                          borderRadius: 8, alignItems: 'center',
                          backgroundColor: opponentPref === opt.id ? theme.primary : theme.surfaceAlt,
                          borderWidth: 1,
                          borderColor: opponentPref === opt.id ? theme.primary : 'transparent',
                        }}>
                        <Text style={{
                          fontFamily: SCREEN_FONTS.label,
                          fontSize: 13,
                          color: opponentPref === opt.id ? theme.onPrimary : theme.onSurfaceVariant,
                        }}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            <View style={{ height: 0.5, backgroundColor: '#F0EDE5' }} />

            <View>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 8,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{
                    fontFamily: SCREEN_FONTS.label,
                    fontSize: 13, fontWeight: '600',
                    color: theme.onSurface,
                  }}>{STRINGS.register.skill_level_label}</Text>
                  
                  <TouchableOpacity
                    onPress={toggleNewbie}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: isNewbie ? theme.primary : theme.primarySoft,
                      borderWidth: 1.5,
                      borderColor: theme.primary,
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                      borderRadius: RADIUS.full,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: isNewbie ? theme.onPrimary : theme.primary,
                        fontFamily: SCREEN_FONTS.label,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      Người mới
                    </Text>
                  </TouchableOpacity>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {/* Value badge */}
                  <View style={{
                    backgroundColor: theme.primarySoft,
                    paddingHorizontal: 10, paddingVertical: 2, borderRadius: 6,
                  }}>
                    <Text style={{
                      fontFamily: SCREEN_FONTS.headlineBlack,
                      fontSize: 20, color: theme.primary, lineHeight: 20,
                    }}>{isNewbie ? 'NEWBIE' : pvnaValue.toFixed(1)}</Text>
                  </View>
                </View>
              </View>

              {/* Slider below the header row */}

              <Slider
                minimumValue={pvnaRange.min}
                maximumValue={pvnaRange.max}
                step={0.1}
                value={pvnaValue}
                onValueChange={(val) => setPvna((Math.round(val * 10) / 10).toFixed(1))}
                minimumTrackTintColor={isNewbie ? theme.border : theme.primary}
                maximumTrackTintColor={theme.border}
                thumbTintColor={isNewbie ? theme.border : theme.primary}
                disabled={isNewbie}
              />

              {/* Scale labels */}
              <View style={{
                flexDirection: 'row', justifyContent: 'space-between', marginTop: 4,
                opacity: isNewbie ? 0.4 : 1,
              }}>
                {[pvnaRange.min, 3.2, 4.3, pvnaRange.max].map((v, i) => (
                  <Text key={i} style={{
                    fontSize: 11,
                    color: !isNewbie && Math.abs(pvnaValue - v) < 0.2 ? theme.primary : theme.onSurfaceVariant,
                    fontWeight: !isNewbie && Math.abs(pvnaValue - v) < 0.2 ? '700' : '400',
                    fontFamily: SCREEN_FONTS.body,
                  }}>{v.toFixed(1)}</Text>
                ))}
              </View>

              <Text style={{
                fontSize: 11, color: theme.onSurfaceVariant,
                marginTop: 8, lineHeight: 16,
                fontFamily: SCREEN_FONTS.body,
              }}>
                {isNewbie ? STRINGS.register.skill_helper_newbie : STRINGS.register.skill_helper_slider}
              </Text>

              <TouchableOpacity 
                onPress={handleGoToAssessment}
                activeOpacity={0.7}
                style={{ marginTop: 12, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: '#F0EDE5', borderStyle: 'dashed' }}
              >
                <Text style={{ fontSize: 12, color: theme.onSurfaceVariant, lineHeight: 18, fontFamily: SCREEN_FONTS.body }}>
                  {STRINGS.register.skill_assessment_prompt}
                  <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.label, textDecorationLine: 'underline' }}>
                    {STRINGS.register.skill_assessment_link}
                  </Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* CTA SECTION */}
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          {statusMsg ? (
            <Text style={{ textAlign: 'center', color: theme.primary, fontFamily: SCREEN_FONTS.label, fontSize: 13, marginBottom: 10 }}>
              {statusMsg}
            </Text>
          ) : null}

          {errorMsg ? (
            <Text style={{ textAlign: 'center', color: theme.error, fontFamily: SCREEN_FONTS.label, fontSize: 13, marginBottom: 10 }}>
              {errorMsg}
            </Text>
          ) : null}

          {isEnded ? (
            <View style={{ 
              backgroundColor: theme.error + '10', 
              padding: 12, 
              borderRadius: 12, 
              marginBottom: 16,
              borderWidth: 1,
              borderColor: theme.error + '30'
            }}>
              <Text style={{ 
                textAlign: 'center', 
                color: theme.error, 
                fontFamily: SCREEN_FONTS.bold, 
                fontSize: 14 
              }}>
                {STRINGS.register.ended_warning}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={{
              backgroundColor: isEnded ? theme.onSurfaceVariant : theme.primary,
              borderRadius: 999, padding: 16,
              flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: (submitting || isEnded) ? 0.7 : 1,
              ...LAYOUT_SHADOW.sm
            }}
            onPress={handleRegister}
            disabled={!_canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={theme.onPrimary} size="small" />
            ) : (
              <Text style={{ fontSize: 16, color: 'white' }}>✓</Text>
            )}
            <Text style={{
              fontFamily: SCREEN_FONTS.bold,
              fontSize: 16, fontWeight: '700', color: 'white',
            }}>{submitting ? STRINGS.register.submitting : STRINGS.register.confirm_btn}</Text>
          </TouchableOpacity>

          {/* Social proof below button */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            justifyContent: 'center', gap: 6, marginTop: 14,
          }}>
            <Text style={{ fontSize: 14 }}>👥</Text>
            <Text style={{
              fontFamily: SCREEN_FONTS.body,
              fontSize: 12, color: theme.onSurfaceVariant,
            }}>Đã có {session.session_players.length} người đăng ký</Text>
          </View>
        </View>
        <BrandedFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const _styles = StyleSheet.create({
  inputGap: { gap: 20 },
  formTitle: {
    fontSize: 18,
    fontFamily: SCREEN_FONTS.headline,
    marginBottom: 24,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  label: {
    fontSize: 14,
    fontFamily: SCREEN_FONTS.headline,
    marginBottom: 12,
  },
  inputBox: {
    minHeight: 52,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 44,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: SCREEN_FONTS.body,
  },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: SCREEN_FONTS.body,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 12,
  },
  choiceBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 15,
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    opacity: 0.7,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: SCREEN_FONTS.headline,
    marginTop: 24,
    textAlign: 'center',
  },
  successDesc: {
    fontSize: 15,
    fontFamily: SCREEN_FONTS.body,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 22,
  },
})
