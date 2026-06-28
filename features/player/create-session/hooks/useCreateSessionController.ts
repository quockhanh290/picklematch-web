import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Platform } from 'react-native'
import { supabase } from '@/lib/supabase'
import { type NearByCourt, useNearbyCourts } from '@/lib/useNearbyCourts'
import { CREATE_SESSION_ELO_LEVELS } from '@/lib/eloSystem'
import { useAuth } from '@/lib/useAuth'
import type { SessionDetailRecord } from '@/hooks/useSessionDetail'
import * as Linking from 'expo-linking'
import * as Haptics from 'expo-haptics'
import { fetchSessionDetailForEditApi, createSessionApi, updateSessionApi } from '../api'
import { eloToPvna, pvnaToElo } from '@/lib/skillAssessment'

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function parseTotalCost(value: string) {
  return parseInt(value.replace(/\D/g, ''), 10) || 0
}

function withTime(base: Date, time: Date): Date {
  const next = new Date(base)
  next.setHours(time.getHours(), time.getMinutes(), 0, 0)
  return next
}

function nearestDeadlineMinutes(value: number | null | undefined): number {
  const options = [30, 45, 60, 120]
  if (!value || value <= 0) return 60
  return options.reduce((closest, current) =>
    Math.abs(current - value) < Math.abs(closest - value) ? current : closest,
  options[0])
}

function skillLevelFromElo(elo: number): number {
  return Math.round(eloToPvna(elo) * 10) / 10
}

export function useCreateSessionController(editSessionId: string | null) {
  const { userId, isLoading } = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{ courtId?: string; courtName?: string }>()
  const isEditMode = Boolean(editSessionId)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const { courts, loading: loadingCourts, fallbackMode, keyword, setKeyword, searching } = useNearbyCourts()

  const [selectedCourt, setSelectedCourt] = useState<NearByCourt | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [endTime, setEndTime] = useState<Date | null>(null)
  const [showStartPicker, setShowStartPicker] = useState(false)
  const [showEndPicker, setShowEndPicker] = useState(false)
  const [timeError, setTimeError] = useState<string | null>(null)

  const [maxPlayers, setMaxPlayers] = useState(4)
  const [eloMin, setEloMin] = useState(CREATE_SESSION_ELO_LEVELS[0].elo)
  const [eloMax, setEloMax] = useState(CREATE_SESSION_ELO_LEVELS[5].elo)
  const [deadlineMinutes, setDeadlineMinutes] = useState(60)
  const [requireApproval, setRequireApproval] = useState(false)
  const [isRanked, setIsRanked] = useState(true)
  const [canToggleRanked, setCanToggleRanked] = useState(false)
  const [rankedHelperText, setRankedHelperText] = useState<string | null>('Đang kiểm tra quyền dùng kèo tính Elo...')
  const [totalCostStr, setTotalCostStr] = useState('')
  const [minSkill, setMinSkill] = useState(2.0)
  const [maxSkill, setMaxSkill] = useState(5.5)
  const [skillTolerance, setSkillTolerance] = useState(0.05)
  const [bookingStatus, setBookingStatus] = useState<'confirmed' | 'unconfirmed'>('confirmed')
  const [wantsBookingNow, setWantsBookingNow] = useState<boolean | null>(null)
  const [bookingReference, setBookingReference] = useState('')
  const [bookingName, setBookingName] = useState('')
  const [bookingPhone, setBookingPhone] = useState('')
  const [bookingNotes, setBookingNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isHydratingEdit, setIsHydratingEdit] = useState(false)
  const [editHydrated, setEditHydrated] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<any | null>(null)
  const [lockCourtSchedule, setLockCourtSchedule] = useState(false)
  const [lockedSlotSnapshot, setLockedSlotSnapshot] = useState<{ courtId: string; startIso: string; endIso: string } | null>(null)
  
  const totalCost = useMemo(() => parseTotalCost(totalCostStr), [totalCostStr])
  const costPerPerson = totalCost > 0 ? Math.ceil(totalCost / maxPlayers) : 0

  function handleSetWantsBookingNow(value: boolean | null) {
    setWantsBookingNow(value)
  }

  useEffect(() => {
    if (isEditMode) return
    setLockCourtSchedule(false)
    setLockedSlotSnapshot(null)
  }, [isEditMode])

  useEffect(() => {
    if (!isEditMode || !editSessionId || editHydrated) return
    let mounted = true

    async function hydrateEditSession() {
      setIsHydratingEdit(true)

      const [{ data: authData }, detailResult] = await Promise.all([
        supabase.auth.getUser(),
        fetchSessionDetailForEditApi(editSessionId!),
      ])

      const user = authData.user
      const session = (detailResult.data?.session ?? null) as SessionDetailRecord | null

      if (!mounted) return

      if (!user) {
        setDialogConfig({
          title: 'Cần đăng nhập',
          message: 'Bạn cần đăng nhập để chỉnh sửa kèo.',
          actions: [{ label: 'OK', onPress: () => router.back() }],
        })
        return
      }

      if (detailResult.error || !session) {
        setDialogConfig({
          title: 'Lỗi',
          message: detailResult.error?.message ?? 'Không tải được dữ liệu kèo.',
          actions: [{ label: 'Quay lại', onPress: () => router.back() }],
        })
        return
      }

      if (session.host.id !== user.id) {
        setDialogConfig({
          title: 'Không có quyền',
          message: 'Bạn không phải chủ kèo nên không thể chỉnh sửa.',
          actions: [{ label: 'Đã hiểu', onPress: () => router.back() }],
        })
        return
      }

      if (!session.slot) {
        setDialogConfig({
          title: 'Không thể chỉnh sửa',
          message: 'Kèo này không có thông tin sân.',
          actions: [{ label: 'Đã hiểu', onPress: () => router.back() }],
        })
        return
      }

      const nextStart = new Date(session.slot.start_time)
      const nextEnd = new Date(session.slot.end_time)
      const nextDate = new Date(nextStart)
      nextDate.setHours(0, 0, 0, 0)

      const fillDeadlineMs = session.fill_deadline ? new Date(session.fill_deadline).getTime() : null
      const deadlineDiffMins =
        fillDeadlineMs != null ? Math.max(0, Math.round((nextStart.getTime() - fillDeadlineMs) / 60_000)) : 60

      const nextCourt: NearByCourt = {
        id: session.slot.court.id ?? '',
        name: session.slot.court.name,
        address: session.slot.court.address,
        city: session.slot.court.city,
        phone: (session.slot.court as any).phone ?? null,
        lat: null,
        lng: null,
        hours_open: '06:00',
        hours_close: '22:00',
        price_per_hour: null,
        booking_url: null,
        google_maps_url: null,
      }

      const matchedCourt = courts.find((item) => item.id === nextCourt.id) ?? nextCourt

      const _minLevel = skillLevelFromElo(session.elo_min)
      const _maxLevel = skillLevelFromElo(session.elo_max)
      const sendBookingDetails = session.court_booking_status === 'confirmed' || Boolean(session.booking_reference || session.booking_name || session.booking_phone || session.booking_notes)

      setSelectedCourt(matchedCourt)
      setSelectedDate(nextDate)
      setStartTime(nextStart)
      setEndTime(nextEnd)
      setTimeError(null)

      setMaxPlayers(session.max_players <= 2 ? 2 : 4)
      setEloMin(session.elo_min)
      setEloMax(session.elo_max)
      setMinSkill(skillLevelFromElo(session.elo_min))
      setMaxSkill(skillLevelFromElo(session.elo_max))
      setDeadlineMinutes(nearestDeadlineMinutes(deadlineDiffMins))
      setRequireApproval(Boolean(session.require_approval))
      setIsRanked(Boolean(session.is_ranked))
      setBookingStatus(session.court_booking_status ?? 'unconfirmed')
      setWantsBookingNow(session.court_booking_status === 'unconfirmed' ? (sendBookingDetails ? true : null) : null)
      setBookingReference(session.booking_reference ?? '')
      setBookingName(session.booking_name ?? '')
      setBookingPhone(session.booking_phone ?? '')
      setBookingNotes(session.booking_notes ?? '')
      setTotalCostStr(session.slot.price && session.slot.price > 0 ? String(session.slot.price) : '')
      setLockCourtSchedule(session.court_booking_status === 'confirmed')
      setLockedSlotSnapshot(
        session.court_booking_status === 'confirmed'
          ? {
              courtId: session.slot.court.id ?? '',
              startIso: nextStart.toISOString(),
              endIso: nextEnd.toISOString(),
            }
          : null,
      )

      setEditHydrated(true)
      setIsHydratingEdit(false)
    }

    void hydrateEditSession()

    return () => {
      mounted = false
    }
  }, [courts, editHydrated, editSessionId, isEditMode, router])

  useEffect(() => {
    if (isEditMode || editHydrated) return
    if (params.courtId && params.courtName) {
      const matched = courts.find(c => c.id === params.courtId)
      if (matched) {
        // Upgrade placeholder or set for first time
        if (!selectedCourt || selectedCourt.id !== matched.id || selectedCourt.address === '') {
          setSelectedCourt(matched)
        }
      } else if (!selectedCourt) {
        // Initial placeholder
        setSelectedCourt({
          id: params.courtId,
          name: params.courtName,
          address: '',
          city: '',
          phone: null,
          lat: null,
          lng: null,
          hours_open: '06:00',
          hours_close: '22:00',
          price_per_hour: null,
          booking_url: null,
          google_maps_url: null,
        })
      }
    }
  }, [params.courtId, params.courtName, isEditMode, editHydrated, courts, selectedCourt])

  const validateStart = useCallback((time: Date): string | null => {
    const now = new Date()
    const isToday = selectedDate?.toDateString() === now.toDateString()
    const openMins = toMins(selectedCourt?.hours_open ?? '06:00')
    const closeMins = toMins(selectedCourt?.hours_close ?? '22:00')
    const timeMins = time.getHours() * 60 + time.getMinutes()

    if (isToday && time <= now) return 'Giờ bắt đầu phải sau thời gian hiện tại'
    if (timeMins < openMins) return `Sân mở cửa lúc ${selectedCourt?.hours_open ?? '06:00'}`
    if (timeMins >= closeMins) return `Sân đóng cửa lúc ${selectedCourt?.hours_close ?? '22:00'}`
    return null
  }, [selectedCourt?.hours_close, selectedCourt?.hours_open, selectedDate])

  const validateEnd = useCallback((end: Date, start: Date): string | null => {
    const closeMins = toMins(selectedCourt?.hours_close ?? '22:00')
    const endMins = end.getHours() * 60 + end.getMinutes()

    if (end <= start) return 'Giờ kết thúc phải sau giờ bắt đầu'
    if (endMins > closeMins) return `Sân đóng cửa lúc ${selectedCourt?.hours_close ?? '22:00'}`
    return null
  }, [selectedCourt?.hours_close])

  useEffect(() => {
    if (!startTime) {
      setTimeError(null)
      return
    }

    const startErr = validateStart(startTime)
    if (startErr) {
      setTimeError(startErr)
      return
    }

    if (!endTime) {
      setTimeError(null)
      return
    }

    setTimeError(validateEnd(endTime, startTime))
  }, [endTime, startTime, validateEnd, validateStart])

  useEffect(() => {
    let mounted = true

    async function loadRankedEligibility() {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) {
        if (!mounted) return
        if (!isEditMode) setIsRanked(false)
        setCanToggleRanked(false)
        setRankedHelperText('Đăng nhập để chọn kèo có tính Elo.')
        return
      }

      const { data: playerRow } = await supabase
        .from('players')
        .select('onboarding_completed, auto_accept')
        .eq('id', user.id)
        .single()

      const onboardingCompleted = Boolean(playerRow?.onboarding_completed)
      const autoAcceptPref = Boolean(playerRow?.auto_accept)

      if (!mounted) return

      setCanToggleRanked(onboardingCompleted)
      if (!onboardingCompleted) {
        if (!isEditMode) setIsRanked(false)
        setRankedHelperText('Hoàn tất onboarding để dùng kèo tính Elo.')
      } else {
        if (!isEditMode) setIsRanked(true)
        setRankedHelperText('Bạn có thể bật hoặc tắt Elo cho kèo này trước khi đăng.')
      }

      if (!isEditMode) {
        setRequireApproval(!autoAcceptPref)
      }
    }

    void loadRankedEligibility()

    return () => {
      mounted = false
    }
  }, [isEditMode])

  const defaultPickerValue = useCallback((type: 'start' | 'end'): Date => {
    const base = selectedDate ?? new Date()
    const next = new Date(base)
    if (type === 'start') {
      next.setHours(18, 0, 0, 0)
      return next
    }
    next.setHours(20, 0, 0, 0)
    return next
  }, [selectedDate])

  function onCourtSelect(court: NearByCourt) {
    setSelectedCourt(court)
    setStartTime(null)
    setEndTime(null)
    setTimeError(null)
    setWantsBookingNow(null)
    setBookingReference('')
    setBookingName('')
    setBookingPhone('')
    setBookingNotes('')
  }

  async function openCourtBookingLink() {
    const url = selectedCourt?.booking_url ?? selectedCourt?.google_maps_url
    if (!url) {
      setDialogConfig({
        title: 'Chưa có link đặt sân',
        message: 'Sân này chưa có link booking. Bạn vẫn có thể tự đặt rồi nhập thông tin bên dưới.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      setDialogConfig({
        title: 'Không mở được link',
        message: 'Vui lòng thử lại hoặc mở link booking của sân theo cách khác.',
        actions: [{ label: 'Đã hiểu' }],
      })
    }
  }

  function onDatePress(date: Date) {
    setSelectedDate(date)
    if (startTime) setStartTime(withTime(date, startTime))
    if (endTime) setEndTime(withTime(date, endTime))
    setTimeError(null)
  }

  async function goToStep2() {
    if (!selectedCourt || !selectedDate || !startTime || !endTime || timeError) return
    if (Platform.OS !== 'web') {
      try { Haptics.selectionAsync() } catch {}
    }

    // Check for overlapping sessions by looking at court_slots linked to active sessions
    try {
      let query = supabase
        .from('court_slots')
        .select(`
          id,
          sessions!inner (
            id,
            status
          )
        `)
        .eq('court_id', selectedCourt.id)
        .eq('sessions.status', 'open')
        .lt('start_time', endTime.toISOString())
        .gt('end_time', startTime.toISOString())

      if (isEditMode && editSessionId) {
        query = query.neq('sessions.id', editSessionId)
      }

      const { data: overlappingSlots, error } = await query

      console.log('[OverlapCheck] Params:', {
        courtId: selectedCourt.id,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        isEdit: isEditMode,
        editId: editSessionId
      });
      
      if (error) console.error('[OverlapCheck] Error:', error);
      console.log('[OverlapCheck] Results:', overlappingSlots);

      if (overlappingSlots && overlappingSlots.length > 0) {
        setDialogConfig({
          title: 'Lưu ý trùng lịch',
          message: `Đang có ${overlappingSlots.length} kèo khác tại địa điểm này vào cùng khung giờ. Bạn vui lòng đảm bảo đã đặt sân riêng biệt để tránh trùng lặp.`,
          actions: [
            { label: 'Sửa lại', tone: 'secondary' },
            { label: 'Tiếp tục', onPress: () => setStep(2) }
          ],
        })
        return
      }
    } catch (err) {
      console.error('Error checking overlaps:', err)
    }

    setStep(2)
  }

  function goToStep3FromNew() {
    const minElo = pvnaToElo(Math.max(2.0, minSkill - skillTolerance))
    const maxElo = pvnaToElo(Math.min(5.5, maxSkill + skillTolerance))

    if (minElo > maxElo) {
      setDialogConfig({
        title: 'Lỗi',
        message: 'Trình độ tối thiểu không thể cao hơn trình độ tối đa.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setEloMin(minElo)
    setEloMax(maxElo)
    if (Platform.OS !== 'web') {
      try { Haptics.selectionAsync() } catch {}
    }
    setStep(3)
  }

  async function submit() {
    if (!selectedCourt || !startTime || !endTime) return

    // Hardening: Basic validation
    if (totalCost > 2000000) {
      setDialogConfig({
        title: 'Chi phí không hợp lệ',
        message: 'Chi phí sân quá lớn. Vui lòng kiểm tra lại số tiền nhập.',
        actions: [{ label: 'Sửa lại' }],
      })
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setDialogConfig({
          title: 'Cần đăng nhập',
          message: `Bạn cần đăng nhập để ${isEditMode ? 'cập nhật' : 'tạo'} kèo.`,
          actions: [
            { label: 'Đăng nhập', onPress: () => router.push('/login') },
            { label: 'Hủy', tone: 'secondary' },
          ],
        })
        return
      }

      setSubmitting(true)

      const sendBookingDetails = bookingStatus === 'confirmed' || wantsBookingNow === true
      const fillDeadline = new Date(startTime.getTime() - deadlineMinutes * 60_000)
      if (fillDeadline.getTime() <= Date.now()) {
        setDialogConfig({
          title: 'Hạn chót chưa hợp lệ',
          message: 'Hạn chót vào kèo phải nằm trong tương lai. Hãy chọn giờ chơi muộn hơn hoặc giảm mốc hạn chót.',
          actions: [{ label: 'Đã hiểu' }],
        })
        return
      }

      if (isEditMode && lockCourtSchedule && lockedSlotSnapshot) {
        const changedCourt = selectedCourt.id !== lockedSlotSnapshot.courtId
        const changedStart = startTime.toISOString() !== lockedSlotSnapshot.startIso
        const changedEnd = endTime.toISOString() !== lockedSlotSnapshot.endIso
        if (changedCourt || changedStart || changedEnd) {
          setDialogConfig({
            title: 'Không thể thay đổi',
            message: 'Kèo đã đặt sân nên không thể đổi sân và ngày giờ chơi.',
            actions: [{ label: 'Đã hiểu' }],
          })
          return
        }
      }

      const basePayload = {
        p_court_id: selectedCourt.id,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString(),
        p_elo_min: eloMin,
        p_elo_max: eloMax,
        p_is_ranked: isRanked,
        p_max_players: maxPlayers,
        p_fill_deadline: fillDeadline.toISOString(),
        p_total_cost: totalCost || null,
        p_require_approval: requireApproval,
        p_court_booking_status: wantsBookingNow === true ? 'confirmed' : bookingStatus,
      }

      const fullPayload = {
        ...basePayload,
        p_booking_reference: sendBookingDetails ? bookingReference.trim() || null : null,
        p_booking_name: sendBookingDetails ? bookingName.trim() || null : null,
        p_booking_phone: sendBookingDetails ? bookingPhone.trim() || null : null,
        p_booking_notes: sendBookingDetails ? bookingNotes.trim() || null : null,
        p_booking_confirmed_at: bookingStatus === 'confirmed' ? new Date().toISOString() : null,
      }

      let finalSessionId: string | null = null

      if (isEditMode && editSessionId) {
        const { data: updatedSessionId, error: updateError } = await updateSessionApi(editSessionId, fullPayload)
        
        if (updateError || !updatedSessionId) {
          throw new Error(updateError?.message ?? 'Không thể cập nhật kèo.')
        }
        finalSessionId = updatedSessionId
      } else {
        const { data: newSessionId, error: createError } = await createSessionApi(fullPayload)
        
        if (createError || !newSessionId) {
          throw new Error(createError?.message ?? 'Không thể tạo kèo.')
        }
        finalSessionId = newSessionId
      }

      if (Platform.OS !== 'web') {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch {}
      }

      router.replace({
        pathname: '/session/[id]',
        params: { id: finalSessionId, [isEditMode ? 'updated' : 'created']: '1' },
      } as never)

    } catch (error) {
      if (Platform.OS !== 'web') {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error) } catch {}
      }
      const message = error instanceof Error ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.'
      setDialogConfig({
        title: 'Lỗi',
        message: message,
        actions: [{ label: 'Đã hiểu' }],
      })
    } finally {
      setSubmitting(false)
    }
  }

  return {
    userId,
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
    setSelectedDate,
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
    setWantsBookingNow: handleSetWantsBookingNow,
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
    eloMin,
    eloMax,
  }
}
