import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { buildSuggestedRoundActions, buildSuggestedRoundActionsCache, sortAlternativesByAudit, type AlternativeAudit, type SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import { buildMatchCountConsistencyRows, buildFairnessPreview, buildLatestFairnessAudit } from '@/lib/next-round-suggester/fairness/audit'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { buildGroupAliasMap, buildGroupSummaries } from '@/lib/next-round-suggester/fairness/group-audit'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { sanitizeSummaryForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import { buildSessionSummary } from '@/lib/next-round-suggester/fairness/summary'
import { rebuildStateThroughRound } from '@/lib/next-round-suggester/history'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { SessionLiveMatchRow, SessionPairHistoryRow, SessionPlayerStateRow, SuggestionAlternative } from '@/lib/next-round-suggester/types'
import {
  getPlayerPvna,
  isConfirmedNonNoShow,
  isRosterSyncEligible,
  withWeights,
} from './helpers'
import { buildFairnessWarningsForBanner } from './fairness-warnings'
import type { NextRoundSuggesterV2Props, RoundSelectionSnapshot, SheetKey } from './types'
import { useLiveSessionQuery, liveSessionQueryKeys } from './queries'
import type { LiveRows, RegisteredSessionPlayerRow } from './types'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'
import { loadNextRoundSessionSettings, saveNextRoundSessionSettings, type PersistedNextRoundSettings } from './api'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { getComparableElo, getReliability, getSkillLevelId, getSkillTag } from '@/lib/sessionDetail'
import { getLevelIdForElo } from '@/lib/eloSystem'
import { markNextRoundStage } from './telemetry'
import { buildCompletedLiveCycleRows as buildCompletedLiveCycleRowsBySequence } from './live-cycle-rows'

const USE_COURT_LANE_BOARD = process.env.EXPO_PUBLIC_USE_COURT_LANE_BOARD === '1'

function cloneSuggestionAlternative(alternative: SuggestionAlternative | null): SuggestionAlternative | null {
  if (!alternative) return null
  return {
    matches: alternative.matches.map(match => ({
      ...match,
      team_a: [...match.team_a],
      team_b: [...match.team_b],
      stats: match.stats ? { ...match.stats } : undefined,
    })),
    resting: [...alternative.resting],
    score: alternative.score,
    warnings: [...alternative.warnings],
    stats: { ...alternative.stats },
    runtime_ms: alternative.runtime_ms,
    iterations: alternative.iterations,
  }
}

function normalizeCourtCount(value: number) {
  return Math.max(1, Math.floor(value || 1))
}

function arrangementPlayerFromRow(row: SessionPlayerStateRow): ArrangementPlayer | null {
  const player = row.players
  if (!player) return null
  const elo = Number(player.current_elo ?? player.elo ?? 0)
  return {
    id: row.player_id,
    name: player.name ?? row.player_id.slice(0, 8),
    elo,
    team: 0,
    reliability: null,
    levelId: getLevelIdForElo(elo),
    skillTag: 'PVNA',
    gender: player.gender,
    pvna: player.pvna,
    status: 'confirmed',
    checkInStatus: row.checked_out_at ? 'checked_out' : 'present',
    metadata: row.session_players?.metadata ?? null,
  }
}

function arrangementPlayerFromRegisteredRow(row: RegisteredSessionPlayerRow): ArrangementPlayer | null {
  const player = row.players
  if (!player) return null
  return {
    ...(player as any),
    id: row.player_id,
    name: player.name ?? row.player_id.slice(0, 8),
    elo: getComparableElo(player),
    reliability: getReliability(player),
    levelId: getSkillLevelId(player),
    skillTag: getSkillTag(player),
    gender: player.gender,
    pvna: player.pvna,
    team: row.team_no || 0,
    status: row.status || 'confirmed',
    noShowCount: player.no_show_count,
    checkInStatus: row.check_in_status,
    metadata: row.metadata,
  }
}

function withoutRestPenalty(alternative: SuggestionAlternative | null | undefined): SuggestionAlternative | null {
  if (!alternative) return null
  return {
    ...alternative,
    resting: [],
  }
}

function sortLiveMatchesBySequence(matches: SessionLiveMatchRow[]): SessionLiveMatchRow[] {
  return [...matches].sort((a, b) => {
    if (a.sequence_no !== b.sequence_no) return a.sequence_no - b.sequence_no
    return (a.court_idx ?? 0) - (b.court_idx ?? 0)
  })
}

function buildCompletedRoundResting(
  matches: SessionLiveMatchRow[],
  playedIds: Set<string>,
  fallbackPresentIds: string[],
  fallbackOptedRestPlayerIds: Set<string>,
): string[] {
  const finalRoundSnapshot = sortLiveMatchesBySequence(matches).at(-1)?.resting ?? []
  const source = finalRoundSnapshot.length > 0
    ? finalRoundSnapshot
    : fallbackPresentIds.filter(id => !fallbackOptedRestPlayerIds.has(id))

  return [...new Set(source)].filter(id => !playedIds.has(id))
}

export function buildCompletedLiveCycleRows({
  liveMatchRows,
  legacyRoundRows,
  playerRows,
  sessionId,
  courtCount,
}: {
  liveMatchRows: SessionLiveMatchRow[]
  legacyRoundRows: LiveRows['roundRows']
  playerRows: SessionPlayerStateRow[]
  sessionId: string
  courtCount: number
}): LiveRows['roundRows'] {
  const normalizedCourtCount = normalizeCourtCount(courtCount)
  const baseRoundNo = legacyRoundRows.reduce((max, row) => Math.max(max, row.round_no), -1) + 1
  const completedLive = sortLiveMatchesBySequence(liveMatchRows.filter(match => match.status === 'completed'))
  const presentPlayerIds = playerRows
    .filter(row => !row.checked_out_at)
    .map(row => row.player_id)
  const optedRestPlayerIds = new Set(
    playerRows
      .filter(row => !row.checked_out_at && row.opted_rest)
      .map(row => row.player_id),
  )
  const liveRoundRows: LiveRows['roundRows'] = []

  for (let index = 0; index + normalizedCourtCount <= completedLive.length; index += normalizedCourtCount) {
    const matches = completedLive.slice(index, index + normalizedCourtCount)
    const playedIds = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
    const roundStartedAt = matches.map(match => match.started_at).filter(Boolean).sort()[0]
    const roundEndedAt = matches.map(match => match.ended_at).filter(Boolean).sort().reverse()[0]

    let roundPresentIds: string[]
    if (roundStartedAt) {
      const roundStartMs = new Date(roundStartedAt).getTime()
      const roundEndMs = roundEndedAt ? new Date(roundEndedAt).getTime() : Infinity
      roundPresentIds = playerRows
        .filter(player => {
          const checkedIn = new Date(player.checked_in_at).getTime()
          const checkedOut = player.checked_out_at ? new Date(player.checked_out_at).getTime() : Infinity
          return checkedIn <= roundEndMs && checkedOut >= roundStartMs
        })
        .map(player => player.player_id)
    } else {
      roundPresentIds = presentPlayerIds
    }

    liveRoundRows.push({
      id: matches[0].id,
      session_id: sessionId,
      round_no: baseRoundNo + liveRoundRows.length,
      status: 'completed',
      matches: matches.map(match => ({
        court_idx: match.court_idx ?? 0,
        team_a: match.team_a,
        team_b: match.team_b,
      })),
      resting: buildCompletedRoundResting(
        matches,
        playedIds,
        roundPresentIds,
        optedRestPlayerIds,
      ),
      started_at: roundStartedAt ?? null,
      ended_at: roundEndedAt ?? null,
    })
  }

  return [...legacyRoundRows, ...liveRoundRows]
}

const SETTINGS_STORAGE_PREFIX = 'next-round-v2-settings'

type PersistedSettings = {
  courtCountOverride?: number | null
  courtPreset?: CourtPreset
  courtDurationMin?: number
  pvnaTolerance?: number
  targetRounds?: number | null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isCourtPreset(value: unknown): value is CourtPreset {
  return value === 'balanced' || value === 'play_more' || value === 'relaxed'
}

export function useNextRoundModel({ sessionId, players = [], courts, initialShowReport = false }: NextRoundSuggesterV2Props) {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const sessionCourtSetup = useMemo(() => (
    typeof courts === 'number' && Number.isFinite(courts) ? normalizeCourtCount(courts) : null
  ), [courts])
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [selectionUndo, setSelectionUndo] = useState<RoundSelectionSnapshot | null>(null)
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetKey>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCountOverride, setCourtCountOverride] = useState<number | null>(sessionCourtSetup)
  const [courtPreset, setCourtPreset] = useState<CourtPreset>('balanced')
  const [courtDurationMin, setCourtDurationMin] = useState(120)
  const [targetRounds, setTargetRounds] = useState<number | null>(null)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [showEngineStats, setShowEngineStats] = useState(false)
  const [showSessionReport, setShowSessionReport] = useState(initialShowReport)
  const lastSuggestMsRef = useRef<number | null>(null)
  const settingsStorageKey = `${SETTINGS_STORAGE_PREFIX}:${sessionId}`

  const applyPersistedSettings = useCallback((settings: Partial<PersistedSettings | PersistedNextRoundSettings>) => {
    const savedCourts = readNumber(settings.courtCountOverride)
    const savedDuration = readNumber(settings.courtDurationMin)
    const savedTolerance = readNumber(settings.pvnaTolerance)
    const savedTarget = readNumber(settings.targetRounds)
    if (savedCourts !== null) setCourtCountOverride(normalizeCourtCount(savedCourts))
    if (isCourtPreset(settings.courtPreset)) setCourtPreset(settings.courtPreset)
    if (savedDuration !== null) setCourtDurationMin(Math.max(15, Math.floor(savedDuration)))
    if (savedTolerance !== null) setPvnaTolerance(savedTolerance)
    if (savedTarget !== null) setTargetRounds(Math.max(1, Math.floor(savedTarget)))
    else if ('targetRounds' in settings && settings.targetRounds === null) setTargetRounds(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    setSettingsHydrated(false)
    setCourtCountOverride(sessionCourtSetup)
    setCourtPreset('balanced')
    setCourtDurationMin(120)
    setPvnaTolerance(0.5)
    setTargetRounds(null)
    void (async () => {
      const raw = await safeStorageGetItem(settingsStorageKey)
      if (cancelled) return
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PersistedSettings
          applyPersistedSettings(parsed)
        } catch {
          // Ignore stale/bad local settings and fall back to calculator defaults.
        }
      }
      try {
        const dbSettings = await loadNextRoundSessionSettings(sessionId)
        if (!cancelled && dbSettings) applyPersistedSettings(dbSettings)
      } catch (error) {
        if (__DEV__) console.warn('[NextRoundV2] could not load DB settings', error)
      }
      if (cancelled) return
      setSettingsHydrated(true)
    })()
    return () => { cancelled = true }
  }, [applyPersistedSettings, sessionCourtSetup, sessionId, settingsStorageKey])

  useEffect(() => {
    if (!settingsHydrated) return
    const payload: PersistedNextRoundSettings = {
      courtCountOverride,
      courtPreset,
      courtDurationMin,
      pvnaTolerance,
      targetRounds,
    }
    void safeStorageSetItem(settingsStorageKey, JSON.stringify(payload))
    void saveNextRoundSessionSettings(sessionId, payload).catch((error) => {
      if (__DEV__) console.warn('[NextRoundV2] could not save DB settings', error)
    })
  }, [courtCountOverride, courtDurationMin, courtPreset, pvnaTolerance, sessionId, settingsHydrated, settingsStorageKey, targetRounds])

  const routePlayersById = useMemo(() => new Map(players.map(player => [String(player.id), player])), [players])
  const { data: rowsData, isLoading: loading, error: queryError } = useLiveSessionQuery(sessionId, routePlayersById)
  const rows: LiveRows = rowsData || { playerRows: [], registeredPlayerRows: [], pairRows: [], roundRows: [], liveMatchRows: [], liveStateVersion: null }
  const playersById = useMemo(() => {
    const merged = new Map(routePlayersById)
    for (const row of rows.registeredPlayerRows) {
      if (merged.has(row.player_id)) continue
      const player = arrangementPlayerFromRegisteredRow(row)
      if (player) merged.set(row.player_id, player)
    }
    for (const row of rows.playerRows) {
      if (merged.has(row.player_id)) continue
      const player = arrangementPlayerFromRow(row)
      if (player) merged.set(row.player_id, player)
    }
    return merged
  }, [routePlayersById, rows.playerRows, rows.registeredPlayerRows])
  const rosterPlayers = useMemo(() => [...playersById.values()], [playersById])
  const confirmedPlayers = useMemo(
    () => rosterPlayers.filter(player => player.status === 'confirmed' || !player.status),
    [rosterPlayers],
  )
  const checkedInPlayers = useMemo(() => {
    const explicitlyPresent = confirmedPlayers.filter(isRosterSyncEligible)
    return explicitlyPresent.length > 0 ? explicitlyPresent : confirmedPlayers.filter(isConfirmedNonNoShow)
  }, [confirmedPlayers])
  const liveRows: {
    rows: LiveRows
    loading: boolean
    error: string | null
    lastLoadStateMsRef: { current: number | null }
    refreshing: boolean
  } = { rows, loading, error: queryError ? queryError.message : null, lastLoadStateMsRef: { current: null }, refreshing: loading }
  const deferredRows = useDeferredValue(rows)

  // Đóng băng player rows cho engine khi sheet roster đang mở.
  // User không nhìn thấy gợi ý → không cần recompute suggestNextRound,
  // correctForFairness, computeSessionFairness trong lúc thao tác roster.
  const frozenEnginePlayerRowsRef = useRef(deferredRows.playerRows)
  const enginePlayerRows = useMemo(() => {
    if (sheet !== 'roster' && sheet !== 'late-arrivals') frozenEnginePlayerRowsRef.current = deferredRows.playerRows
    return frozenEnginePlayerRowsRef.current
  }, [sheet, deferredRows.playerRows])

  const rosterSheetOpen = sheet === 'roster' || sheet === 'late-arrivals'
  const frozenEngineLiveStateVersionRef = useRef(deferredRows.liveStateVersion)
  const engineLiveStateVersion = useMemo(() => {
    if (!rosterSheetOpen) frozenEngineLiveStateVersionRef.current = deferredRows.liveStateVersion
    return frozenEngineLiveStateVersionRef.current
  }, [rosterSheetOpen, deferredRows.liveStateVersion])

  const frozenPresentRowsRef = useRef(liveRows.rows.playerRows.filter(row => !row.checked_out_at))
  const presentRows = useMemo(() => {
    if (!rosterSheetOpen) frozenPresentRowsRef.current = liveRows.rows.playerRows.filter(row => !row.checked_out_at)
    return frozenPresentRowsRef.current
  }, [rosterSheetOpen, liveRows.rows.playerRows])
  const presentCount = presentRows.length
  const calculatorPlayerCount = presentCount || checkedInPlayers.length || confirmedPlayers.length
  const courtCalculator = useMemo(() => calculateOptimalCourts({
    n_players: calculatorPlayerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [calculatorPlayerCount, courtDurationMin, courtPreset])
  const courtCount = courtCountOverride ?? courtCalculator.recommended.courts
  const setCourtCount = useCallback((value: number) => {
    setCourtCountOverride(normalizeCourtCount(value))
  }, [])
  const frozenEngineCourtCountRef = useRef(courtCount)
  const engineCourtCount = useMemo(() => {
    if (!rosterSheetOpen) frozenEngineCourtCountRef.current = courtCount
    return frozenEngineCourtCountRef.current
  }, [rosterSheetOpen, courtCount])

  const enrichedPlayerRows = useMemo(() => enginePlayerRows.map(row => ({
    ...row,
    players: {
      pvna: getPlayerPvna(playersById.get(row.player_id)) ?? row.players?.pvna ?? 0,
      elo: row.players?.elo,
      gender: playersById.get(row.player_id)?.gender ?? row.players?.gender,
      partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref ?? row.players?.partner_gender_pref,
      opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref ?? row.players?.opponent_gender_pref,
    },
    session_players: {
      metadata: playersById.get(row.player_id)?.metadata ?? row.session_players?.metadata ?? null,
    },
  })), [enginePlayerRows, playersById])

  // Refs giữ data hiện tại để rawState useMemo đọc khi fingerprint thay đổi
  const enrichedPlayerRowsRef = useRef(enrichedPlayerRows)
  const pairRowsRef = useRef(deferredRows.pairRows)
  const roundRowsRef = useRef(deferredRows.roundRows)
  /*
  const legacyGroupedRoundRows = useMemo(() => {
    const legacyRows = deferredRows.roundRows
    const baseRoundNo = legacyRows.reduce((max, row) => Math.max(max, row.round_no), -1) + 1

    const completedLive = deferredRows.liveMatchRows.filter(m => m.status === 'completed')

    // Group by round_no từ DB nếu có. Nếu không (migration chưa apply):
    // greedy group theo sân — các trận không trùng court_idx thuộc cùng 1 vòng.
    const byRound = new Map<number, typeof completedLive>()
    for (const match of completedLive.filter(m => m.round_no != null)) {
      const key = match.round_no!
      if (!byRound.has(key)) byRound.set(key, [])
      byRound.get(key)!.push(match)
    }

    // Some live sessions contain older completed matches with round_no = null mixed
    // with newer rows that have round_no. Keep those legacy rows as separate
    // greedy court groups; grouping all nulls together creates fake mega-rounds.
    let nextFallbackRoundKey = Math.max(-1, ...byRound.keys()) + 1
    for (const match of completedLive.filter(m => m.round_no == null).sort((a, b) => a.sequence_no - b.sequence_no)) {
      const courtIdx = match.court_idx ?? match.sequence_no
      const targetRound = [...byRound.entries()]
        .filter(([key]) => key >= nextFallbackRoundKey)
        .find(([, matches]) => !matches.some(m => (m.court_idx ?? m.sequence_no) === courtIdx))
      const key = targetRound ? targetRound[0] : nextFallbackRoundKey++
      if (!byRound.has(key)) byRound.set(key, [])
      byRound.get(key)!.push(match)
    }

    // Fallback: người có mặt hiện tại (dùng khi không có timing data)
    const presentPlayerIds = enginePlayerRows
      .filter(r => !r.checked_out_at)
      .map(r => r.player_id)
    const optedRestPlayerIds = new Set(
      enginePlayerRows
        .filter(r => !r.checked_out_at && r.opted_rest)
        .map(r => r.player_id),
    )

    const liveRoundRows = [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, matches]) => matches.length >= engineCourtCount)
      .map(([, unsortedMatches], index) => {
        const matches = sortLiveMatchesBySequence(unsortedMatches)
        const playedIds = new Set(matches.flatMap(m => [...m.team_a, ...m.team_b]))
        const roundStartedAt = matches.map(m => m.started_at).filter(Boolean).sort()[0]
        const roundEndedAt = matches.map(m => m.ended_at).filter(Boolean).sort().reverse()[0]

        // Tính roster tại thời điểm vòng đó dựa trên timestamp.
        // Dùng tất cả playerRows (kể cả đã checked_out) để tính đúng lịch sử.
        let roundPresentIds: string[]
        if (roundStartedAt) {
          const roundStartMs = new Date(roundStartedAt).getTime()
          const roundEndMs = roundEndedAt ? new Date(roundEndedAt).getTime() : Infinity
          roundPresentIds = enginePlayerRows
            .filter(p => {
              const checkedIn = new Date(p.checked_in_at).getTime()
              const checkedOut = p.checked_out_at ? new Date(p.checked_out_at).getTime() : Infinity
              return checkedIn <= roundEndMs && checkedOut >= roundStartMs
            })
            .map(p => p.player_id)
        } else {
          roundPresentIds = presentPlayerIds
        }

        return {
          id: matches[0].id,
          session_id: sessionId,
          round_no: baseRoundNo + index,
          status: 'completed' as const,
          matches: matches.map(m => ({
            court_idx: m.court_idx ?? 0,
            team_a: m.team_a,
            team_b: m.team_b,
          })),
          resting: buildCompletedRoundResting(
            matches,
            playedIds,
            roundPresentIds,
            optedRestPlayerIds,
          ),
          started_at: roundStartedAt ?? null,
          ended_at: roundEndedAt ?? null,
        }
      })

    return [...legacyRows, ...liveRoundRows]
  }, [deferredRows.liveMatchRows, deferredRows.roundRows, enginePlayerRows, sessionId, engineCourtCount])
  */
  const stateRoundRows = useMemo(() => buildCompletedLiveCycleRowsBySequence({
    liveMatchRows: deferredRows.liveMatchRows,
    legacyRoundRows: deferredRows.roundRows,
    playerRows: enginePlayerRows,
    sessionId,
    courtCount: engineCourtCount,
  }), [deferredRows.liveMatchRows, deferredRows.roundRows, enginePlayerRows, sessionId, engineCourtCount])

  // Fingerprint: chuỗi tóm tắt data thực sự, chỉ thay đổi khi DB trả về data mới.
  // Nếu loadLiveState() trả về data giống hệt (foreground refresh không có gì mới),
  // fingerprint giữ nguyên → rawState không rebuild → engine không chạy lại.
  const rowsFingerprint = useMemo(() => {
    enrichedPlayerRowsRef.current = enrichedPlayerRows
    pairRowsRef.current = deferredRows.pairRows
    roundRowsRef.current = stateRoundRows

    const players = enrichedPlayerRows
      .map(r => `${r.player_id}|${r.matches_played}|${r.last_played_round}|${r.consecutive_play}|${r.consecutive_rest}|${r.opted_rest ? 1 : 0}|${r.checked_out_at ?? ''}|${r.group_id ?? ''}|${r.players?.pvna ?? 0}|${r.players?.gender ?? ''}|${r.players?.partner_gender_pref ?? ''}|${r.players?.opponent_gender_pref ?? ''}`)
      .sort()
      .join(';')
    const pairs = deferredRows.pairRows
      .map(r => `${r.player_a}|${r.player_b}|${r.partner_count}|${r.opponent_count}`)
      .sort()
      .join(';')
    const rounds = stateRoundRows
      .map(r => `${r.round_no}|${r.status}|${JSON.stringify(r.matches)}|${JSON.stringify(r.resting ?? [])}`)
      .join(';')
    const liveMatches = deferredRows.liveMatchRows
      .map(r => `${r.id}|${r.sequence_no}|${r.status}|${r.score_a}|${r.score_b}|${JSON.stringify(r.team_a)}|${JSON.stringify(r.team_b)}|${JSON.stringify(r.resting ?? [])}`)
      .join(';')
    return `${engineLiveStateVersion ?? 'noversion'}__${players}__${pairs}__${rounds}__${liveMatches}`
  }, [enrichedPlayerRows, engineLiveStateVersion, deferredRows.liveMatchRows, deferredRows.pairRows, stateRoundRows])

  const rawState = useMemo(() => {
    const startedAt = Date.now()
    const mapped = mapRowsToSessionState({
      sessionId,
      playerRows: enrichedPlayerRowsRef.current,
      pairRows: pairRowsRef.current,
      roundRows: roundRowsRef.current,
      courts: engineCourtCount,
      pvnaTolerance,
    })
    if (engineLiveStateVersion != null) {
      markNextRoundStage(sessionId, 'state_mapped', {
        map_ms: Date.now() - startedAt,
        player_count: mapped.players.size,
        round_count: mapped.rounds.length,
        court_count: engineCourtCount,
        live_state_version: engineLiveStateVersion,
      })
    }
    return mapped
  }, [rowsFingerprint, engineCourtCount, pvnaTolerance, sessionId, engineLiveStateVersion])

  const baseWeights = useMemo(() => ({
    ...rawState.config.weights,
    pvna: 1,
  }), [rawState.config.weights])
  const baseState = useMemo(() => withWeights(rawState, baseWeights), [baseWeights, rawState])
  const fairnessAdjustment = useMemo(() => correctForFairness(baseState), [baseState])
  const state = useMemo(
    () => applyFairnessAdjustment(baseState, fairnessAdjustment),
    [baseState, fairnessAdjustment],
  )
  const deferredState = useDeferredValue(state)
  const deferredTierOverrides = useDeferredValue(fairnessAdjustment.tier_overrides)
  const deferredCourtCount = useDeferredValue(courtCount)
  const deferredPvnaTolerance = useDeferredValue(pvnaTolerance)
  const suggestionIsUpdating = deferredState !== state
    || deferredTierOverrides !== fairnessAdjustment.tier_overrides
    || engineCourtCount !== courtCount
    || deferredPvnaTolerance !== pvnaTolerance
    || deferredRows !== liveRows.rows
  const suggestion = useMemo(() => {
    if (USE_COURT_LANE_BOARD) {
      lastSuggestMsRef.current = 0
      return { alternatives: [] }
    }
    const startedAt = Date.now()
    const result = suggestNextRound(deferredState, { tier_overrides: deferredTierOverrides })
    lastSuggestMsRef.current = Date.now() - startedAt
    if (deferredRows.liveStateVersion != null) {
      markNextRoundStage(sessionId, 'suggestion_ready', {
        suggest_ms: lastSuggestMsRef.current,
        alternatives: result.alternatives.length,
        player_count: deferredState.players.size,
        live_state_version: deferredRows.liveStateVersion,
      })
    }
    return result
  }, [deferredRows.liveStateVersion, deferredState, deferredTierOverrides, sessionId])
  const selected = suggestion.alternatives[selectedAlternative] ?? suggestion.alternatives[0]
  const workingAlternative = manualAlternative ?? selected
  const hasManualSwapHardGuard = Boolean(workingAlternative?.warnings.includes('MANUAL_SWAP_HARD_GUARD'))
  const fairnessScore = useMemo(() => computeSessionFairness(state), [state])
  const fairnessAudit = useMemo(() => buildLatestFairnessAudit(state), [state])

  // Pre-compute cho tất cả alternatives — chỉ chạy khi engine tạo suggestion mới,
  // không chạy lại khi user chỉ đổi selectedAlternative.
  const suggestedRoundActionsCache = useMemo(
    () => USE_COURT_LANE_BOARD
      ? buildSuggestedRoundActionsCache(deferredState, [], deferredCourtCount)
      : buildSuggestedRoundActionsCache(deferredState, suggestion.alternatives, deferredCourtCount),
    [deferredCourtCount, deferredState, suggestion.alternatives],
  )
  const alternativeOrder = useMemo(
    () => sortAlternativesByAudit(suggestedRoundActionsCache.audits),
    [suggestedRoundActionsCache],
  )
  const alternativeFairnessPreviews = useMemo(
    () => USE_COURT_LANE_BOARD
      ? []
      : suggestion.alternatives.map(alt => buildFairnessPreview(deferredState, withoutRestPenalty(alt))),
    [deferredState, suggestion.alternatives],
  )
  const alternativeFairnessWarnings = useMemo(
    () => USE_COURT_LANE_BOARD
      ? []
      : suggestion.alternatives.map(alt => buildFairnessWarningsForBanner(deferredState, alt)),
    [deferredState, suggestion.alternatives],
  )

  // manualAlternative cần tính riêng vì không nằm trong suggestion.alternatives
  const manualFairnessPreview = useMemo(
    () => manualAlternative ? buildFairnessPreview(deferredState, withoutRestPenalty(manualAlternative)) : null,
    [deferredState, manualAlternative],
  )
  const manualFairnessWarnings = useMemo(
    () => manualAlternative ? buildFairnessWarningsForBanner(deferredState, manualAlternative) : null,
    [deferredState, manualAlternative],
  )

  // Đổi ALT chỉ là đổi index — không tính gì thêm
  const fairnessPreview = manualFairnessPreview ?? alternativeFairnessPreviews[selectedAlternative] ?? alternativeFairnessPreviews[0] ?? null
  const fairnessWarnings = manualFairnessWarnings ?? alternativeFairnessWarnings[selectedAlternative] ?? alternativeFairnessWarnings[0] ?? []

  const suggestedRoundActions = useMemo(
    () => USE_COURT_LANE_BOARD
      ? []
      : buildSuggestedRoundActions({
      state: deferredState,
      alternatives: suggestion.alternatives,
      cache: suggestedRoundActionsCache,
      selectedIndex: selectedAlternative,
      pvnaTolerance: deferredPvnaTolerance,
      courtCount: deferredCourtCount,
    }),
    [deferredCourtCount, deferredPvnaTolerance, deferredState, selectedAlternative, suggestedRoundActionsCache, suggestion.alternatives],
  )

  const activeRound = useMemo(() => state.rounds.find(row => row.status === 'active') ?? null, [state.rounds])
  const effectiveTargetRounds = targetRounds ?? courtCalculator.recommended.total_rounds
  const completedRounds = useMemo(
    () => stateRoundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no),
    [stateRoundRows],
  )
  const completedRoundCount = completedRounds.length
  const targetReached = effectiveTargetRounds > 0
    && presentRows.length > 0
    && presentRows.every(row => row.matches_played >= effectiveTargetRounds)
  const reportReady = effectiveTargetRounds > 0 && completedRoundCount >= effectiveTargetRounds
  const reportState = useMemo(
    () => (completedRoundCount > 0 ? rebuildStateThroughRound(state, completedRounds[0].round_no) : state),
    [completedRoundCount, completedRounds, state],
  )
  const hasCompletedLiveMatchOverflow = useMemo(() => {
    const completedLiveMatchCount = deferredRows.liveMatchRows.filter(row => row.status === 'completed').length
    if (completedLiveMatchCount === 0) return false

    const liveMatchIds = new Set(deferredRows.liveMatchRows.map(row => row.id))
    const representedCompletedLiveMatchCount = stateRoundRows
      .filter(row => row.id && liveMatchIds.has(row.id))
      .reduce((sum, row) => sum + row.matches.length, 0)

    return completedLiveMatchCount > representedCompletedLiveMatchCount
  }, [deferredRows.liveMatchRows, stateRoundRows])
  const sessionSummary = useMemo(() => sanitizeSummaryForHost(buildSessionSummary(reportState)), [reportState])
  const matchCountConsistencyRows = useMemo(
    () => hasCompletedLiveMatchOverflow ? [] : buildMatchCountConsistencyRows(state, reportState),
    [hasCompletedLiveMatchOverflow, reportState, state],
  )
  const groupSummaries = useMemo(() => buildGroupSummaries(deferredRows.playerRows), [deferredRows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])
  const phase: 'plan' | 'active' | 'recap' = showSessionReport && (reportReady || initialShowReport) && !activeRound ? 'recap' : activeRound ? 'active' : 'plan'

  const rememberRoundSelection = (reason: string) => {
    setSelectionUndo({
      selectedAlternative,
      manualAlternative: cloneSuggestionAlternative(manualAlternative),
      pvnaTolerance,
      courtCount,
      reason,
    })
  }

  const undoRoundSelection = () => {
    if (!selectionUndo) return
    setSelectedAlternative(selectionUndo.selectedAlternative)
    setManualAlternative(selectionUndo.manualAlternative)
    setPvnaTolerance(selectionUndo.pvnaTolerance)
    setCourtCountOverride(selectionUndo.courtCount)
    setSwapFromPlayerId(null)
    setSelectionUndo(null)
  }

  const selectAlternativeForRound = (index: number, reason = `ALT ${index + 1}`) => {
    if (selectedAlternative === index && manualAlternative === null) return
    rememberRoundSelection(reason)
    setSelectedAlternative(index)
    setManualAlternative(null)
    setSwapFromPlayerId(null)
    setShowSessionReport(false)
  }

  const applySuggestedRoundAction = (action: SuggestedRoundAction) => {
    rememberRoundSelection(action.label)
    if (action.type === 'select_alternative') {
      setSelectedAlternative(action.alternative_index)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }
    if (action.type === 'set_pvna_tolerance') {
      setPvnaTolerance(action.pvna_tolerance)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
      return
    }
    if (action.type === 'set_courts') {
      setCourtCount(action.courts)
      setSelectedAlternative(0)
      setManualAlternative(null)
      setSwapFromPlayerId(null)
    }
  }

  const toggleGroupSelection = useCallback((playerId: string) => {
    setGroupSelection(current => (
      current.includes(playerId)
        ? current.filter(id => id !== playerId)
        : [...current, playerId]
    ))
  }, [])

  return {
    activeRound,
    alternativeOrder,
    alternativeAudits: suggestedRoundActionsCache.audits,
    applySuggestedRoundAction,
    checkedInPlayers,
    completedRoundCount,
    completedRounds,
    calculatorPlayerCount,
    courtCalculator,
    courtCount,
    courtDurationMin,
    courtPreset,
    effectiveTargetRounds,
    fairnessAudit,
    fairnessAdjustment,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupAliases,
    groupSelection,
    groupSummaries,
    hasManualSwapHardGuard,
    manualAlternative,
    matchCountConsistencyRows,
    phase,
    playersById,
    presentCount,
    pvnaTolerance,
    reportState,
    reportReady,
    rosterPlayers,
    rows: liveRows.rows,
    applyLiveMatches: useCallback((matches: SessionLiveMatchRow[], version?: number | null) => {
      queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (current: LiveRows | undefined) => {
        if (!current) return current
        const byId = new Map(current.liveMatchRows.map(m => [m.id, m]))
        for (const m of matches) byId.set(m.id, m)
        return {
          ...current,
          liveMatchRows: [...byId.values()],
          liveStateVersion: version != null ? version : current.liveStateVersion,
        }
      })
    }, [queryClient, sessionId]),
    applyLiveStateVersion: useCallback((version?: number | null) => {
      if (version == null) return
      queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (current: LiveRows | undefined) => {
        if (!current) return current
        return { ...current, liveStateVersion: version }
      })
    }, [queryClient, sessionId]),
    applyStartedRound: useCallback((round?: any, version?: number | null) => {
      queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (current: LiveRows | undefined) => {
        if (!current) return current
        const updated = round
          ? current.roundRows.some(r => r.id === round.id)
            ? current.roundRows.map(r => r.id === round.id ? { ...r, ...round } : r)
            : [...current.roundRows, round]
          : current.roundRows
        return {
          ...current,
          roundRows: updated,
          liveStateVersion: version != null ? version : current.liveStateVersion,
        }
      })
    }, [queryClient, sessionId]),
    applyEndedRound: useCallback((roundNo: number, round?: any, playerState?: SessionPlayerStateRow[], pairHistory?: SessionPairHistoryRow[], version?: number | null) => {
      queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (current: LiveRows | undefined) => {
        if (!current) return current
        const roundRows = round
          ? current.roundRows.map(r => r.round_no === roundNo ? { ...r, ...round } : r)
          : current.roundRows
        const playerRows = playerState?.length
          ? current.playerRows.map(p => playerState.find(s => s.player_id === p.player_id) ?? p)
          : current.playerRows
        const pairById = new Map(current.pairRows.map(p => [`${p.player_a}:${p.player_b}`, p]))
        for (const p of pairHistory ?? []) pairById.set(`${p.player_a}:${p.player_b}`, p)
        return {
          ...current,
          roundRows,
          playerRows,
          pairRows: [...pairById.values()],
          liveStateVersion: version != null ? version : current.liveStateVersion,
        }
      })
    }, [queryClient, sessionId]),
    applyCompletedLiveMatch: useCallback((match: SessionLiveMatchRow, playerState: SessionPlayerStateRow[], pairHistory: SessionPairHistoryRow[], version?: number | null) => {
      queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), (current: LiveRows | undefined) => {
        if (!current) return current
        const byId = new Map(current.liveMatchRows.map(m => [m.id, m]))
        byId.set(match.id, match)
        const playerRows = playerState?.length
          ? current.playerRows.map(p => playerState.find(s => s.player_id === p.player_id) ?? p)
          : current.playerRows
        const pairById = new Map(current.pairRows.map(p => [`${p.player_a}:${p.player_b}`, p]))
        for (const p of pairHistory ?? []) pairById.set(`${p.player_a}:${p.player_b}`, p)
        return {
          ...current,
          liveMatchRows: [...byId.values()],
          playerRows,
          pairRows: [...pairById.values()],
          liveStateVersion: version != null ? version : current.liveStateVersion,
        }
      })
    }, [queryClient, sessionId]),
    selectAlternativeForRound,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    settingsHydrated,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError: setActionError,
    setGroupSelection,
    setManualAlternative,
    setPvnaTolerance,
    setSheet,
    setShowEngineStats,
    setShowSessionReport,
    setSwapFromPlayerId,
    setTargetRounds,
    sheet,
    showEngineStats,
    state,
    suggestedRoundActions,
    suggestionIsUpdating,
    suggestion,
    swapFromPlayerId,
    targetReached,
    targetRounds,
    toggleGroupSelection,
    undoRoundSelection,
    workingAlternative,
    error: actionError ?? liveRows.error,
    loadLiveState: async (_options?: { silent?: boolean }): Promise<LiveRows | null> => {
      try {
        return await queryClient.fetchQuery<LiveRows>({
          queryKey: liveSessionQueryKeys.detail(sessionId),
          staleTime: 0,
        })
      } catch {
        return null
      }
    },
    liveStateVersion: deferredRows.liveStateVersion,
    planTelemetry: {
      load_state_ms: liveRows.lastLoadStateMsRef.current,
      suggest_ms: lastSuggestMsRef.current,
      total_plan_ms: liveRows.lastLoadStateMsRef.current !== null && lastSuggestMsRef.current !== null
        ? liveRows.lastLoadStateMsRef.current + lastSuggestMsRef.current
        : null,
    },
    loading: liveRows.loading,
    refreshing: liveRows.refreshing,
    rememberRoundSelection,
  }
}
