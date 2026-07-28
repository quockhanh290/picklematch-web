import { useEffect, useMemo, useState } from 'react'
import { Alert, Platform } from 'react-native'

import type { SessionMatch } from '@/hooks/useSessionDetail'
import type { SchedulePriority } from '@/lib/roundRobinScheduler'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import type { ScheduleMode } from '@/features/host/session-detail/ScheduleSetupPanel'
import {
  cancelMatch,
  finishMatch,
  insertMatch,
  insertMatches,
  updateMatchScore,
  updatePlayerAvailability,
} from '@/features/host/session-detail/host-match/api'
import {
  computeEffectiveCourts,
  generateFixedSchedule,
  generateRoundRobinRound,
  sortPlayersForSchedule,
  type GeneratedMatch,
} from '@/features/host/session-detail/host-match/scheduleGenerators'

export type PendingMatch = GeneratedMatch

export type UseHostMatchControllerParams = {
  sessionId: string
  matches: SessionMatch[]
  players: ArrangementPlayer[]
  onUpdated: () => void
  isAfterEnd?: boolean
  courtCount: number
  formatType?: string | null
  onScheduleSetupPageChange?: (isOpen: boolean) => void
  scheduleSetupBackSignal: number
  initialScheduleSetupOpen: boolean
}

export function useHostMatchController({
  sessionId,
  matches,
  players,
  onUpdated,
  isAfterEnd,
  courtCount,
  formatType,
  onScheduleSetupPageChange,
  scheduleSetupBackSignal,
  initialScheduleSetupOpen,
}: UseHostMatchControllerParams) {
  const isRoundRobinMode = formatType === 'round_robin'

  const [submitting, setSubmitting] = useState(false)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('full')
  const [schedulePriority, setSchedulePriority] = useState<SchedulePriority>('balanced')
  const [scheduleCourtCount, setScheduleCourtCount] = useState(Math.max(1, Math.floor(courtCount || 1)))
  const [minGamesPerPlayer, setMinGamesPerPlayer] = useState(4)
  const [showRotationTable, setShowRotationTable] = useState(false)
  const [showScheduleSetupPage, setShowScheduleSetupPage] = useState(false)
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
  void fixedTeamIds // unused, kept for parity with the original screen (dead there too)

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

    const effectiveCourts = computeEffectiveCourts(X, scheduleCourtCount)

    const performGeneration = async () => {
      try {
        setSubmitting(true)
        const sortedPlayers = sortPlayersForSchedule(activePlayers)
        setScheduledPlayers(sortedPlayers)

        const generated = await generateFixedSchedule({
          playerIds: sortedPlayers.map(p => String(p.id)),
          courtCount: effectiveCourts,
          mode: scheduleMode,
          minGamesPerPlayer,
          priority: schedulePriority,
        })
        const schedule: PendingMatch[] = generated.matches

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
    const { error } = await updatePlayerAvailability(sessionId, playerId, status)

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

    const { error } = await updateMatchScore(matchId, team, newScore)

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
    const { error } = await finishMatch(matchId)

    setSubmitting(false)
    if (!error) onUpdated()
  }

  const handleCancelMatch = async (matchId: string) => {
    if (isAfterEnd) return
    const performCancel = async () => {
      setSubmitting(true)
      const { error } = await cancelMatch(matchId)

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
    const { error } = await insertMatch({
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

  const handleGenerateRoundRobinRound = () => {
    if (isAfterEnd) return

    const busyFromDb = new Set(matches
      .filter(m => m.status === 'playing' || String(m.status) === 'pending')
      .flatMap(m => {
        const { team_a, team_b } = getPlayersFromSnapshot(m.players_snapshot)
        return [...team_a, ...team_b]
      })
    )

    const result = generateRoundRobinRound({
      activePlayers,
      busyPlayerIds: busyFromDb,
      pendingMatches: pendingRoundRobinMatches,
      matchesPlayed,
      metMap,
      partnerMap,
    })

    if (result.status === 'not_enough_available_players') {
      Alert.alert('Hết người rảnh', 'Tất cả mọi người đều đang thi đấu hoặc đã có lịch chờ.')
      return
    }
    if (result.status === 'match_gap_exceeded') {
      Alert.alert('Chờ cân bằng', 'Cần đợi một số người đánh xong để đảm bảo khoảng cách trận đấu không quá 1.')
      return
    }

    setPendingRoundRobinMatches(prev => [...prev, result.match])
    setSittingOutPlayers(result.sittingOutPlayerIds)
  }

  const handleConfirmRoundRobinMatch = async (match: PendingMatch) => {
    setSubmitting(true)
    const { error } = await insertMatch({
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
      status: 'playing' as const,
      players_snapshot: {
        team_a: match.teamA,
        team_b: match.teamB,
        rotation: match.rotation,
        court: match.court,
        sitter_id: match.sitterId
      }
    }))
    const { error } = await insertMatches(insertData)
    setSubmitting(false)

    if (error) {
      Alert.alert('Lỗi', 'Không thể bắt đầu lượt đấu này')
    } else {
      const startedKeys = new Set(rotationMatches.map(getPendingMatchKey))
      setPendingRoundRobinMatches(prev => prev.filter(match => !startedKeys.has(getPendingMatchKey(match))))
      onUpdated()
    }
  }

  const clearPendingSchedule = () => {
    setPendingRoundRobinMatches([])
    setFullRotationSchedule([])
    setSittingOutPlayers([])
    setScheduleQuality(undefined)
  }

  return {
    isRoundRobinMode,
    isFixedTeamMode: !isRoundRobinMode,

    submitting,
    scheduleMode,
    setScheduleMode,
    schedulePriority,
    setSchedulePriority,
    scheduleCourtCount,
    setScheduleCourtCount,
    minGamesPerPlayer,
    setMinGamesPerPlayer,
    showRotationTable,
    setShowRotationTable,
    showScheduleSetupPage,
    setScheduleSetupPageOpen,
    pendingRoundRobinMatches,
    fullRotationSchedule,
    scheduleQuality,
    scheduledPlayers,
    sittingOutPlayers,
    localScores,
    updatingPlayerId,

    activeMatches,
    historyMatches,
    finishedMatches,
    effectivePlayers,
    activePlayers,
    teamIds,
    totalPlayers,
    isRotationComplete,
    playerEncounterCounts,
    underMinPlayerIds,
    pendingRotationGroups,
    sortedActiveMatches,
    pendingRoundCount,
    scheduleNeedsRefresh,
    matchesPlayed,
    metMap,
    partnerMap,

    getMatchPlayerNames,
    getTeamSkill,
    getPlayerNames,
    getShortName,
    getManualSwapInfo,
    getManualSwapCandidates,
    handleReplacePendingPlayer,
    handleGenerateFixedSchedule,
    handleSetPlayerAvailability,
    handleUpdateScore,
    handleFinishMatch,
    handleCancelMatch,
    handleCreateMatch,
    handleGenerateRoundRobinRound,
    handleConfirmRoundRobinMatch,
    handleConfirmRotationMatches,
    clearPendingSchedule,
  }
}
