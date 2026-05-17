import { BrandedFooter } from '@/components/design/BrandedFooter'
import { SHADOW as LAYOUT_SHADOW, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { SessionMatch } from '@/hooks/useSessionDetail'
import { buildRoundRobinDoublesScheduleAsync } from '@/lib/roundRobinSchedulerClient'
import type { SchedulePriority } from '@/lib/roundRobinScheduler'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { router } from 'expo-router'
import { LayoutDashboard, Minus, Plus, SwordsIcon } from 'lucide-react-native'
import React, { useState, useEffect, useMemo } from 'react'
import { Alert, Dimensions, Platform, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { MatchControlHeader } from './MatchControlHeader'
import { MatchControlSection } from './MatchControlSection'
import { MatchPlayerManagementPanel } from './MatchPlayerManagementPanel'
import { ScheduleCoverageReport } from './ScheduleCoverageReport'
import { ScheduleSetupPanel, type ScheduleMode } from './ScheduleSetupPanel'
import { TeamArrangementScreen } from './TeamArrangementScreen'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const RESPONSIVE_CARD_WIDTH = SCREEN_WIDTH > 400 ? 80 : SCREEN_WIDTH > 360 ? 70 : 64
const RESPONSIVE_CARD_HEIGHT = RESPONSIVE_CARD_WIDTH * 1.25
const RESPONSIVE_FONT_SIZE = SCREEN_WIDTH > 400 ? 56 : SCREEN_WIDTH > 360 ? 48 : 42

interface Props {
  sessionId: string
  matches: SessionMatch[]
  players: ArrangementPlayer[]
  onUpdated: () => void
  onClose?: () => void
  isAfterEnd?: boolean
  courtCount?: number
  maxPlayers?: number
  formatType?: string | null
  onScheduleSetupPageChange?: (isOpen: boolean) => void
  scheduleSetupBackSignal?: number
  initialScheduleSetupOpen?: boolean
}

type PendingMatch = { 
  teamA: string[]
  teamB: string[]
  teamANo?: number
  teamBNo?: number
  rotation?: number
  court?: number
  sitterId?: string
}

export function HostMatchScreen({ sessionId, matches, players, onUpdated, isAfterEnd, courtCount = 1, maxPlayers, formatType, onScheduleSetupPageChange, scheduleSetupBackSignal = 0, initialScheduleSetupOpen = false }: Omit<Props, 'onClose'>) {
  const theme = useAppTheme()
  const [submitting, setSubmitting] = useState(false)
  const isRoundRobinMode = formatType === 'round_robin'
  const isFixedTeamMode = !isRoundRobinMode
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('full')
  const [schedulePriority, setSchedulePriority] = useState<SchedulePriority>('balanced')
  const [scheduleCourtCount, setScheduleCourtCount] = useState(Math.max(1, Math.floor(courtCount || 1)))
  const [minGamesPerPlayer, setMinGamesPerPlayer] = useState(4)
  const [editingPendingIndex, setEditingPendingIndex] = useState<number | null>(null)
  const [showAllProgress, setShowAllProgress] = useState(false)
  const [showRotationTable, setShowRotationTable] = useState(false)
  const [appliedScheduleMode, setAppliedScheduleMode] = useState<'full' | 'limited'>('full')
  const [appliedMinGames, setAppliedMinGames] = useState(1)
  const [showScheduleDiagnostics, setShowScheduleDiagnostics] = useState(false)
  const [showScheduleSetupPage, setShowScheduleSetupPage] = useState(false)
  const [showInlineTeamArrangement, setShowInlineTeamArrangement] = useState(false)
  const [pendingRoundRobinMatches, setPendingRoundRobinMatches] = useState<PendingMatch[]>([])
  const [fullRotationSchedule, setFullRotationSchedule] = useState<PendingMatch[]>([])
  const [scheduleQuality, setScheduleQuality] = useState<{ runtimeMs: number, timedOut: boolean, fallbackUsed: boolean } | undefined>()
  const [scheduledPlayers, setScheduledPlayers] = useState<ArrangementPlayer[]>([])
  const [sittingOutPlayers, setSittingOutPlayers] = useState<string[]>([]) // player IDs sitting out
  const [localScores, setLocalScores] = useState<Record<string, { a: number, b: number }>>({})
  const [updatingPlayerId, setUpdatingPlayerId] = useState<string | null>(null)
  const [playerStatusOverrides, setPlayerStatusOverrides] = useState<Record<string, 'present' | 'no_show'>>({})

  const setScheduleSetupPageOpen = (isOpen: boolean) => {
    setShowScheduleSetupPage(isOpen)
    onScheduleSetupPageChange?.(isOpen)
  }

  useEffect(() => {
    if (scheduleSetupBackSignal <= 0) return
    setShowScheduleSetupPage(false)
    setShowInlineTeamArrangement(false)
  }, [scheduleSetupBackSignal])

  useEffect(() => {
    if (!initialScheduleSetupOpen || isAfterEnd) return
    setShowScheduleSetupPage(true)
    onScheduleSetupPageChange?.(true)
  }, [initialScheduleSetupOpen, isAfterEnd, onScheduleSetupPageChange])

  // Sync local scores when matches change, but carefully to avoid flickering
  useEffect(() => {
    const newScores: Record<string, { a: number, b: number }> = {}
    matches.forEach(m => {
      if (m.status === 'playing' || m.status === 'finished') {
        newScores[m.id] = { a: m.score_a || 0, b: m.score_b || 0 }
      }
    })
    setLocalScores(prev => {
      const hasChanged = Object.keys(newScores).some(id => 
        !prev[id] || prev[id].a !== newScores[id].a || prev[id].b !== newScores[id].b
      )
      return hasChanged ? newScores : prev
    })
  }, [matches])

  useEffect(() => {
    setPlayerStatusOverrides(prev => {
      const next = { ...prev }
      let changed = false
      players.forEach(player => {
        const id = String(player.id)
        if (next[id] && player.checkInStatus === next[id]) {
          delete next[id]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [players])

  useEffect(() => {
    if (fullRotationSchedule.length === 0 && matches.some(m => m.players_snapshot?.rotation)) {
      const restored = matches
        .filter(m => m.players_snapshot?.rotation)
        .map(m => {
          const snapshot = (m.players_snapshot || {}) as any
          return {
            teamA: snapshot.team_a || [],
            teamB: snapshot.team_b || [],
            rotation: snapshot.rotation,
            court: snapshot.court,
            sitterId: snapshot.sitter_id
          }
        })
        .sort((a, b) => (a.rotation || 0) - (b.rotation || 0) || (a.court || 0) - (b.court || 0));
      if (restored.length > 0) {
        setFullRotationSchedule(restored);
        // Also ensure scheduledPlayers is populated
        const allIds = new Set<string>();
        restored.forEach(r => {
          r.teamA.forEach((id: string) => allIds.add(id));
          r.teamB.forEach((id: string) => allIds.add(id));
          if (r.sitterId) r.sitterId.split(',').forEach((id: string) => allIds.add(id));
        });
        const stableList = players
          .filter(p => allIds.has(String(p.id)))
          .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
        setScheduledPlayers(stableList);
      }
    }
  }, [matches, fullRotationSchedule.length, players]);

  const activeMatches = matches.filter(m => m.status === 'playing')
  const historyMatches = matches.filter(m => m.status === 'finished' || m.status === 'cancelled')

  const teamGroups = players.reduce((acc, p) => {
    const t = String(p.team || '0')
    if (t !== '0') {
      if (!acc[t]) acc[t] = []
      acc[t].push(p)
    }
    return acc
  }, {} as Record<string, ArrangementPlayer[]>)

  const teamIds = Object.keys(teamGroups).sort((a, b) => Number(a) - Number(b))
  const fixedTeamIds = teamIds.filter(teamId => (teamGroups[teamId] || []).length === 2)

  const effectivePlayers = useMemo(() => {
    return players.map(player => {
      const override = playerStatusOverrides[String(player.id)]
      return override ? { ...player, checkInStatus: override } : player
    })
  }, [playerStatusOverrides, players])

  const activePlayers = effectivePlayers.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show')

  const getMatchPlayerNames = (snapshotUids: string[]) => {
    if (!snapshotUids || snapshotUids.length === 0) return 'Đang cập nhật'
    return snapshotUids
      .map(uid => players.find(p => p.id === uid)?.name || 'Người chơi')
      .sort((a, b) => a.localeCompare(b))
      .join(' & ')
  }

  const handleGenerateFixedSchedule = () => {
    const X = activePlayers.length
    if (X < 4) {
      const msg = `Cần ít nhất 4 người để tạo lịch (hiện có ${X}).`
      if (Platform.OS === 'web') window.alert(msg)
      else Alert.alert('Yêu cầu thêm người', msg)
      return
    }

    const effectiveCourts = Math.min(Math.max(1, Math.floor(scheduleCourtCount || 1)), Math.floor(X / 4))

    const performGeneration = async () => {
      try {
        setSubmitting(true)
        const sortedPlayers = [...activePlayers].sort((a, b) =>
          a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))
        )
        setScheduledPlayers(sortedPlayers)

        const generated = await buildRoundRobinDoublesScheduleAsync(
          sortedPlayers.map(p => String(p.id)),
          effectiveCourts,
          undefined,
          scheduleMode === 'limited'
            ? { minGamesPerPlayer, priority: schedulePriority, maxRuntimeMs: 2_000 }
            : { priority: 'balanced', maxRuntimeMs: 1_500 }
        )
        const schedule: PendingMatch[] = generated.matches.map(match => ({
          teamA: match.teamA,
          teamB: match.teamB,
          rotation: match.rotation,
          court: match.court,
          sitterId: match.sitterIds.join(',')
        }))

        setPendingRoundRobinMatches([])
        setPendingRoundRobinMatches(schedule)
        setFullRotationSchedule(schedule)
        setScheduleQuality(generated.quality)
        setShowRotationTable(true)
        const qualityNote = generated.quality?.timedOut
          ? `\nLưu ý: thuật toán đã dừng sau ${Math.round(generated.quality.runtimeMs)}ms để tránh treo UI.`
          : ''
        const successMsg = `Đã tạo thành công ${schedule.length} trận xoay vòng cho ${X} người trên ${generated.courtsPerRound} sân.${qualityNote}`
        if (Platform.OS === 'web') window.alert(successMsg)
        else Alert.alert('Thành công', successMsg)
      } catch (error: any) {
        if (Platform.OS === 'web') window.alert('Lỗi: ' + error.message)
        else Alert.alert('Lỗi thuật toán', error.message)
      } finally {
        setSubmitting(false)
      }
    }

    const rawLimitedMatches = Math.ceil((X * Math.min(minGamesPerPlayer, X - 1)) / 4)
    const expectedMatches = scheduleMode === 'limited'
      ? rawLimitedMatches
      : Math.ceil((X * (X - 1)) / 4)
    const modeLabel = scheduleMode === 'limited' ? `ít nhất ${minGamesPerPlayer} trận/người` : 'xoay vòng đầy đủ'
    const confirmMsg = `Tạo lịch ${modeLabel} cho ${X} người trên ${effectiveCourts} sân (${expectedMatches} trận dự kiến)?`
    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) performGeneration()
    } else {
      Alert.alert('Xác nhận', confirmMsg, [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Đồng ý', onPress: performGeneration }
      ])
    }
  }

  const finishedMatches = matches.filter(m => m.status === 'finished')

  // Helper to safely get players from snapshot (handles both Object and String/JSON)
  const getPlayersFromSnapshot = (snapshot: any): { team_a: string[], team_b: string[] } => {
    try {
      if (!snapshot) return { team_a: [], team_b: [] }
      const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot
      return {
        team_a: (parsed.team_a || []).map((id: any) => String(id)),
        team_b: (parsed.team_b || []).map((id: any) => String(id))
      }
    } catch (e) {
      return { team_a: [], team_b: [] }
    }
  }

  // Count total matches played per player (ONLY playing or finished)
  const matchesPlayed = new Map<string, number>()
  activePlayers.forEach(p => matchesPlayed.set(String(p.id), 0))
  finishedMatches.forEach(m => {
    const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
    const all = [...team_a, ...team_b]
    all.forEach(pid => {
      if (matchesPlayed.has(pid)) {
        matchesPlayed.set(pid, (matchesPlayed.get(pid) ?? 0) + 1)
      }
    })
  })

  // Maps to track encounters (using safe snapshot)
  const metMap = new Map<string, Set<string>>()
  const partnerMap = new Map<string, Set<string>>()
  activePlayers.forEach(p => {
    metMap.set(String(p.id), new Set())
    partnerMap.set(String(p.id), new Set())
  })

  finishedMatches.forEach(m => {
    const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
    
    if (team_a.length === 2) {
      partnerMap.get(team_a[0])?.add(team_a[1])
      partnerMap.get(team_a[1])?.add(team_a[0])
    }
    if (team_b.length === 2) {
      partnerMap.get(team_b[0])?.add(team_b[1])
      partnerMap.get(team_b[1])?.add(team_b[0])
    }

    team_a.forEach(pid => {
      team_b.forEach(opponent => {
        if (metMap.has(pid)) metMap.get(pid)!.add(opponent)
        if (metMap.has(opponent)) metMap.get(opponent)!.add(pid)
      })
    })
  })

  const totalPlayers = activePlayers.length
  const getShortName = (playerId: string) => {
    const player = activePlayers.find(p => String(p.id) === String(playerId))
    const name = player?.name?.trim() || 'P'
    return name.split(/\s+/).pop()?.slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase()
  }

  const isRotationComplete = totalPlayers >= 2 && activePlayers.every(p => {
    const partner = partnerMap.get(String(p.id))
    const met = metMap.get(String(p.id))
    return partner && met && partner.size >= totalPlayers - 1 && met.size >= totalPlayers - 1
  })

  // Player with fewest encounters (for progress tracking)
  const playerEncounterCounts = activePlayers.map(p => ({
    id: String(p.id),
    name: p.name,
    partners: partnerMap.get(String(p.id))?.size ?? 0,
    met: metMap.get(String(p.id))?.size ?? 0,
    played: matchesPlayed.get(String(p.id)) ?? 0
  })).sort((a, b) => {
    return a.name.localeCompare(b.name)
  })

  const getPendingMatchPlayerIds = (match: PendingMatch) => [...match.teamA, ...match.teamB].map(String)
  const getPendingMatchKey = (match: PendingMatch) => [
    match.rotation || 0,
    match.court || 0,
    [...match.teamA].map(String).sort().join('-'),
    [...match.teamB].map(String).sort().join('-'),
  ].join('|')

  const underMinPlayerIds = activePlayers
    .filter(p => (matchesPlayed.get(String(p.id)) ?? 0) < minGamesPerPlayer)
    .map(p => String(p.id))

  const underMinPlayerIdSet = new Set(underMinPlayerIds)

  const getManualSwapInfo = (match: PendingMatch) => {
    const matchIds = getPendingMatchPlayerIds(match)
    const requiredIds = matchIds.filter(id => underMinPlayerIdSet.has(id))
    const fillerIds = matchIds.filter(id => !underMinPlayerIdSet.has(id))
    const canShow =
      scheduleMode === 'limited' &&
      underMinPlayerIds.length > 0 &&
      underMinPlayerIds.length < 4 &&
      requiredIds.length > 0 &&
      fillerIds.length > 0

    return { canShow, requiredIds, fillerIds, matchIds }
  }

  const getManualSwapCandidates = (match: PendingMatch, oldPlayerId: string) => {
    const matchIds = new Set(getPendingMatchPlayerIds(match).filter(id => id !== oldPlayerId))
    return activePlayers
      .filter(player => {
        const id = String(player.id)
        return !matchIds.has(id) && !underMinPlayerIdSet.has(id) && (matchesPlayed.get(id) ?? 0) >= minGamesPerPlayer
      })
      .sort((a, b) => {
        const gamesA = matchesPlayed.get(String(a.id)) ?? 0
        const gamesB = matchesPlayed.get(String(b.id)) ?? 0
        if (gamesA !== gamesB) return gamesA - gamesB
        return a.name.localeCompare(b.name)
      })
  }

  const handleReplacePendingPlayer = (matchIndex: number, oldPlayerId: string, newPlayerId: string) => {
    setPendingRoundRobinMatches(prev => prev.map((match, index) => {
      if (index !== matchIndex) return match
      return {
        ...match,
        teamA: match.teamA.map(id => String(id) === oldPlayerId ? newPlayerId : id),
        teamB: match.teamB.map(id => String(id) === oldPlayerId ? newPlayerId : id),
      }
    }))
  }

  const pendingRotationGroups = useMemo(() => {
    const groups = new Map<number, PendingMatch[]>()
    pendingRoundRobinMatches
      .filter(match => match.rotation)
      .forEach(match => {
        const rotation = match.rotation || 0
        const rotationMatches = groups.get(rotation) || []
        rotationMatches.push(match)
        groups.set(rotation, rotationMatches)
      })

    return [...groups.entries()]
      .map(([rotation, rotationMatches]) => ({
        rotation,
        matches: rotationMatches.sort((a, b) => (a.court || 0) - (b.court || 0)),
      }))
      .sort((a, b) => a.rotation - b.rotation)
  }, [pendingRoundRobinMatches])

  const sortedActiveMatches = useMemo(() => {
    return [...activeMatches].sort((a, b) => {
      const rotationA = a.players_snapshot?.rotation || 0
      const rotationB = b.players_snapshot?.rotation || 0
      if (rotationA !== rotationB) return rotationA - rotationB
      const courtA = a.players_snapshot?.court || (a as any).court_no || 0
      const courtB = b.players_snapshot?.court || (b as any).court_no || 0
      if (courtA !== courtB) return courtA - courtB
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
  }, [activeMatches])

  const pendingRoundCount = pendingRotationGroups.length || (pendingRoundRobinMatches.length > 0 ? 1 : 0)

  const scheduleNeedsRefresh = useMemo(() => {
    if (pendingRoundRobinMatches.length === 0 && fullRotationSchedule.length === 0) return false
    const activeIds = new Set(activePlayers.map(player => String(player.id)))
    const scheduleIds = new Set<string>()
    const scheduleSource = pendingRoundRobinMatches.length > 0 ? pendingRoundRobinMatches : fullRotationSchedule

    scheduleSource.forEach(match => {
      match.teamA.forEach(id => scheduleIds.add(String(id)))
      match.teamB.forEach(id => scheduleIds.add(String(id)))
    })

    if ([...scheduleIds].some(id => !activeIds.has(id))) return true
    if (scheduledPlayers.length > 0 && activeIds.size !== scheduledPlayers.length) return true
    if (scheduledPlayers.some(player => !activeIds.has(String(player.id)))) return true
    return false
  }, [activePlayers, fullRotationSchedule, pendingRoundRobinMatches, scheduledPlayers])

  const handleSetPlayerAvailability = async (playerId: string, status: 'present' | 'no_show') => {
    if (isAfterEnd) return
    const previousStatus = effectivePlayers.find(player => String(player.id) === playerId)?.checkInStatus
    setPlayerStatusOverrides(prev => ({ ...prev, [playerId]: status }))
    setUpdatingPlayerId(playerId)
    const { error } = await supabase
      .from('session_players')
      .update({ check_in_status: status })
      .eq('session_id', sessionId)
      .eq('player_id', playerId)

    setUpdatingPlayerId(null)
    if (error) {
      setPlayerStatusOverrides(prev => {
        const next = { ...prev }
        if (previousStatus === 'present' || previousStatus === 'no_show') {
          next[playerId] = previousStatus
        } else {
          delete next[playerId]
        }
        return next
      })
      Alert.alert('Lỗi', 'Không thể cập nhật người chơi.')
      return
    }
    onUpdated()
  }

  const handleUpdateScore = async (matchId: string, team: 'a' | 'b', delta: number) => {
    if (isAfterEnd) return
    const currentScore = localScores[matchId]?.[team] ?? 0
    const newScore = Math.max(0, currentScore + delta)

    // Optimistic Update
    setLocalScores(prev => ({
      ...prev,
      [matchId]: { ...prev[matchId], [team]: newScore }
    }))

    const { error } = await supabase
      .from('session_matches')
      .update({ [team === 'a' ? 'score_a' : 'score_b']: newScore, updated_at: new Date().toISOString() })
      .eq('id', matchId)

    if (error) {
      // Rollback on error
      setLocalScores(prev => ({
        ...prev,
        [matchId]: { ...prev[matchId], [team]: currentScore }
      }))
      Alert.alert('Lỗi', 'Không thể cập nhật điểm số')
    } else {
      onUpdated()
    }
  }

  const handleFinishMatch = async (matchId: string) => {
    if (isAfterEnd) return
    setSubmitting(true)
    const { error } = await supabase
      .from('session_matches')
      .update({ status: 'finished', updated_at: new Date().toISOString() })
      .eq('id', matchId)

    setSubmitting(false)
    if (!error) onUpdated()
  }

  const handleCancelMatch = async (matchId: string) => {
    if (isAfterEnd) return
    const performCancel = async () => {
      setSubmitting(true)
      const { error } = await supabase
        .from('session_matches')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', matchId)

      setSubmitting(false)
      if (error) {
        Alert.alert('Lỗi', 'Không thể hủy trận đấu.')
      } else {
        onUpdated()
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm('Hủy trận đấu này?')) await performCancel()
    } else {
      Alert.alert('Xác nhận', 'Hủy trận đấu này?', [
        { text: 'QUAY LẠI', style: 'cancel' },
        { text: 'HỦY TRẬN', style: 'destructive', onPress: performCancel }
      ])
    }
  }

  const handleCreateMatch = async (teamA: number, teamB: number) => {
    if (isAfterEnd) return
    setSubmitting(true)
    const { error } = await supabase.from('session_matches').insert({
      session_id: sessionId,
      team_a_no: teamA,
      team_b_no: teamB,
      players_snapshot: {
        team_a: teamGroups[String(teamA)]?.map(p => p.id) || [],
        team_b: teamGroups[String(teamB)]?.map(p => p.id) || []
      },
      status: 'playing'
    })
    setSubmitting(false)
    if (!error) onUpdated()
  }

  const getTeamSkill = (teamNo: number) => {
    const members = teamGroups[String(teamNo)] || []
    if (members.length === 0) return 0
    return members.reduce((sum, p) => sum + (Number(p.pvna || (p.elo / 100) || 0)), 0)
  }

  const getPlayerNames = (teamNo: number) => teamGroups[String(teamNo)]?.map(p => p.name).join(' - ') || `Đội ${teamNo}`

  const handleApplyFixedDraftSchedule = (payload: {
    players: ArrangementPlayer[]
    quality: { runtimeMs: number, timedOut: boolean, fallbackUsed: boolean }
    mode: 'full' | 'limited'
    minGames: number
  }) => {
    const schedule: PendingMatch[] = payload.matches.map(match => ({
      teamA: match.teamA,
      teamB: match.teamB,
      teamANo: match.teamANo,
      teamBNo: match.teamBNo,
      rotation: match.rotation,
      court: match.court,
    }))

    setScheduledPlayers(payload.players)
    setPendingRoundRobinMatches(schedule)
    setFullRotationSchedule(schedule)
    setSittingOutPlayers([])
    setScheduleQuality(payload.quality)
    setAppliedScheduleMode(payload.mode)
    setAppliedMinGames(payload.minGames)
    setShowRotationTable(true)
    setShowInlineTeamArrangement(false)
  }



  const handleGenerateRoundRobinRound = () => {
    if (isAfterEnd) return
    
    // 1. Identify who is TRULY available
    const busyFromDb = new Set(matches
      .filter(m => m.status === 'playing' || String(m.status) === 'pending')
      .flatMap(m => {
        const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
        return [...team_a, ...team_b]
      })
    )
    const alreadyPendingIds = new Set(pendingRoundRobinMatches.flatMap(m => [
      ...m.teamA.map(pid => String(pid)), 
      ...m.teamB.map(pid => String(pid))
    ]))
    
    const trulyAvailable = activePlayers.filter(p => {
      const sid = String(p.id)
      return !busyFromDb.has(sid) && !alreadyPendingIds.has(sid)
    })

    if (trulyAvailable.length < 4) {
      Alert.alert('Hết người rảnh', 'Tất cả mọi người đều đang thi đấu hoặc đã có lịch chờ.')
      return
    }

    // 2. Projected Matches Calculation
    const projectedMatches = new Map<string, number>()
    activePlayers.forEach(p => projectedMatches.set(String(p.id), matchesPlayed.get(String(p.id)) ?? 0))
    
    pendingRoundRobinMatches.forEach(m => {
      [...m.teamA, ...m.teamB].forEach(pid => {
        const sid = String(pid)
        if (projectedMatches.has(sid)) {
          projectedMatches.set(sid, (projectedMatches.get(sid) ?? 0) + 1)
        }
      })
    })

    // 3. Hard Match-Gap Filter (Priority #1)
    const checkedInPlayers = activePlayers.filter(p => p.checkInStatus === 'checked_in')
    const referenceGroup = checkedInPlayers.length > 0 ? checkedInPlayers : activePlayers
    const allProjectedCounts = referenceGroup.map(p => projectedMatches.get(String(p.id)) ?? 0)
    const globalMinMatches = Math.min(...allProjectedCounts)
    
    // Only allow people who won't violate the Match Gap-1 rule
    const allowedByMatch = trulyAvailable.filter(p => {
      const pCount = projectedMatches.get(String(p.id)) ?? 0
      return pCount <= globalMinMatches + 1
    })

    if (allowedByMatch.length < 4) {
      Alert.alert('Chờ cân bằng', 'Cần đợi một số người đánh xong để đảm bảo khoảng cách trận đấu không quá 1.')
      return
    }

    // 4. Secondary Sorting: Prioritize Encounter Balance (Soft Constraint)
    const allMetCounts = referenceGroup.map(p => metMap.get(String(p.id))?.size ?? 0)
    const globalMinMet = Math.min(...allMetCounts)
    
    const sortedAllowed = [...allowedByMatch].sort((a, b) => {
      const sA = String(a.id); const sB = String(b.id)
      
      // Tier 1: Matches Played (Lower is better)
      const countA = projectedMatches.get(sA) ?? 0
      const countB = projectedMatches.get(sB) ?? 0
      if (countA !== countB) return countA - countB
      
      // Tier 2: Encounter Gap (If someone is already >2 ahead of the minimum, they get lower priority)
      const metA = metMap.get(sA)?.size ?? 0
      const metB = metMap.get(sB)?.size ?? 0
      const isOverA = metA > globalMinMet + 2
      const isOverB = metB > globalMinMet + 2
      if (isOverA !== isOverB) return isOverA ? 1 : -1
      
      // Tier 3: Absolute number of encounters
      if (metA !== metB) return metA - metB
      
      return Math.random() - 0.5
    })
    
    // Pick the most urgent seed
    const seedPlayer = sortedAllowed[0]
    const others = sortedAllowed.slice(1)
    
    // We want to pick 3 people from 'others' who have NOT met seedPlayer
    const seedMet = metMap.get(String(seedPlayer.id))
    const notMetOthers = others.filter(o => !seedMet?.has(String(o.id)))
    const metOthers = others.filter(o => seedMet?.has(String(o.id)))
    
    // Take as many as possible from notMetOthers, fill the rest from metOthers
    const finalFour = [seedPlayer, ...notMetOthers.slice(0, 3)]
    if (finalFour.length < 4) {
      finalFour.push(...metOthers.slice(0, 4 - finalFour.length))
    }
    
    let bestMatch: PendingMatch = { teamA: [], teamB: [] }
    let lowestMatchScore = Infinity

    // Try 200 combinations within these 4 specific people to find the best teams
    for (let i = 0; i < 200; i++) {
      const shuffle = [...finalFour].sort(() => Math.random() - 0.5)
      const teamA = [shuffle[0].id, shuffle[1].id]
      const teamB = [shuffle[2].id, shuffle[3].id]
      
      let score = 0
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          if (!metMap.get(pA)?.has(pB)) score -= 1000 
          else score += 1
        })
      })
      if (partnerMap.get(teamA[0])?.has(teamA[1])) score += 50
      if (partnerMap.get(teamB[0])?.has(teamB[1])) score += 50

      if (score < lowestMatchScore) {
        lowestMatchScore = score
        bestMatch = { teamA, teamB }
      }
    }

    setPendingRoundRobinMatches(prev => [...prev, bestMatch])
    const newPendingIds = new Set([...alreadyPendingIds, ...bestMatch.teamA, ...bestMatch.teamB])
    const sittingOut = activePlayers.filter(p => {
      const sid = String(p.id)
      return !busyFromDb.has(sid) && !newPendingIds.has(sid)
    }).map(p => p.id)
    setSittingOutPlayers(sittingOut)
  }

  const handleConfirmRoundRobinMatch = async (match: PendingMatch) => {
    setSubmitting(true)
    const { error } = await supabase.from('session_matches').insert({
      session_id: sessionId,
      team_a_no: match.teamANo || 0,
      team_b_no: match.teamBNo || 0,
      court_no: match.court,
      status: 'playing',
      players_snapshot: { 
        team_a: match.teamA, 
        team_b: match.teamB,
        rotation: match.rotation,
        court: match.court,
        sitter_id: match.sitterId
      }
    })
    setSubmitting(false)
    if (error) {
      Alert.alert('Lỗi', 'Không thể bắt đầu trận đấu')
    } else {
      setPendingRoundRobinMatches(prev => prev.filter(m => m.teamA !== match.teamA || m.teamB !== match.teamB))
      onUpdated()
    }
  }

  const handleConfirmRotationMatches = async (rotationMatches: PendingMatch[]) => {
    if (rotationMatches.length === 0 || isAfterEnd) return
    setSubmitting(true)
    const insertData = rotationMatches.map(match => ({
      session_id: sessionId,
      team_a_no: match.teamANo || 0,
      team_b_no: match.teamBNo || 0,
      court_no: match.court,
      status: 'playing',
      players_snapshot: {
        team_a: match.teamA,
        team_b: match.teamB,
        rotation: match.rotation,
        court: match.court,
        sitter_id: match.sitterId
      }
    }))
    const { error } = await supabase.from('session_matches').insert(insertData)
    setSubmitting(false)

    if (error) {
      Alert.alert('Lỗi', 'Không thể bắt đầu lượt đấu này')
    } else {
      const startedKeys = new Set(rotationMatches.map(getPendingMatchKey))
      setPendingRoundRobinMatches(prev => prev.filter(match => !startedKeys.has(getPendingMatchKey(match))))
      onUpdated()
    }
  }

  const renderScheduleSetupContent = () => (
    <>
      <MatchPlayerManagementPanel
        players={effectivePlayers}
        scheduledPlayers={scheduledPlayers}
        hasPendingSchedule={pendingRoundRobinMatches.length > 0 || fullRotationSchedule.length > 0}
        needsScheduleRefresh={scheduleNeedsRefresh}
        updatingPlayerId={updatingPlayerId}
        onSetPlayerStatus={handleSetPlayerAvailability}
        onRegenerateSchedule={isRoundRobinMode ? handleGenerateFixedSchedule : () => setShowInlineTeamArrangement(true)}
      />

      {isRoundRobinMode ? (
        <ScheduleSetupPanel
          activePlayerCount={activePlayers.length}
          defaultCourtCount={courtCount}
          scheduleMode={scheduleMode}
          onScheduleModeChange={setScheduleMode}
          schedulePriority={schedulePriority}
          onSchedulePriorityChange={setSchedulePriority}
          minGamesPerPlayer={minGamesPerPlayer}
          onMinGamesPerPlayerChange={setMinGamesPerPlayer}
          scheduleCourtCount={scheduleCourtCount}
          onScheduleCourtCountChange={setScheduleCourtCount}
        />
      ) : (
        <View style={{ marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => router.push(`/host/session/${sessionId}/one-click-optimization` as any)}
            disabled={activePlayers.length < 4}
            style={{
              backgroundColor: activePlayers.length >= 4 ? '#12352F' : '#9CA3AF',
              borderRadius: RADIUS.lg,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: activePlayers.length >= 4 ? 1 : 0.65,
              ...LAYOUT_SHADOW.sm,
            }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#FFF5DE', fontWeight: '900' }}>
              TỐI ƯU TỰ ĐỘNG 1-CLICK
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowInlineTeamArrangement(true)}
            style={{ marginTop: 10, backgroundColor: 'white', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: '#D8D3C8', paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
          >
            <LayoutDashboard size={16} color="#1A2E2A" />
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '900' }}>
              Tạo / chỉnh thủ công
            </Text>
          </TouchableOpacity>
          {false && <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864', lineHeight: 16 }}>
            Chế độ cố định dùng các đội đã xếp sẵn. Cần số người chẵn để tạo lịch giữa các đội.
          </Text>}
          {false && <TouchableOpacity
            onPress={() => setShowInlineTeamArrangement(true)}
            style={{ marginTop: 10, backgroundColor: 'white', borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#0F6E56', paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
          >
            <LayoutDashboard size={16} color="#0F6E56" />
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
              TẠO / CHỈNH CẶP & XEM LỊCH NHÁP
            </Text>
          </TouchableOpacity>}
          {false && <TouchableOpacity
            onPress={() => router.push(`/host/session/${sessionId}/one-click-optimization` as any)}
            disabled={activePlayers.length < 4}
            style={{
              marginTop: 8,
              backgroundColor: activePlayers.length >= 4 ? '#12352F' : '#9CA3AF',
              borderRadius: RADIUS.md,
              paddingVertical: 11,
              alignItems: 'center',
              opacity: activePlayers.length >= 4 ? 1 : 0.65,
            }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#FFF5DE', fontWeight: '900' }}>
              TỐI ƯU TỰ ĐỘNG 1-CLICK
            </Text>
          </TouchableOpacity>}
        </View>
      )}

      {false && isRoundRobinMode && (
      <TouchableOpacity
        onPress={isRoundRobinMode ? handleGenerateFixedSchedule : () => setShowInlineTeamArrangement(true)}
        disabled={submitting || activePlayers.length < 4}
        style={{
          backgroundColor: activePlayers.length >= 4 ? '#2563EB' : '#64748b',
          borderRadius: RADIUS.lg,
          paddingVertical: 13,
          alignItems: 'center',
          opacity: submitting ? 0.65 : 1,
          marginTop: 4,
          marginBottom: 16,
        }}
      >
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
          {isRoundRobinMode
            ? activePlayers.length >= 4 ? `TẠO LỊCH XOAY VÒNG (${activePlayers.length})` : `CẦN >= 4 NGƯỜI (${activePlayers.length})`
            : activePlayers.length >= 4
              ? fixedTeamIds.length >= 2 ? `XEM / ÁP DỤNG LỊCH CỐ ĐỊNH (${fixedTeamIds.length} ĐỘI)` : 'TẠO CẶP & LỊCH NHÁP'
              : `CẦN >= 4 NGƯỜI (${activePlayers.length})`}
        </Text>
      </TouchableOpacity>
      )}

      {false && isRoundRobinMode && (
      <MatchControlSection
        title="CHI TIẾT THUẬT TOÁN"
        subtitle="Mở khi cần kiểm tra độ phủ (coverage), thời gian chạy (runtime) và chất lượng lịch."
        expanded={showScheduleDiagnostics}
        onToggle={() => setShowScheduleDiagnostics(value => !value)}
      >
        <ScheduleCoverageReport
          players={scheduledPlayers.length > 0 ? scheduledPlayers : activePlayers}
          schedule={pendingRoundRobinMatches.length > 0 ? pendingRoundRobinMatches : fullRotationSchedule}
          mode={appliedScheduleMode}
          minGamesPerPlayer={appliedMinGames}
          quality={scheduleQuality}
          variant={isRoundRobinMode ? 'round-robin' : 'fixed'}
        />
      </MatchControlSection>
      )}
    </>
  )

  if (showScheduleSetupPage && !isAfterEnd) {
    if (showInlineTeamArrangement) {
      return (
        <View style={{ flex: 1, backgroundColor: 'white' }}>
          <TouchableOpacity
            onPress={() => setShowInlineTeamArrangement(false)}
            style={{ alignSelf: 'flex-start', backgroundColor: '#F5F1E8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, margin: 20, marginBottom: 0, borderWidth: 1, borderColor: '#E5E3DC' }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
              ← QUAY LẠI THIẾT LẬP LỊCH
            </Text>
          </TouchableOpacity>
          <TeamArrangementScreen
            sessionId={sessionId}
            players={activePlayers}
            maxPlayers={maxPlayers || players.length}
            courtCount={scheduleCourtCount}
            onUpdated={onUpdated}
            onClose={() => setShowInlineTeamArrangement(false)}
            onApplySchedule={handleApplyFixedDraftSchedule}
            isAfterEnd={isAfterEnd}
          />
        </View>
      )
    }

    return (
      <View style={{ flex: 1, backgroundColor: 'white' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ display: 'none' }}>
          <TouchableOpacity
            onPress={() => setScheduleSetupPageOpen(false)}
            style={{ alignSelf: 'flex-start', backgroundColor: '#F5F1E8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16, borderWidth: 1, borderColor: '#E5E3DC' }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
              ← QUAY LẠI QUẢN LÝ TRẬN
            </Text>
          </TouchableOpacity>
          </View>

          <View style={{ backgroundColor: '#1A2E2A', borderRadius: RADIUS.xl, padding: 16, marginBottom: 16 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: 'white', fontWeight: '900' }}>
              THIẾT LẬP LỊCH TRẬN
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#DDEBE4', marginTop: 4 }}>
              Cập nhật người chơi, chế độ chơi, số sân và tạo lại lịch khi có thay đổi.
            </Text>
          </View>

          {renderScheduleSetupContent()}
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {__DEV__ && (
          <TouchableOpacity
            onPress={async () => {
              try {
                const { error } = await supabase.from('session_matches').delete().eq('session_id', sessionId)
                if (error) throw error
                onUpdated()
                if (Platform.OS === 'web') window.alert('Đã xóa toàn bộ lịch sử trận.')
                else Alert.alert('OK', 'Đã xóa toàn bộ lịch sử trận.')
              } catch (e: any) {
                Alert.alert('Lỗi', e.message)
              }
            }}
            style={{
              alignSelf: 'flex-end', marginBottom: 8,
              paddingHorizontal: 8, paddingVertical: 4,
              backgroundColor: '#fee2e2', borderRadius: 4,
              borderWidth: 1, borderColor: '#fca5a5'
            }}
          >
            <Text style={{ fontSize: 10, color: '#dc2626', fontWeight: '700' }}>🗑 RESET TRẬN</Text>
          </TouchableOpacity>
        )}
        {!isAfterEnd && (
          <View style={{ marginBottom: 32 }}>
            <MatchControlHeader
              activePlayerCount={activePlayers.length}
              liveMatchCount={activeMatches.length}
              pendingMatchCount={pendingRoundRobinMatches.length}
              pendingRoundCount={pendingRoundCount}
              courtCount={Math.min(Math.max(1, Math.floor(scheduleCourtCount || 1)), Math.max(1, Math.floor(activePlayers.length / 4)))}
            />

              {false && <TouchableOpacity
                onPress={() => setScheduleSetupPageOpen(true)}
                style={{
                  backgroundColor: scheduleNeedsRefresh ? '#A05A16' : '#0F6E56',
                  borderRadius: RADIUS.lg,
                  paddingVertical: 13,
                  alignItems: 'center',
                  marginBottom: 16,
                  ...LAYOUT_SHADOW.sm,
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: 'white', fontWeight: '900' }}>
                  {scheduleNeedsRefresh ? 'CẬP NHẬT LỊCH TRẬN' : 'THIẾT LẬP / CẬP NHẬT LỊCH TRẬN'}
                </Text>
              </TouchableOpacity>}
              {fullRotationSchedule.length > 0 && (
                <TouchableOpacity 
                  onPress={() => setShowRotationTable(!showRotationTable)}
                  style={{ 
                    backgroundColor: '#F5F1E8', 
                    padding: 12, 
                    borderRadius: RADIUS.md, 
                    marginBottom: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#E5E3DC'
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A' }}>
                    {showRotationTable ? 'Ẩn bảng tiến độ' : 'Xem bảng tiến độ xoay vòng'}
                  </Text>
                </TouchableOpacity>
              )}

              {showRotationTable && fullRotationSchedule.some(m => m.rotation) && (
                <View style={{ backgroundColor: '#F9F8F4', borderRadius: RADIUS.lg, padding: 12, marginBottom: 24, borderWidth: 1, borderColor: '#E5E3DC' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#1A2E2A', marginBottom: 12, textAlign: 'center' }}>
                    BẢNG LỊCH ĐẤU CHI TIẾT ({scheduledPlayers.length} NGƯỜI)
                  </Text>
                  
                  {(() => {
                    const totalRotations = Math.max(0, ...fullRotationSchedule.map(m => m.rotation || 0));
                    const courtsInSchedule = Math.max(1, ...fullRotationSchedule.map(m => m.court || 1));

                    return Array.from({ length: totalRotations }).map((_, rIdx) => {
                      const rotationNum = rIdx + 1;
                      const rotationMatches = fullRotationSchedule.filter(m => m.rotation === rotationNum);
                      const sitterIds = rotationMatches.length > 0
                        ? (rotationMatches[0]?.sitterId?.split(',').filter(Boolean) || [])
                        : [];
                      const sitterNames = sitterIds
                        .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name || 'N/A')
                        .sort()
                        .join(', ');

                      return (
                        <View key={rotationNum} style={{ marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', paddingBottom: 8 }}>
                          <View style={{ backgroundColor: '#E1F5EE', padding: 6, borderRadius: 4, marginBottom: 8 }}>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F6E56' }}>
                              Rotation {rotationNum} - {sitterNames ? `${sitterNames} nghỉ` : 'Cả sân cùng đánh'}
                            </Text>
                          </View>

                          <View style={{ gap: 4 }}>
                            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1EFE8', paddingBottom: 4 }}>
                              <Text style={{ flex: 0.5, fontSize: 10, fontWeight: '700', color: '#7A8884' }}>Trận</Text>
                              <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#0F6E56' }}>Đội Xanh</Text>
                              <Text style={{ flex: 0.5, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>vs</Text>
                              <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#1d4ed8' }}>Đội Tím</Text>
                              <Text style={{ flex: 2, fontSize: 10, fontWeight: '700', color: '#B4B2A9', textAlign: 'right' }}>Nghỉ</Text>
                            </View>

                            {rotationMatches.map((m, mIdx) => {
                              const matchNum = (rIdx * courtsInSchedule) + mIdx + 1;
                              const restingNames = scheduledPlayers
                                .filter(p => sitterIds.includes(String(p.id)))
                                .map(p => p.name.split(' ').pop())
                                .sort((a, b) => (a || '').localeCompare(b || ''))
                                .join(', ');

                              return (
                                <View key={mIdx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                                  <Text style={{ flex: 0.5, fontSize: 11, fontWeight: '600' }}>{matchNum}</Text>
                                  <Text style={{ flex: 2, fontSize: 11, color: '#0F6E56' }} numberOfLines={1}>
                                    {m.teamA
                                      .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name.split(' ').pop() || '')
                                      .sort((a, b) => a.localeCompare(b))
                                      .join(', ')}
                                  </Text>
                                  <Text style={{ flex: 0.5, fontSize: 10, color: '#B4B2A9', textAlign: 'center' }}>vs</Text>
                                  <Text style={{ flex: 2, fontSize: 11, color: '#1d4ed8' }} numberOfLines={1}>
                                    {m.teamB
                                      .map(id => scheduledPlayers.find(p => String(p.id) === id)?.name.split(' ').pop() || '')
                                      .sort((a, b) => a.localeCompare(b))
                                      .join(', ')}
                                  </Text>
                                  <Text style={{ flex: 2, fontSize: 9, color: '#7A8884', textAlign: 'right' }} numberOfLines={1}>{restingNames || '-'}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      );
                    });
                  })()}
                </View>              )}

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A' }}>ĐANG DIỄN RA</Text>
              <View style={{
                backgroundColor: activeMatches.length > 0 ? theme?.primary : '#F1EFE8',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4
              }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: activeMatches.length > 0 ? '#E1F5EE' : '#B4B2A9' }} />
                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: activeMatches.length > 0 ? 'white' : '#7A8884' }}>
                  {activeMatches.length} TRẬN LIVE
                </Text>
              </View>
            </View>

            {activeMatches.length === 0 ? (
              <View style={{
                backgroundColor: '#1A2E2A',
                borderRadius: RADIUS.xl,
                height: 200,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 8,
                overflow: 'hidden',
                position: 'relative',
                borderWidth: 1,
                borderColor: '#0F6E5630',
                ...LAYOUT_SHADOW.md
              }}>
                {/* Subtle background pattern or gradient */}
                <View style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: '#8A7A5A',
                  opacity: 0.10
                }} />

                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#FFF5DE',
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 4,
                  marginBottom: 16,
                  gap: 6
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#A05A16' }} />
                  <Text style={{ color: '#854F0B', fontSize: 10, fontFamily: SCREEN_FONTS.headline, letterSpacing: 1.5, fontWeight: '800' }}>PRE-MATCH</Text>
                </View>

                <Text style={{
                  fontFamily: SCREEN_FONTS.headline,
                  fontSize: 22,
                  color: 'white',
                  textAlign: 'center',
                  letterSpacing: 1,
                  fontWeight: '900',
                  textShadowColor: 'rgba(0,0,0,0.3)',
                  textShadowOffset: { width: 0, height: 2 },
                  textShadowRadius: 4
                }}>
                  TRẬN ĐẤU SẮP BẮT ĐẦU
                </Text>

                <Text style={{
                  fontFamily: SCREEN_FONTS.label,
                  fontSize: 12,
                  color: '#E1F5EE',
                  textAlign: 'center',
                  marginTop: 8,
                  opacity: 0.8,
                  letterSpacing: 0.5
                }}>
                  Vui lòng chọn cặp đấu bên dưới để {`"lên sóng"`}
                </Text>

                <View style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 4,
                  backgroundColor: '#0F6E56',
                  opacity: 0.5
                }} />
              </View>
            ) : (
              sortedActiveMatches.map(match => {
                const scoreA = localScores[match.id]?.a ?? match.score_a
                const scoreB = localScores[match.id]?.b ?? match.score_b
                const liveRotation = match.players_snapshot?.rotation
                const liveCourt = match.players_snapshot?.court || (match as any).court_no

                return (
                  <View key={match.id} style={{
                    backgroundColor: 'white',
                    borderRadius: RADIUS.xl,
                    borderWidth: 1,
                    borderColor: '#E5E3DC',
                    marginBottom: 20,
                    overflow: 'hidden',
                    ...LAYOUT_SHADOW.sm
                  }}>
                    {/* Card Header */}
                    <View style={{
                      backgroundColor: '#F5F1E8',
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottomWidth: 1,
                      borderBottomColor: '#E5E3DC'
                    }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0F6E56' }} />
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#0F6E56', fontWeight: '800' }}>TRẬN ĐẤU LIVE</Text>
                        {!!liveCourt && (
                          <View style={{ backgroundColor: 'white', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#D5D2C8' }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', fontWeight: '800' }}>Sân {liveCourt}</Text>
                          </View>
                        )}
                        {!!liveRotation && (
                          <View style={{ backgroundColor: '#E1F5EE', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#0F6E56', fontWeight: '800' }}>Vòng {liveRotation}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ backgroundColor: '#1A2E2A', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.xs }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: 'white', fontWeight: '700' }}>
                          {new Date(match.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    </View>

                    <View style={{ padding: 20 }}>
                      {/* Scoreboard Row */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>

                        {/* Team A Section */}
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Pressable
                              onPress={() => handleUpdateScore(match.id, 'a', -1)}
                              disabled={isAfterEnd}
                              style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center',
                                borderWidth: 1, borderColor: '#E5E3DC',
                                opacity: (pressed || isAfterEnd) ? 0.7 : 1
                              })}
                            >
                              <Minus size={18} color="#7A8884" />
                            </Pressable>

                            <View style={{
                              width: RESPONSIVE_CARD_WIDTH + 10,
                              height: RESPONSIVE_CARD_HEIGHT + 10,
                              backgroundColor: '#F5F1E8',
                              borderRadius: RADIUS.md,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 2,
                              borderColor: scoreA > scoreB ? '#0F6E56' : '#E5E3DC',
                              ...LAYOUT_SHADOW.sm
                            }}>
                              <Text style={{
                                fontFamily: SCREEN_FONTS.headline,
                                fontSize: RESPONSIVE_FONT_SIZE,
                                color: scoreA > scoreB ? '#0F6E56' : '#1A2E2A',
                                fontWeight: '900'
                              }}>{scoreA}</Text>
                            </View>

                            <Pressable
                              onPress={() => handleUpdateScore(match.id, 'a', 1)}
                              disabled={isAfterEnd}
                              style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                backgroundColor: isAfterEnd ? '#E5E3DC' : '#0F6E56', alignItems: 'center', justifyContent: 'center',
                                ...LAYOUT_SHADOW.sm,
                                opacity: (pressed || isAfterEnd) ? 0.8 : 1
                              })}
                            >
                              <Plus size={18} color="white" />
                            </Pressable>
                          </View>
                          {match.team_a_no === 0 ? (
                            <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 8, textAlign: 'center', fontWeight: '700', lineHeight: 18 }}>
                              {getMatchPlayerNames(match.players_snapshot?.team_a || [])}
                            </Text>
                          ) : (
                            <>
                              <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 6, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_a_no}</Text>
                              <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_a_no)}</Text>
                            </>
                          )}
                        </View>

                        {/* VS Divider */}
                        <View style={{ paddingHorizontal: 10, alignItems: 'center' }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: '#B4B2A9', fontWeight: '900' }}>VS</Text>
                        </View>

                        {/* Team B Section */}
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Pressable
                              onPress={() => handleUpdateScore(match.id, 'b', -1)}
                              disabled={isAfterEnd}
                              style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                backgroundColor: '#F5F1E8', alignItems: 'center', justifyContent: 'center',
                                borderWidth: 1, borderColor: '#E5E3DC',
                                opacity: (pressed || isAfterEnd) ? 0.7 : 1
                              })}
                            >
                              <Minus size={18} color="#7A8884" />
                            </Pressable>

                            <View style={{
                              width: RESPONSIVE_CARD_WIDTH + 10,
                              height: RESPONSIVE_CARD_HEIGHT + 10,
                              backgroundColor: '#F5F1E8',
                              borderRadius: RADIUS.md,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 2,
                              borderColor: scoreB > scoreA ? '#0F6E56' : '#E5E3DC',
                              ...LAYOUT_SHADOW.sm
                            }}>
                              <Text style={{
                                fontFamily: SCREEN_FONTS.headline,
                                fontSize: RESPONSIVE_FONT_SIZE,
                                color: scoreB > scoreA ? '#0F6E56' : '#1A2E2A',
                                fontWeight: '900'
                              }}>{scoreB}</Text>
                            </View>

                            <Pressable
                              onPress={() => handleUpdateScore(match.id, 'b', 1)}
                              disabled={isAfterEnd}
                              style={({ pressed }) => ({
                                width: 36, height: 36, borderRadius: 18,
                                backgroundColor: isAfterEnd ? '#E5E3DC' : '#0F6E56', alignItems: 'center', justifyContent: 'center',
                                ...LAYOUT_SHADOW.sm,
                                opacity: (pressed || isAfterEnd) ? 0.8 : 1
                              })}
                            >
                              <Plus size={18} color="white" />
                            </Pressable>
                          </View>
                          {match.team_b_no === 0 ? (
                            <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 8, textAlign: 'center', fontWeight: '700', lineHeight: 18 }}>
                              {getMatchPlayerNames(match.players_snapshot?.team_b || [])}
                            </Text>
                          ) : (
                            <>
                              <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: '#1A2E2A', marginTop: 6, textAlign: 'center', fontWeight: '800' }}>ĐỘI {match.team_b_no}</Text>
                              <Text style={{ fontSize: 9, color: '#7A8884', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>{getPlayerNames(match.team_b_no)}</Text>
                            </>
                          )}
                        </View>
                      </View>

                      {/* Bottom Actions */}
                      {!isAfterEnd && (
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                          <TouchableOpacity
                            onPress={() => handleFinishMatch(match.id)}
                            style={{
                              flex: 2,
                              backgroundColor: '#0F6E56',
                              paddingVertical: 12,
                              borderRadius: RADIUS.lg,
                              alignItems: 'center',
                              justifyContent: 'center',
                              ...LAYOUT_SHADOW.sm
                            }}
                          >
                            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, fontWeight: '800' }}>XÁC NHẬN KẾT QUẢ</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleCancelMatch(match.id)}
                            style={{
                              flex: 1,
                              backgroundColor: '#FAECE7',
                              paddingVertical: 12,
                              borderRadius: RADIUS.lg,
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Text style={{ color: '#D85A30', fontFamily: SCREEN_FONTS.headline, fontSize: 13, fontWeight: '800' }}>HỦY</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )
              })
            )}
          </View>
        )}

        {/* Pending Proposals Preview — shown above tabs when proposals exist */}
        {!isAfterEnd && pendingRoundRobinMatches.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A' }}>
                LƯỢT TRẬN ĐỀ XUẤT
              </Text>
              <TouchableOpacity onPress={() => { setPendingRoundRobinMatches([]); setFullRotationSchedule([]); setSittingOutPlayers([]); setScheduleQuality(undefined) }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884' }}>Xóa tất cả</Text>
              </TouchableOpacity>
            </View>

            {/* Sitting out notice */}
            {sittingOutPlayers.length > 0 && (
              <View style={{ backgroundColor: '#FEF9EE', borderRadius: RADIUS.md, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#F5DFA0', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ fontSize: 14 }}>⏸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#854F0B', marginBottom: 4 }}>
                    NGỒI CHỜ LƯỢT NÀY ({sittingOutPlayers.length} người)
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', lineHeight: 16 }}>
                    {sittingOutPlayers.map(pid => players.find(p => p.id === pid)?.name || pid).join(' · ')}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9', marginTop: 4 }}>
                    Họ sẽ được ưu tiên chơi ở lượt tiếp theo.
                  </Text>
                </View>
              </View>
            )}
            {pendingRotationGroups.length > 0 && (
              <View style={{ backgroundColor: '#E1F5EE', borderRadius: RADIUS.md, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#B7E4D5' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', marginBottom: 8, fontWeight: '900' }}>
                  BẮT ĐẦU THEO VÒNG / NHIỀU SÂN
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {pendingRotationGroups.map(group => (
                    <TouchableOpacity
                      key={group.rotation}
                      onPress={() => handleConfirmRotationMatches(group.matches)}
                      disabled={submitting}
                      style={{
                        backgroundColor: '#0F6E56',
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        opacity: submitting ? 0.7 : 1,
                      }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: 'white', fontWeight: '900' }}>
                        Vòng {group.rotation} ({group.matches.length} sân)
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            {pendingRoundRobinMatches.map((match, idx) => {
              const teamAPlayers = match.teamA
                .map(pid => players.find(p => p.id === pid))
                .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''))
              const teamBPlayers = match.teamB
                .map(pid => players.find(p => p.id === pid))
                .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''))
              const manualSwapInfo = getManualSwapInfo(match)
              const isEditingThisPending = editingPendingIndex === idx
              return (
                <View key={idx} style={{
                  backgroundColor: '#F5F1E8',
                  borderRadius: RADIUS.lg,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: '#E5E3DC',
                  overflow: 'hidden'
                }}>
                  {match.rotation && (
                    <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 12, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#0F6E56', fontWeight: '800' }}>
                        ROTATION {match.rotation} — {
                          match.sitterId?.split(',')
                            .map(id => players.find(p => String(p.id) === id)?.name || 'N/A')
                            .join(', ')
                        } nghỉ
                      </Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      {/* CẶP 1 */}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginBottom: 3 }}>CẶP 1</Text>
                        {teamAPlayers.map((p, i) => (
                          <Text key={i} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }} numberOfLines={1}>
                            {p?.name || 'Người chơi'}
                          </Text>
                        ))}
                      </View>

                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#B4B2A9', marginHorizontal: 10 }}>VS</Text>

                      {/* CẶP 2 */}
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginBottom: 3 }}>CẶP 2</Text>
                        {teamBPlayers.map((p, i) => (
                          <Text key={i} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800', textAlign: 'right' }} numberOfLines={1}>
                            {p?.name || 'Người chơi'}
                          </Text>
                        ))}
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleConfirmRoundRobinMatch(match)}
                      disabled={submitting}
                      style={{
                        backgroundColor: '#0F6E56',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: RADIUS.md,
                        marginLeft: 12,
                        shadowColor: '#0F6E56',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.2,
                        shadowRadius: 4,
                        opacity: submitting ? 0.7 : 1
                      }}
                    >
                      <Text style={{ color: 'white', fontSize: 11, fontFamily: SCREEN_FONTS.headline, fontWeight: '800' }}>BẮT ĐẦU</Text>
                    </TouchableOpacity>
                  </View>
                  {manualSwapInfo.canShow && (
                    <View style={{ borderTopWidth: 1, borderTopColor: '#E5E3DC', padding: 10, backgroundColor: '#FFFCF5' }}>
                      <TouchableOpacity
                        onPress={() => setEditingPendingIndex(isEditingThisPending ? null : idx)}
                        style={{ alignSelf: 'flex-start', backgroundColor: isEditingThisPending ? '#0F6E56' : 'white', borderWidth: 1, borderColor: '#0F6E56', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: isEditingThisPending ? 10 : 0 }}
                      >
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: isEditingThisPending ? 'white' : '#0F6E56', fontWeight: '800' }}>
                          {isEditingThisPending ? 'ĐÓNG CHỈNH NGƯỜI' : 'CHỈNH NGƯỜI ĐÁNH BÙ'}
                        </Text>
                      </TouchableOpacity>

                      {isEditingThisPending && (
                        <View style={{ gap: 10 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', lineHeight: 15 }}>
                            Chỉ hiện khi còn {underMinPlayerIds.length} người chưa đủ tối thiểu. Bạn có thể đổi người đã đủ min nếu họ không muốn đánh thêm.
                          </Text>
                          {manualSwapInfo.fillerIds.map(oldId => {
                            const oldPlayer = activePlayers.find(p => String(p.id) === oldId)
                            const candidates = getManualSwapCandidates(match, oldId)
                            return (
                              <View key={oldId} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 8, borderWidth: 1, borderColor: '#E5E3DC' }}>
                                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#854F0B', marginBottom: 6 }}>
                                  Đổi {oldPlayer?.name || 'người đánh bù'} ({matchesPlayed.get(oldId) ?? 0}/{minGamesPerPlayer}+)
                                </Text>
                                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                                  {candidates.length === 0 ? (
                                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9' }}>Không có người thay phù hợp.</Text>
                                  ) : candidates.map(candidate => {
                                    const candidateId = String(candidate.id)
                                    return (
                                      <TouchableOpacity
                                        key={candidateId}
                                        onPress={() => handleReplacePendingPlayer(idx, oldId, candidateId)}
                                        style={{ backgroundColor: '#F5F1E8', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: '#D5D2C8' }}
                                      >
                                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#1A2E2A', fontWeight: '700' }}>
                                          {candidate.name} ({matchesPlayed.get(candidateId) ?? 0})
                                        </Text>
                                      </TouchableOpacity>
                                    )
                                  })}
                                </View>
                              </View>
                            )
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Round Robin UI */}
        {!isAfterEnd && isRoundRobinMode && (
          <View style={{ marginBottom: 32 }}>
            {/* Rotation Complete Banner */}
            {isRotationComplete && (
              <View style={{
                backgroundColor: '#0F6E56',
                padding: 16,
                borderRadius: RADIUS.xl,
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12
              }}>
                <Text style={{ fontSize: 24 }}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: 'white', fontWeight: '800' }}>
                    VÒNG XOAY HOÀN TẤT!
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#E1F5EE', marginTop: 2 }}>
                    Mọi người đã được đấu cùng nhau ít nhất 1 lần. Có thể tiếp tục thêm lượt hoặc kết thúc buổi đấu.
                  </Text>
                </View>
              </View>
            )}

            {/* Progress: partner/opponent coverage for every player */}
            {!isRotationComplete && finishedMatches.length > 0 && totalPlayers >= 4 && (
              <View style={{ backgroundColor: '#F5F1E8', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16 }}>
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', letterSpacing: 0.5 }}>
                    TIẾN TRÌNH XOAY VÒNG
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
                    Theo dõi từng người: lượt đã đánh, partner unique và đối thủ unique sau khi xác nhận kết quả.
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[
                    { label: 'Đã có', color: '#0F6E56' },
                    { label: 'Chưa có', color: '#E5E3DC' },
                    { label: 'Đối thủ', color: '#2563eb' },
                  ].map(item => (
                    <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'white', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#E5E3DC' }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.color }} />
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', fontWeight: '700' }}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                {(showAllProgress ? playerEncounterCounts : playerEncounterCounts.slice(0, 4)).map(({ id, name, partners, met, played }) => (
                  <View key={id} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#E8E2D6' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <View>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>{name}</Text>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884' }}>
                          {played}/{totalPlayers - 1} trận đã xác nhận
                        </Text>
                      </View>
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: partners >= totalPlayers - 1 && met >= totalPlayers - 1 && played >= totalPlayers - 1 ? '#0F6E56' : '#854F0B', fontWeight: '800' }}>
                        {Math.min(partners, met, played)}/{totalPlayers - 1}
                      </Text>
                    </View>
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ width: 58, fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', fontWeight: '800' }}>Lượt đấu</Text>
                        <View style={{ flex: 1, flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                          {Array.from({ length: totalPlayers - 1 }).map((_, i) => (
                            <View key={i} style={{
                              width: 22, height: 22, borderRadius: 11,
                              backgroundColor: i < played ? '#7c3aed' : '#F1EFE8',
                              borderWidth: 1, borderColor: i < played ? '#7c3aed' : '#D5D2C8',
                              alignItems: 'center', justifyContent: 'center'
                            }}>
                              <Text style={{ fontSize: 8, fontFamily: SCREEN_FONTS.headline, color: i < played ? 'white' : '#B4B2A9', fontWeight: '800' }}>{i + 1}</Text>
                            </View>
                          ))}
                        </View>
                        <Text style={{ width: 34, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: played >= totalPlayers - 1 ? '#7c3aed' : '#854F0B', fontWeight: '800' }}>
                          {played}/{totalPlayers - 1}
                        </Text>
                      </View>
                      {[
                        { label: 'Partner', ids: partnerMap.get(id) ?? new Set<string>(), color: '#0F6E56' },
                        { label: 'Đối thủ', ids: metMap.get(id) ?? new Set<string>(), color: '#2563eb' },
                      ].map(row => (
                        <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ width: 58, fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', fontWeight: '800' }}>{row.label}</Text>
                          <View style={{ flex: 1, flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                            {activePlayers.filter(p => String(p.id) !== id).map(other => {
                              const otherId = String(other.id)
                              const isDone = row.ids.has(otherId)
                              return (
                                <View key={otherId} style={{
                                  width: 22, height: 22, borderRadius: 11,
                                  backgroundColor: isDone ? row.color : '#F1EFE8',
                                  borderWidth: 1, borderColor: isDone ? row.color : '#D5D2C8',
                                  alignItems: 'center', justifyContent: 'center'
                                }}>
                                  <Text style={{ fontSize: 8, fontFamily: SCREEN_FONTS.headline, color: isDone ? 'white' : '#9C968A', fontWeight: '800' }}>
                                    {getShortName(otherId)}
                                  </Text>
                                </View>
                              )
                            })}
                          </View>
                          <Text style={{ width: 34, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: row.ids.size >= totalPlayers - 1 ? row.color : '#854F0B', fontWeight: '800' }}>
                            {row.ids.size}/{totalPlayers - 1}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
                {playerEncounterCounts.length > 4 && (
                  <TouchableOpacity onPress={() => setShowAllProgress(p => !p)} style={{ marginTop: 4, alignItems: 'center', paddingVertical: 4 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56' }}>
                      {showAllProgress ? '▲ Thu gọn' : `▼ Xem tất cả (${playerEncounterCounts.length} người)`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}


            {/* One-Click Button */}
            <View style={{ alignItems: 'center', backgroundColor: 'white', padding: 24, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: '#E5E3DC', borderStyle: 'dashed' }}>
              <SwordsIcon size={32} color="#0F6E56" style={{ marginBottom: 12, opacity: 0.3 }} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', marginBottom: 6, textAlign: 'center' }}>
                ROUND ROBIN
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884', textAlign: 'center', marginBottom: 20, paddingHorizontal: 8 }}>
                {isRotationComplete
                  ? 'Tất cả mọi người đã đấu với nhau rồi! Tiếp tục để bắt đầu vòng mới.'
                  : 'Bốc thăm ngẫu nhiên cặp mới cho tất cả người chơi đang rảnh.'}
              </Text>
              <TouchableOpacity
                onPress={handleGenerateRoundRobinRound}
                disabled={submitting}
                style={{ backgroundColor: '#0F6E56', paddingHorizontal: 24, paddingVertical: 14, borderRadius: RADIUS.lg, width: '100%', alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
              >
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 14, fontWeight: '800' }}>
                  {pendingRoundRobinMatches.length > 0 ? 'ROUND ROBIN' : 'TẠO LƯỢT ROUND ROBIN'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isAfterEnd && isFixedTeamMode && (pendingRoundRobinMatches.length > 0 || fullRotationSchedule.length > 0) && (
          <View style={{ marginBottom: 32 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A' }}>LỊCH THI ĐẤU</Text>
              {false && (() => {
                const canOpenFixedSetup = activePlayers.length >= 4
                return (
                  <TouchableOpacity
                    onPress={canOpenFixedSetup ? () => { setScheduleSetupPageOpen(true); setShowInlineTeamArrangement(true) } : undefined}
                    disabled={!canOpenFixedSetup}
                    style={{ backgroundColor: canOpenFixedSetup ? '#E1F5EE' : '#F0EDE6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, opacity: canOpenFixedSetup ? 1 : 0.6 }}
                  >
                    <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: canOpenFixedSetup ? '#0F6E56' : '#B4B2A9' }}>
                      {canOpenFixedSetup ? '⚡ TẠO / XEM LỊCH NHÁP' : '⚠ CẦN >= 4 NGƯỜI'}
                    </Text>
                  </TouchableOpacity>
                )
              })()}
            </View>

            {/* Odd player warning */}
            {false && players.filter(p => p.status === 'confirmed' && p.checkInStatus !== 'no_show').length % 2 !== 0 && (
              <View style={{ backgroundColor: '#FEF9EE', borderRadius: RADIUS.md, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#F5DFA0' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#854F0B', marginBottom: 4 }}>
                  ⚠ Có người dự bị trong chế độ cố định
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', lineHeight: 16 }}>
                  Người lẻ sẽ không nằm trong cặp cố định/lịch nháp hiện tại. Nếu muốn xoay đều người lẻ, chuyển sang{' '}
                  <Text style={{ color: '#0F6E56', fontWeight: '700' }}>
                    Round Robin
                  </Text>
                  {' '}để xử lý linh hoạt hơn.
                </Text>
              </View>
            )}

            <View style={{ gap: 12 }}>
              {(pendingRoundRobinMatches.length > 0 || fullRotationSchedule.length > 0) && teamIds.map((tA, idx) => teamIds.slice(idx + 1).map(tB => (
                activeMatches.some(m => (m.team_a_no === Number(tA) && m.team_b_no === Number(tB)) || (m.team_a_no === Number(tB) && m.team_b_no === Number(tA))) ? null : (
                  <View key={`${tA}-${tB}`} style={{
                    backgroundColor: '#F5F1E8',
                    borderRadius: RADIUS.lg,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: '#E5E3DC',
                    overflow: 'hidden'
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        {/* Team A Info */}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>ĐỘI {tA}</Text>
                            <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADIUS.xs }}>
                              <Text style={{ fontSize: 9, color: '#0F6E56', fontWeight: '800' }}>{getTeamSkill(Number(tA)).toFixed(2)}</Text>
                            </View>
                          </View>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884' }} numberOfLines={1}>
                            {getPlayerNames(Number(tA))}
                          </Text>
                        </View>

                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#B4B2A9', marginHorizontal: 10 }}>VS</Text>

                        {/* Team B Info */}
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADIUS.xs }}>
                              <Text style={{ fontSize: 9, color: '#0F6E56', fontWeight: '800' }}>{getTeamSkill(Number(tB)).toFixed(2)}</Text>
                            </View>
                            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '800' }}>ĐỘI {tB}</Text>
                          </View>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', textAlign: 'right' }} numberOfLines={1}>
                            {getPlayerNames(Number(tB))}
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => handleCreateMatch(Number(tA), Number(tB))}
                        disabled={submitting}
                        style={{
                          backgroundColor: '#0F6E56',
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: RADIUS.md,
                          marginLeft: 12,
                          shadowColor: '#0F6E56',
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.2,
                          shadowRadius: 4
                        }}
                      >
                        <Text style={{ color: 'white', fontSize: 11, fontFamily: SCREEN_FONTS.headline, fontWeight: '800' }}>BẮT ĐẦU</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              )))}
            </View>
          </View>
        )}

        {historyMatches.length > 0 && (
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', marginBottom: 16 }}>LỊCH SỬ TRẬN ĐẤU</Text>
            {historyMatches.map(match => {
              const isCancelled = match.status === 'cancelled'
              const winner = match.score_a > match.score_b ? 'a' : match.score_b > match.score_a ? 'b' : 'draw'

              return (
                <View key={match.id} style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: RADIUS.lg,
                  padding: 10,
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: '#E5E3DC',
                  ...LAYOUT_SHADOW.xs,
                  opacity: isCancelled ? 0.7 : 1
                }}>
                  {/* Header: Time & Status */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#B4B2A9', fontWeight: '600' }}>
                      {new Date(match.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <View style={{
                      backgroundColor: isCancelled ? '#FDECEA' : '#E1F5EE',
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: RADIUS.xs
                    }}>
                      <Text style={{
                        fontSize: 8,
                        fontWeight: '800',
                        color: isCancelled ? '#D85A30' : '#0F6E56',
                        fontFamily: SCREEN_FONTS.headline,
                        letterSpacing: 0.5
                      }}>
                        {isCancelled ? 'ĐÃ HỦY' : 'HOÀN THÀNH'}
                      </Text>
                    </View>
                  </View>

                  {/* Body: Teams & Scores */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Team A */}
                    <View style={{ flex: 1 }}>
                      {match.team_a_no === 0 ? (
                        <Text style={{
                          fontFamily: SCREEN_FONTS.headline,
                          fontSize: 12,
                          color: winner === 'a' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                          fontWeight: '700',
                          lineHeight: 18
                        }}>{getMatchPlayerNames(match.players_snapshot?.team_a || [])}</Text>
                      ) : (
                        <>
                          <Text style={{
                            fontFamily: SCREEN_FONTS.headline,
                            fontSize: 14,
                            color: winner === 'a' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                            fontWeight: '800'
                          }}>ĐỘI {match.team_a_no}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2 }} numberOfLines={1}>
                            {getPlayerNames(match.team_a_no)}
                          </Text>
                        </>
                      )}
                    </View>

                    {/* Compact Scoreboard */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
                      <View style={{
                        backgroundColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#F5F1E8',
                        width: 34, height: 40, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'a' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: winner === 'a' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_a}</Text>
                      </View>

                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#B4B2A9' }}>—</Text>

                      <View style={{
                        backgroundColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#F5F1E8',
                        width: 34, height: 40, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: winner === 'b' && !isCancelled ? '#0F6E56' : '#E5E3DC'
                      }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: winner === 'b' && !isCancelled ? 'white' : '#1A2E2A', fontWeight: '800' }}>{match.score_b}</Text>
                      </View>
                    </View>

                    {/* Team B */}
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      {match.team_b_no === 0 ? (
                        <Text style={{
                          fontFamily: SCREEN_FONTS.headline,
                          fontSize: 12,
                          color: winner === 'b' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                          fontWeight: '700',
                          textAlign: 'right',
                          lineHeight: 18
                        }}>{getMatchPlayerNames(match.players_snapshot?.team_b || [])}</Text>
                      ) : (
                        <>
                          <Text style={{
                            fontFamily: SCREEN_FONTS.headline,
                            fontSize: 14,
                            color: winner === 'b' && !isCancelled ? '#0F6E56' : '#1A2E2A',
                            fontWeight: '800',
                            textAlign: 'right'
                          }}>ĐỘI {match.team_b_no}</Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 2, textAlign: 'right' }} numberOfLines={1}>
                            {getPlayerNames(match.team_b_no)}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        )}
        {!isAfterEnd && (
          <TouchableOpacity
            onPress={() => setScheduleSetupPageOpen(true)}
            style={{
              backgroundColor: scheduleNeedsRefresh ? '#A05A16' : '#F5F1E8',
              borderRadius: RADIUS.lg,
              paddingVertical: 13,
              alignItems: 'center',
              marginTop: 20,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: scheduleNeedsRefresh ? '#A05A16' : '#D8D3C8',
            }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: scheduleNeedsRefresh ? 'white' : '#1A2E2A', fontWeight: '900' }}>
              {scheduleNeedsRefresh ? 'CẬP NHẬT LỊCH TRẬN' : 'THIẾT LẬP / CẬP NHẬT LỊCH TRẬN'}
            </Text>
          </TouchableOpacity>
        )}
        <BrandedFooter />
      </ScrollView>
    </View>
  )
}
