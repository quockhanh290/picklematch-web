import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { type NearByCourt, useNearbyCourts } from '@/lib/useNearbyCourts'
import { useAuth } from '@/lib/useAuth'
import * as Haptics from 'expo-haptics'
import { 
  fetchHostSessionDetailForEditApi as fetchSessionDetailForEditApi, 
  createHostSessionApi as createSessionApi, 
  updateHostSessionApi as updateSessionApi 
} from '@/features/host/api/sessionApi'
import { eloToPvna, pvnaToElo } from '@/lib/skillAssessment'

type Format = 'social' | 'round_robin' | 'open_play'

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

export function useHostCreateSessionController(editSessionId: string | null) {
  const { userId, isLoading: _authLoading } = useAuth()
  const router = useRouter()
  const _params = useLocalSearchParams<{ courtId?: string; courtName?: string }>()
  const isEditMode = Boolean(editSessionId)
  
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const nearbyCourtsData = useNearbyCourts()
  const { courts: _courts, loading: _loadingCourts } = nearbyCourtsData
  const [isChoosingCourt, setIsChoosingCourt] = useState(false)

  // --- States ---
  const [selectedCourt, setSelectedCourt] = useState<NearByCourt | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [endTime, setEndTime] = useState<Date | null>(null)
  const [showStartPicker, setShowStartPicker] = useState(false)
  const [showEndPicker, setShowEndPicker] = useState(false)
  const [timeError, setTimeError] = useState<string | null>(null)

  const [format, setFormat] = useState<Format>('social')
  const [playMode, setPlayMode] = useState<'singles' | 'doubles'>('doubles')
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [minSkill, setMinSkill] = useState(2.0)
  const [maxSkill, setMaxSkill] = useState(5.5)
  const [skillTolerance, setSkillTolerance] = useState(0.05)
  const [isNewbie, setIsNewbie] = useState(false)
  
  const [selectedSubCourts, setSelectedSubCourts] = useState<number[]>([1])
  const [requireResults, setRequireResults] = useState(false)
  const [requireApproval, setRequireApproval] = useState(false)
  const [hostIsPlaying, setHostIsPlaying] = useState(true)
  const [hostGender, setHostGender] = useState<'male' | 'female'>('male')
  const [hostSkill, setHostSkill] = useState(3.5)
  const [costPerPersonStr, setCostPerPersonStr] = useState('')
  const [deadlineMinutes, setDeadlineMinutes] = useState(60)
  const [bookingStatus, setBookingStatus] = useState<'confirmed' | 'unconfirmed'>('confirmed')
  
  const [submitting, setSubmitting] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<any | null>(null)

  const costVal = useMemo(() => parseTotalCost(costPerPersonStr), [costPerPersonStr])

  // --- Host Profile Fetch ---
  useEffect(() => {
    if (userId) {
      fetchHostProfile()
    }
  }, [userId])

  async function fetchHostProfile() {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('gender, pvna')
        .eq('id', userId)
        .single()
      
      if (!error && data) {
        if (data.gender) setHostGender(data.gender.toLowerCase() === 'female' ? 'female' : 'male')
        if (data.pvna) setHostSkill(data.pvna)
      }
    } catch (err) {
      console.error('[HostController] Failed to fetch host profile:', err)
    }
  }

  // --- Hydration ---
  useEffect(() => {
    if (isEditMode && editSessionId) {
      hydrateHostSession()
    }
  }, [editSessionId])

  async function hydrateHostSession() {
    if (!editSessionId) return
    setIsHydrating(true)
    try {
      const { data, error } = await fetchSessionDetailForEditApi(editSessionId)
      if (error) throw error
      if (data) {
        const session = data.session || data
        const HostDetails = session.owner_sessions?.[0] || session.owner_sessions || {}
        
        // Court & Time
        const nextStart = new Date(session.slot.start_time)
        const nextEnd = new Date(session.slot.end_time)
        const nextDate = new Date(nextStart)
        nextDate.setHours(0, 0, 0, 0)
        
        setSelectedCourt({
          id: session.slot.court.id,
          name: session.slot.court.name,
          address: session.slot.court.address,
          city: session.slot.court.city,
          phone: session.slot.court.phone || null,
          lat: session.slot.court.lat || null,
          lng: session.slot.court.lng || null,
          hours_open: session.slot.court.hours_open || '06:00',
          hours_close: session.slot.court.hours_close || '22:00',
          price_per_hour: session.slot.court.price_per_hour || null,
          booking_url: session.slot.court.booking_url || null,
          google_maps_url: session.slot.court.google_maps_url || null,
        })
        setSelectedDate(nextDate)
        setStartTime(nextStart)
        setEndTime(nextEnd)

        // Config
        setFormat(HostDetails.format_type || 'social')
        setSelectedSubCourts(HostDetails.sub_court_numbers || [1])
        setRequireResults(HostDetails.require_results || false)
        setRequireApproval(session.require_approval || false)
        setHostIsPlaying(HostDetails.host_is_playing !== undefined ? HostDetails.host_is_playing : true)
        setHostGender(HostDetails.format_metadata?.host_gender || 'male')
        setHostSkill(HostDetails.format_metadata?.host_skill || 3.5)
        setPlayMode(HostDetails.match_format || 'doubles')
        setMaxPlayers(session.max_players || 4)
        setMinSkill(skillLevelFromElo(session.elo_min))
        setMaxSkill(skillLevelFromElo(session.elo_max))
        
        if (session.elo_min === 2.0 && session.elo_max === 2.5) {
          setIsNewbie(true)
        }

        // Cost
        if (session.total_cost) {
          setCostPerPersonStr(String(session.total_cost))
        } else if (HostDetails.format_metadata?.cost_per_person) {
          setCostPerPersonStr(String(HostDetails.format_metadata.cost_per_person))
        }

        const fillDeadlineMs = session.fill_deadline ? new Date(session.fill_deadline).getTime() : null
        const deadlineDiffMins = fillDeadlineMs != null ? Math.max(0, Math.round((nextStart.getTime() - fillDeadlineMs) / 60_000)) : 60
        setDeadlineMinutes(nearestDeadlineMinutes(deadlineDiffMins))
        setBookingStatus(session.court_booking_status || 'confirmed')
      }
    } catch (err) {
      console.error('Hydration error:', err)
    } finally {
      setIsHydrating(false)
    }
  }

  // --- Validation ---
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
  }, [selectedCourt, selectedDate])

  const validateEnd = useCallback((end: Date, start: Date): string | null => {
    const closeMins = toMins(selectedCourt?.hours_close ?? '22:00')
    const endMins = end.getHours() * 60 + end.getMinutes()

    if (end <= start) return 'Giờ kết thúc phải sau giờ bắt đầu'
    if (endMins > closeMins) return `Sân đóng cửa lúc ${selectedCourt?.hours_close ?? '22:00'}`
    return null
  }, [selectedCourt])

  useEffect(() => {
    if (!startTime) { setTimeError(null); return; }
    const startErr = validateStart(startTime)
    if (startErr) { setTimeError(startErr); return; }
    if (!endTime) { setTimeError(null); return; }
    setTimeError(validateEnd(endTime, startTime))
  }, [endTime, startTime, validateEnd, validateStart])

  // --- Handlers ---
  const defaultPickerValue = useCallback((type: 'start' | 'end'): Date => {
    const base = selectedDate ?? new Date()
    const next = new Date(base)
    next.setHours(type === 'start' ? 18 : 20, 0, 0, 0)
    return next
  }, [selectedDate])

  function onDatePress(date: Date) {
    setSelectedDate(date)
    if (startTime) setStartTime(withTime(date, startTime))
    if (endTime) setEndTime(withTime(date, endTime))
    setTimeError(null)
  }

  function goToStep2() {
    if (!selectedCourt || !selectedDate || !startTime || !endTime || timeError) return
    if (Platform.OS !== 'web') {
      try { Haptics.selectionAsync() } catch {}
    }
    setStep(2)
  }

  function goToStep3() {
    if (Platform.OS !== 'web') {
      try { Haptics.selectionAsync() } catch {}
    }
    setStep(3)
  }

  async function submit() {
    if (!selectedCourt || !startTime || !endTime) return
    setSubmitting(true)
    try {
      const fillDeadline = new Date(startTime.getTime() - deadlineMinutes * 60_000)
      const basePayload = {
        p_court_id: selectedCourt.id,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString(),
        p_elo_min: pvnaToElo(minSkill),
        p_elo_max: pvnaToElo(maxSkill),
        p_is_ranked: format === 'round_robin',
        p_max_players: maxPlayers,
        p_fill_deadline: fillDeadline.toISOString(),
        p_total_cost: costVal,
        p_require_approval: requireApproval,
        p_match_format: playMode,
        p_format_type: format,
        p_sub_court_numbers: selectedSubCourts,
        p_is_unlimited: false,
        p_host_is_playing: hostIsPlaying,
        p_host_gender: hostGender,
        p_host_skill: hostSkill,
        p_require_results: requireResults,
        p_format_metadata: {
          cost_per_person: costVal,
          original_format: format,
          created_by_Host: true,
          match_format: playMode,
          host_gender: hostGender,
          host_skill: hostSkill
        }
      }

      console.log('[HostController] Submit payload:', JSON.stringify(basePayload, null, 2))

      let finalSessionId: string | null = null
      if (isEditMode && editSessionId) {
        // ENTRY DEBUG
        console.log('[HostController] Starting edit submit for:', editSessionId)
        
        const { data, error } = await updateSessionApi(editSessionId, basePayload)
        if (error) throw error
        finalSessionId = data

        // Auto-manage player statuses based on new limit
        try {
          await new Promise(resolve => setTimeout(resolve, 800))

          const { count: confirmedCount } = await supabase
            .from('session_players')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', editSessionId)
            .eq('status', 'confirmed')

          const diff = maxPlayers - (confirmedCount || 0)

          if (diff > 0) {
            // PROMOTE: If limit increased, move waiting to confirmed (oldest first)
            const { data: waiting } = await supabase
              .from('session_players')
              .select('player_id')
              .eq('session_id', editSessionId)
              .eq('status', 'waiting')
              .order('created_at', { ascending: true })

            if (waiting && waiting.length > 0) {
              const idsToPromote = waiting.slice(0, diff).map(w => w.player_id)
              await supabase
                .from('session_players')
                .update({ status: 'confirmed' })
                .eq('session_id', editSessionId)
                .in('player_id', idsToPromote)
            }
          } else if (diff < 0) {
            // DEMOTE: If limit decreased, move latest confirmed to waiting (newest first)
            const { data: confirmed } = await supabase
              .from('session_players')
              .select('player_id')
              .eq('session_id', editSessionId)
              .eq('status', 'confirmed')
              .order('created_at', { ascending: false })

            if (confirmed && confirmed.length > 0) {
              const idsToDemote = confirmed.slice(0, Math.abs(diff)).map(d => d.player_id)
              
              await supabase
                .from('session_players')
                .update({ status: 'waiting', team_no: null })
                .eq('session_id', editSessionId)
                .in('player_id', idsToDemote)
            }
          }
        } catch (syncErr) {
          console.error('[HostController] Sync error:', syncErr)
        }
      } else {
        const { data, error } = await createSessionApi(basePayload)
        if (error) throw error
        finalSessionId = data
      }

      if (Platform.OS !== 'web') {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) } catch {}
      }
      router.replace({
        pathname: '/host/session/[id]',
        params: { id: finalSessionId, [isEditMode ? 'updated' : 'created']: '1' },
      } as never)
    } catch (err: any) {
      console.error('Submit error:', err)
      setDialogConfig({
        title: 'Lỗi',
        message: err.message || 'Đã có lỗi xảy ra.',
        actions: [{ label: 'Đã hiểu' }]
      })
    } finally {
      setSubmitting(false)
    }
  }

  return {
    step, setStep,
    selectedCourt, setSelectedCourt,
    selectedDate, setSelectedDate,
    startTime, setStartTime,
    endTime, setEndTime,
    showStartPicker, setShowStartPicker,
    showEndPicker, setShowEndPicker,
    timeError, setTimeError,
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
    bookingStatus, setBookingStatus,
    submitting, isHydrating,
    dialogConfig, setDialogConfig,
    onDatePress, goToStep2, goToStep3, submit,
    defaultPickerValue,
    costPerPerson: costVal, // Added for Step 3
    
    // Court Picker additions
    nearbyCourtsData,
    isChoosingCourt,
    setIsChoosingCourt
  }
}
