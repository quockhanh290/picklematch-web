import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { AlertTriangle, CheckCircle2, Play, RefreshCcw, Star, UserMinus, UserPlus } from 'lucide-react-native'

import { AppLoading } from '@/components/design'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, PRESETS, type CourtPreset } from '@/lib/court-calculator'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { commitCompletedRound } from '@/lib/next-round-suggester/commit'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { detectFairnessIssues, type FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
  computeSessionFairness,
  type SessionFairnessScore,
} from '@/lib/next-round-suggester/fairness/metrics'
import { sanitizeSummaryForHost, sanitizeWarningsForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import { buildSessionSummary, type SessionSummary } from '@/lib/next-round-suggester/fairness/summary'
import type {
  Match,
  PlayerSessionState,
  RoundRecord,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { eloToPvna } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'

type Props = {
  sessionId: string
  players: ArrangementPlayer[]
  courts: number
}

type LiveRows = {
  playerRows: SessionPlayerStateRow[]
  pairRows: SessionPairHistoryRow[]
  roundRows: SessionRoundRow[]
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

function playerName(playerId: string, playersById: Map<string, ArrangementPlayer>) {
  return playersById.get(playerId)?.name ?? 'Người chơi'
}

function getPlayerPvna(player?: ArrangementPlayer | null) {
  if (player?.pvna != null) return Number(player.pvna)
  if (player?.elo != null) return eloToPvna(Number(player.elo))
  return 0
}

function getTeamPvna(team: [string, string], state: SessionState) {
  return team.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 3.0), 0) / 2
}

function getMatchLabel(match: Match, playersById: Map<string, ArrangementPlayer>) {
  const teamA = match.team_a.map(id => playerName(id, playersById)).join(' / ')
  const teamB = match.team_b.map(id => playerName(id, playersById)).join(' / ')
  return `${teamA}  vs  ${teamB}`
}

function formatGender(value?: string | null) {
  const gender = String(value || '').toLowerCase()
  if (gender === 'm' || gender === 'male' || gender === 'nam') return 'M'
  if (gender === 'f' || gender === 'female' || gender === 'nữ' || gender === 'nu') return 'F'
  return '-'
}

function formatPref(value: unknown) {
  const pref = String(value || 'any').toLowerCase()
  if (pref === 'm' || pref === 'male' || pref === 'nam') return 'M'
  if (pref === 'f' || pref === 'female' || pref === 'nữ' || pref === 'nu') return 'F'
  return 'any'
}

function formatGroupLabel(groupId?: string | null) {
  if (!groupId) return '-'
  const parts = groupId.split(':').filter(Boolean)
  return parts.slice(-2).map(part => part.slice(0, 4)).join('-') || 'group'
}

function formatPlayerPreference(playerId: string, playersById: Map<string, ArrangementPlayer>, state: SessionState) {
  const player = playersById.get(playerId)
  const livePlayer = state.players.get(playerId)
  return `${playerName(playerId, playersById)} (${formatGender(player?.gender)} · P:${formatPref(player?.metadata?.partner_gender_pref)} · O:${formatPref(player?.metadata?.opponent_gender_pref)} · G:${formatGroupLabel(livePlayer?.group_id)})`
}

function formatWarning(code: string) {
  switch (code) {
    case 'NOT_ENOUGH_PRESENT':
      return 'Không đủ 4 người đang có mặt'
    case 'MUST_PLAY_OVER_CAPACITY':
      return 'Nhiều người cần vào sân hơn số slot'
    case 'NO_VALID_MATCH':
      return 'Chưa có cặp đấu cân PVNA hợp lệ'
    case 'PARTIAL_COURTS':
      return 'Chỉ đủ người cho một phần số sân'
    case 'MANUAL_SWAP':
      return 'Đã chỉnh tay'
    default:
      return code.replace(/_/g, ' ').toLowerCase()
  }
}

function shortGroupId(groupId: string | null | undefined) {
  if (!groupId) return 'Chưa có group'
  const parts = groupId.split(':')
  return `Group ${parts.slice(-2).map(part => part.slice(0, 4)).join('-')}`
}

type GroupSummary = {
  group_id: string
  label: string
  player_ids: string[]
}

type GroupAuditRow = GroupSummary & {
  shared_matches: number
  pair_counts: Array<{ player_a: string; player_b: string; count: number }>
}

function buildGroupSummaries(rows: SessionPlayerStateRow[]): GroupSummary[] {
  const byGroup = new Map<string, string[]>()

  for (const row of rows) {
    if (!row.group_id) continue
    const current = byGroup.get(row.group_id) ?? []
    current.push(row.player_id)
    byGroup.set(row.group_id, current)
  }

  return [...byGroup.entries()]
    .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
    .map(([groupId, playerIds], index) => ({
      group_id: groupId,
      label: `G${index + 1}`,
      player_ids: playerIds.sort(),
    }))
}

function buildGroupAliasMap(groups: GroupSummary[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const group of groups) {
    aliases.set(group.group_id, group.label)
  }
  return aliases
}

function buildGroupAuditRows(state: SessionState, groups: GroupSummary[]): GroupAuditRow[] {
  return groups.map(group => {
    const memberSet = new Set(group.player_ids)
    let sharedMatches = 0

    for (const round of state.rounds) {
      if (round.status !== 'completed') continue
      for (const match of round.matches) {
        const groupPlayersInMatch = [...match.team_a, ...match.team_b].filter(playerId => memberSet.has(playerId))
        if (groupPlayersInMatch.length >= 2) sharedMatches += 1
      }
    }

    const pairCounts: Array<{ player_a: string; player_b: string; count: number }> = []
    for (let i = 0; i < group.player_ids.length; i += 1) {
      for (let j = i + 1; j < group.player_ids.length; j += 1) {
        const playerA = group.player_ids[i]
        const playerB = group.player_ids[j]
        const count = state.players.get(playerA)?.partner_counts.get(playerB) ?? 0
        pairCounts.push({ player_a: playerA, player_b: playerB, count })
      }
    }

    return {
      ...group,
      shared_matches: sharedMatches,
      pair_counts: pairCounts.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return `${a.player_a}:${a.player_b}`.localeCompare(`${b.player_a}:${b.player_b}`)
      }),
    }
  })
}

function normalizeRoundRow(row: any): SessionRoundRow {
  return {
    id: row.id,
    session_id: row.session_id,
    round_no: row.round_no,
    status: row.status,
    matches: row.matches ?? [],
    resting: row.resting ?? [],
    started_at: row.started_at,
    ended_at: row.ended_at,
  }
}

function isRosterSyncEligible(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  if (player.checkInStatus === 'no_show') return false

  return player.checkInStatus === 'present' || player.checkInStatus === 'checked_in' || !player.checkInStatus
}

function isConfirmedNonNoShow(player: ArrangementPlayer) {
  if (player.status && player.status !== 'confirmed') return false
  return player.checkInStatus !== 'no_show'
}

function withWeights(state: SessionState, weights: SessionState['config']['weights']): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      weights,
    },
  }
}

function fairnessLabel(score: SessionFairnessScore) {
  if (score.grade === 'excellent') return 'Rất đều'
  if (score.grade === 'good') return 'Đều'
  if (score.grade === 'acceptable') return 'Tạm ổn'
  return 'Cần chỉnh'
}

function warningTone(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' }
  if (severity === 'warning') return { bg: '#FFF7D6', border: '#E5B94E', text: '#92400E' }
  return { bg: '#EAF4FF', border: '#9CC7F2', text: '#1D4E89' }
}

function previewStateAfterAlternative(
  state: SessionState,
  alternative: SuggestionAlternative,
): SessionState {
  const round: RoundRecord = {
    session_id: state.session_id,
    round_no: state.current_round,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: null,
    ended_at: null,
  }
  const committed = commitCompletedRound(state, round, pairRowsFromState(state))

  return {
    ...state,
    current_round: state.current_round + 1,
    players: applyPairHistoryToPlayers(committed.players, committed.pairHistory),
    rounds: [...state.rounds, round],
  }
}

function severityRank(severity: FairnessWarning['severity']) {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function buildFairnessWarningsForBanner(
  currentWarnings: FairnessWarning[],
  projectedWarnings: FairnessWarning[],
): FairnessWarning[] {
  const current = sanitizeWarningsForHost(currentWarnings)
  const currentKeys = new Set(current.map(warningIdentity))
  const projected = sanitizeWarningsForHost(projectedWarnings)
    .filter(warning => !currentKeys.has(warningIdentity(warning)))
    .map(toProjectedWarning)

  return [...current, ...projected].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity)
    if (severityDiff !== 0) return severityDiff
    return warningIdentity(a).localeCompare(warningIdentity(b))
  })
}

function warningIdentity(warning: FairnessWarning): string {
  return `${warning.type}:${[...warning.affected_players].sort().join(',')}`
}

function toProjectedWarning(warning: FairnessWarning): FairnessWarning {
  return {
    ...warning,
    message: `Neu start phuong an nay: ${projectWarningMessage(warning.message)}`,
    suggested_action: projectSuggestedAction(warning.suggested_action),
  }
}

function projectWarningMessage(message: string): string {
  return message
    .replace(' da doi dau ', ' se doi dau ')
    .replace(' da danh chung ', ' se danh chung ')
    .replace(' da nghi ', ' se nghi ')
}

function projectSuggestedAction(action: string): string {
  return action.replace('Engine se ', 'Engine dang ')
}

function pairRowsFromState(state: SessionState): SessionPairHistoryRow[] {
  const rows = new Map<string, SessionPairHistoryRow>()

  for (const player of state.players.values()) {
    for (const [partnerId, partnerCount] of player.partner_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, partnerId, { partner_count: partnerCount })
    }

    for (const [opponentId, opponentCount] of player.opponent_counts) {
      upsertPairRow(rows, state.session_id, player.player_id, opponentId, { opponent_count: opponentCount })
    }
  }

  return [...rows.values()]
}

function upsertPairRow(
  rows: Map<string, SessionPairHistoryRow>,
  sessionId: string,
  playerA: string,
  playerB: string,
  patch: Partial<Pick<SessionPairHistoryRow, 'partner_count' | 'opponent_count'>>,
) {
  const [a, b] = playerA < playerB ? [playerA, playerB] : [playerB, playerA]
  const key = `${a}:${b}`
  const existing = rows.get(key) ?? {
    session_id: sessionId,
    player_a: a,
    player_b: b,
    partner_count: 0,
    opponent_count: 0,
  }

  rows.set(key, {
    ...existing,
    partner_count: Math.max(existing.partner_count, patch.partner_count ?? 0),
    opponent_count: Math.max(existing.opponent_count, patch.opponent_count ?? 0),
  })
}

function applyPairHistoryToPlayers(
  players: Map<string, PlayerSessionState>,
  rows: SessionPairHistoryRow[],
) {
  for (const player of players.values()) {
    player.partner_counts = new Map()
    player.opponent_counts = new Map()
  }

  for (const row of rows) {
    const playerA = players.get(row.player_a)
    const playerB = players.get(row.player_b)
    if (!playerA || !playerB) continue

    playerA.partner_counts.set(row.player_b, row.partner_count)
    playerB.partner_counts.set(row.player_a, row.partner_count)
    playerA.opponent_counts.set(row.player_b, row.opponent_count)
    playerB.opponent_counts.set(row.player_a, row.opponent_count)
  }

  return players
}

type FairnessAudit = {
  round_no: number
  before_total: number
  after_total: number
  delta_total: number
  rows: Array<{
    key: keyof SessionFairnessScore['breakdown']
    label: string
    before: number
    after: number
    delta: number
    detail: string
  }>
}

type FairnessPreview = Omit<FairnessAudit, 'round_no'>

function buildFairnessPreview(
  state: SessionState,
  alternative: SuggestionAlternative | null | undefined,
): FairnessPreview | null {
  if (!alternative) return null

  const afterState = previewStateAfterAlternative(state, alternative)
  const beforeScore = computeSessionFairness(state)
  const afterScore = computeSessionFairness(afterState)
  const rows = ([
    ['match_count', 'So tran', describeMatchCount(afterState)],
    ['partner_diversity', 'Partner', describePartnerDiversity(afterState)],
    ['opponent_diversity', 'Doi thu', describeOpponentDiversity(afterState)],
    ['rest', 'Nghi', describeRestFairness(afterState)],
    ['gender_prefs', 'Gender pref', describeGenderPrefs(afterState)],
  ] as Array<[keyof SessionFairnessScore['breakdown'], string, string]>).map(([key, label, detail]) => {
    const before = beforeScore.breakdown[key]
    const after = afterScore.breakdown[key]
    return {
      key,
      label,
      before,
      after,
      delta: after - before,
      detail,
    }
  })

  return {
    before_total: beforeScore.total,
    after_total: afterScore.total,
    delta_total: afterScore.total - beforeScore.total,
    rows,
  }
}

type MatchCountConsistencyRow = {
  player_id: string
  live: number
  replay: number
}

function buildMatchCountConsistencyRows(
  liveState: SessionState,
  replayState: SessionState,
): MatchCountConsistencyRow[] {
  const playerIds = new Set([
    ...liveState.players.keys(),
    ...replayState.players.keys(),
  ])

  return [...playerIds]
    .map((playerId) => ({
      player_id: playerId,
      live: liveState.players.get(playerId)?.matches_played ?? 0,
      replay: replayState.players.get(playerId)?.matches_played ?? 0,
    }))
    .filter((row) => row.live !== row.replay)
    .sort((a, b) => {
      const diffA = Math.abs(a.live - a.replay)
      const diffB = Math.abs(b.live - b.replay)
      if (diffA !== diffB) return diffB - diffA
      return a.player_id.localeCompare(b.player_id)
    })
}

function buildLatestFairnessAudit(state: SessionState): FairnessAudit | null {
  const completedRounds = state.rounds
    .filter((round) => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
  const latestRound = completedRounds[completedRounds.length - 1]
  if (!latestRound) return null

  const beforeState = rebuildStateThroughRound(state, latestRound.round_no - 1)
  const afterState = rebuildStateThroughRound(state, latestRound.round_no)
  const beforeScore = computeSessionFairness(beforeState)
  const afterScore = computeSessionFairness(afterState)
  const rows = ([
    ['match_count', 'So tran', describeMatchCount(afterState)],
    ['partner_diversity', 'Partner', describePartnerDiversity(afterState)],
    ['opponent_diversity', 'Doi thu', describeOpponentDiversity(afterState)],
    ['rest', 'Nghi', describeRestFairness(afterState)],
    ['gender_prefs', 'Gender pref', describeGenderPrefs(afterState)],
  ] as Array<[keyof SessionFairnessScore['breakdown'], string, string]>).map(([key, label, detail]) => {
    const before = beforeScore.breakdown[key]
    const after = afterScore.breakdown[key]
    return {
      key,
      label,
      before,
      after,
      delta: after - before,
      detail,
    }
  })

  return {
    round_no: latestRound.round_no,
    before_total: beforeScore.total,
    after_total: afterScore.total,
    delta_total: afterScore.total - beforeScore.total,
    rows,
  }
}

function rebuildStateThroughRound(state: SessionState, maxRoundNo: number): SessionState {
  const basePlayers = new Map<string, PlayerSessionState>(
    [...state.players].map(([playerId, player]) => [
      playerId,
      {
        ...player,
        matches_played: 0,
        last_played_round: -1,
        consecutive_rest: 0,
        consecutive_play: 0,
        partner_counts: new Map(),
        opponent_counts: new Map(),
      },
    ]),
  )
  let rebuilt: SessionState = {
    ...state,
    current_round: 0,
    players: basePlayers,
    rounds: [],
  }

  for (const round of state.rounds
    .filter((item) => item.status === 'completed' && item.round_no <= maxRoundNo)
    .sort((a, b) => a.round_no - b.round_no)) {
    const committed = commitCompletedRound(rebuilt, round, pairRowsFromState(rebuilt))
    rebuilt = {
      ...rebuilt,
      current_round: round.round_no + 1,
      players: applyPairHistoryToPlayers(committed.players, committed.pairHistory),
      rounds: [...rebuilt.rounds, round],
    }
  }

  return rebuilt
}

function describeMatchCount(state: SessionState): string {
  const metrics = computeMatchCountMetrics(state)
  return `min ${metrics.min}, max ${metrics.max}, avg ${metrics.avg.toFixed(1)}, range ${metrics.range}`
}

function describePartnerDiversity(state: SessionState): string {
  const metrics = computePartnerDiversity(state)
  return `avg unique ${metrics.avg_unique_partners.toFixed(1)}, ratio ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(20 * metrics.avg_diversity_ratio).toFixed(1)}/20, repeat pairs ${metrics.repeat_pairs.length}`
}

function describeOpponentDiversity(state: SessionState): string {
  const metrics = computeOpponentDiversity(state)
  const burden = computeOpponentRepeatBurden(state)
  return `avg unique ${(metrics.avg_unique_opponents ?? metrics.avg_unique_partners).toFixed(1)}, ratio ${(metrics.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(15 * metrics.avg_diversity_ratio).toFixed(1)}/15, repeat pairs ${metrics.repeat_pairs.length}, max burden ${burden.max_repeated_opponents}`
}

function describeRestFairness(state: SessionState): string {
  const metrics = computeRestFairness(state)
  const maxRest = Math.max(0, ...metrics.per_player.map((player) => player.max_consecutive_rest))
  return `max lien tiep ${maxRest}, violations ${metrics.violations.length}`
}

function describeGenderPrefs(state: SessionState): string {
  const metrics = computeGenderPrefSatisfaction(state)
  if (metrics.total_pref_opportunities === 0) return 'khong co preference opportunity'
  return `${metrics.satisfied_count}/${metrics.total_pref_opportunities} satisfied (${Math.round(metrics.satisfaction_rate * 100)}%)`
}

const COURT_PRESET_OPTIONS: CourtPreset[] = ['play_more', 'balanced', 'relaxed']
const COURT_DURATION_OPTIONS = [90, 120, 150]

export function NextRoundSuggesterScreen({ sessionId, players, courts }: Props) {
  const theme = useAppTheme()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rows, setRows] = useState<LiveRows>({ playerRows: [], pairRows: [], roundRows: [] })
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCount, setCourtCount] = useState(Math.max(1, Math.min(4, courts)))
  const [courtPreset, setCourtPreset] = useState<CourtPreset>('balanced')
  const [courtDurationMin, setCourtDurationMin] = useState(120)
  const [targetRounds, setTargetRounds] = useState(8)
  const [showSessionReport, setShowSessionReport] = useState(false)
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])

  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed' || !player.status),
    [players],
  )
  const checkedInPlayers = useMemo(
    () => {
      const explicitlyPresent = confirmedPlayers.filter(isRosterSyncEligible)
      return explicitlyPresent.length > 0 ? explicitlyPresent : confirmedPlayers.filter(isConfirmedNonNoShow)
    },
    [confirmedPlayers],
  )
  const playersById = useMemo(
    () => new Map(players.map(player => [String(player.id), player])),
    [players],
  )

  const loadLiveState = useCallback(async () => {
    setError(null)
    const [playerRes, pairRes, roundRes] = await Promise.all([
      supabase
        .from('session_player_state')
        .select('*')
        .eq('session_id', sessionId)
        .order('checked_in_at', { ascending: true }),
      supabase
        .from('session_pair_history')
        .select('*')
        .eq('session_id', sessionId)
        .order('player_a', { ascending: true }),
      supabase
        .from('session_rounds')
        .select('*')
        .eq('session_id', sessionId)
        .order('round_no', { ascending: true }),
    ])

    const nextError = playerRes.error ?? pairRes.error ?? roundRes.error
    if (nextError) {
      setError(nextError.message)
      return
    }

    setRows({
      playerRows: ((playerRes.data ?? []) as any[]).map(row => ({
        ...row,
        players: {
          pvna: getPlayerPvna(playersById.get(row.player_id)),
          elo: playersById.get(row.player_id)?.elo,
          gender: playersById.get(row.player_id)?.gender,
          partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref,
          opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref,
        },
        session_players: {
          metadata: playersById.get(row.player_id)?.metadata ?? null,
        },
      })),
      pairRows: (pairRes.data ?? []) as SessionPairHistoryRow[],
      roundRows: ((roundRes.data ?? []) as any[]).map(normalizeRoundRow),
    })
  }, [playersById, sessionId])

  React.useEffect(() => {
    let mounted = true
    async function run() {
      setLoading(true)
      await loadLiveState()
      if (mounted) setLoading(false)
    }
    void run()
    return () => {
      mounted = false
    }
  }, [loadLiveState])

  const rawState = useMemo(() => mapRowsToSessionState({
    sessionId,
    playerRows: rows.playerRows.map(row => ({
      ...row,
      players: {
        pvna: getPlayerPvna(playersById.get(row.player_id)) || row.players?.pvna || 0,
        elo: row.players?.elo,
        gender: playersById.get(row.player_id)?.gender ?? row.players?.gender,
        partner_gender_pref: playersById.get(row.player_id)?.metadata?.partner_gender_pref ?? row.players?.partner_gender_pref,
        opponent_gender_pref: playersById.get(row.player_id)?.metadata?.opponent_gender_pref ?? row.players?.opponent_gender_pref,
      },
      session_players: {
        metadata: playersById.get(row.player_id)?.metadata ?? row.session_players?.metadata ?? null,
      },
    })),
    pairRows: rows.pairRows,
    roundRows: rows.roundRows,
    courts: courtCount,
    pvnaTolerance,
  }), [courtCount, playersById, pvnaTolerance, rows, sessionId])

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

  const suggestion = useMemo(
    () => suggestNextRound(state, { tier_overrides: fairnessAdjustment.tier_overrides }),
    [fairnessAdjustment.tier_overrides, state],
  )
  const selected = suggestion.alternatives[selectedAlternative] ?? suggestion.alternatives[0]
  const workingAlternative = manualAlternative ?? selected
  const fairnessScore = useMemo(() => computeSessionFairness(state), [state])
  const fairnessPreview = useMemo(
    () => buildFairnessPreview(state, workingAlternative),
    [state, workingAlternative],
  )
  const fairnessAudit = useMemo(() => buildLatestFairnessAudit(state), [state])
  const fairnessWarnings = useMemo(
    () => {
      const currentWarnings = detectFairnessIssues(state)
      const projectedState = workingAlternative
        ? previewStateAfterAlternative(state, workingAlternative)
        : null
      const projectedWarnings = projectedState ? detectFairnessIssues(projectedState) : []

      return buildFairnessWarningsForBanner(currentWarnings, projectedWarnings)
    },
    [state, workingAlternative],
  )
  const activeRound = useMemo(
    () => rows.roundRows.find(row => row.status === 'active') ?? null,
    [rows.roundRows],
  )
  const presentCount = rows.playerRows.filter(row => !row.checked_out_at).length
  const calculatorPlayerCount = presentCount || checkedInPlayers.length || confirmedPlayers.length
  const maxSelectableCourts = Math.max(1, Math.floor(Math.max(calculatorPlayerCount, presentCount) / 4), courts)
  const courtCalculator = useMemo(() => calculateOptimalCourts({
    n_players: calculatorPlayerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [calculatorPlayerCount, courtDurationMin, courtPreset])
  const optedRestCount = rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length
  const completedRounds = rows.roundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no)
  const completedRoundCount = completedRounds.length
  const targetReached = targetRounds > 0 && completedRoundCount >= targetRounds
  const reportState = useMemo(
    () => (completedRoundCount > 0 ? rebuildStateThroughRound(state, completedRounds[0].round_no) : state),
    [completedRoundCount, completedRounds, state],
  )
  const sessionSummary = useMemo(() => sanitizeSummaryForHost(buildSessionSummary(reportState)), [reportState])
  const matchCountConsistencyRows = useMemo(
    () => buildMatchCountConsistencyRows(state, reportState),
    [reportState, state],
  )
  const groupSummaries = useMemo(() => buildGroupSummaries(rows.playerRows), [rows.playerRows])
  const groupAliases = useMemo(() => buildGroupAliasMap(groupSummaries), [groupSummaries])

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
      await loadLiveState()
    } catch (err: any) {
      setError(err?.message ?? 'Action failed')
      Alert.alert('Lỗi', err?.message ?? 'Không thể thực hiện thao tác')
    } finally {
      setBusy(null)
    }
  }

  const syncRoster = async () => {
    await runAction('sync', async () => {
      const playerIds = checkedInPlayers.map(player => String(player.id))
      if (playerIds.length === 0) {
        throw new Error('No confirmed players to sync. Confirm at least one player before syncing roster.')
      }

      await invokeLiveSessionFunction('session-sync-roster', sessionId, {
        player_ids: playerIds,
      })
    })
  }

  const setGroupForPlayers = async (playerIds: string[]) => {
    if (playerIds.length < 2) return

    await runAction(`group-${playerIds.join('-')}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        player_ids: playerIds,
      })
    })
  }

  const clearGroup = async (playerId: string) => {
    await runAction(`group-clear-${playerId}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        clear_player_id: playerId,
      })
    })
  }

  const clearWholeGroup = async (groupId: string) => {
    await runAction(`group-clear-${groupId}`, async () => {
      await invokeLiveSessionFunction('session-set-group', sessionId, {
        clear_group_id: groupId,
      })
    })
  }

  const toggleGroupSelection = (playerId: string) => {
    setGroupSelection(current => (
      current.includes(playerId)
        ? current.filter(id => id !== playerId)
        : [...current, playerId]
    ))
  }

  const createGroupFromSelection = async () => {
    if (groupSelection.length < 2) return
    await setGroupForPlayers(groupSelection)
    setGroupSelection([])
  }

  const toggleCheckout = async (playerId: string, checkedOut: boolean) => {
    await runAction(`checkout-${playerId}`, async () => {
      await invokeLiveSessionFunction(
        checkedOut ? 'session-checkin' : 'session-checkout',
        sessionId,
        { player_id: playerId },
      )
    })
  }

  const toggleRest = async (playerId: string, optedRest: boolean) => {
    await runAction(`rest-${playerId}`, async () => {
      await invokeLiveSessionFunction('session-request-rest', sessionId, {
        player_id: playerId,
        opted_rest: !optedRest,
      })
    })
  }

  const startRound = async (alternative: SuggestionAlternative) => {
    await runAction('start', async () => {
      if (activeRound) throw new Error('Đang có vòng active. Hãy end vòng hiện tại trước.')

      await invokeLiveSessionFunction('session-rounds-start', sessionId, {
        manual: alternative.matches,
      })
    })
  }

  const endActiveRound = async () => {
    await runAction('end', async () => {
      if (!activeRound) throw new Error('Không có vòng active.')

      const payload = await invokeLiveSessionFunction('session-rounds-end', sessionId, {}, { round_no: activeRound.round_no })
      const invalidDeltas = payload?.commit_audit?.deltas?.filter((row: any) =>
        row?.played ? row?.delta !== 1 : row?.delta !== 0
      ) ?? []
      if (invalidDeltas.length > 0) {
        throw new Error(`Commit audit mismatch: ${invalidDeltas.length} player counts changed unexpectedly.`)
      }
    })
  }

  React.useEffect(() => {
    setManualAlternative(null)
    setSwapFromPlayerId(null)
  }, [selectedAlternative, suggestion])

  const swapPlayersInWorkingAlternative = (fromId: string, toId: string) => {
    const base = manualAlternative ?? suggestion.alternatives[selectedAlternative]
    if (!base || fromId === toId) return

    const nextMatches = base.matches.map(match => ({
      ...match,
      team_a: match.team_a.map(id => id === fromId ? toId : id === toId ? fromId : id) as [string, string],
      team_b: match.team_b.map(id => id === fromId ? toId : id === toId ? fromId : id) as [string, string],
    }))
    const nextResting = base.resting.map(id => id === toId ? fromId : id === fromId ? toId : id)
    const restingSet = new Set(nextResting)
    const allPlaying = new Set(nextMatches.flatMap(match => [...match.team_a, ...match.team_b]))

    if (allPlaying.size !== nextMatches.length * 4) {
      setError('Swap không hợp lệ: một người bị trùng trong cùng vòng.')
      return
    }

    setManualAlternative({
      ...base,
      matches: nextMatches,
      resting: [...restingSet].filter(id => !allPlaying.has(id)).sort(),
      warnings: [...new Set([...base.warnings, 'MANUAL_SWAP'])],
    })
    setSwapFromPlayerId(null)
  }

  if (loading) return <AppLoading fullScreen />

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, borderWidth: 1, borderColor: '#E5E3DC', ...SHADOW.sm }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: '#1A2E2A', fontWeight: '900' }}>
          NEXT ROUND SUGGESTER
        </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#596864', marginTop: 6, lineHeight: 18 }}>
          Test realtime: sync theo trạng thái check-in hiện tại, host check-in/out, request rest, suggest vòng kế tiếp, start và end round.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {[
            ['Round', String(state.current_round)],
            ['Có mặt', `${presentCount}/${checkedInPlayers.length}`],
            ['Xin nghỉ', String(optedRestCount)],
            ['Sân', String(courtCount)],
            ['PVNA diff', pvnaTolerance.toFixed(1)],
          ].map(([label, value]) => (
            <View key={label} style={{ minWidth: 74, flex: 1, backgroundColor: '#F8F3E8', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '900' }}>{label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: '#1A2E2A', fontWeight: '900', marginTop: 2 }}>{value}</Text>
            </View>
          ))}
        </View>

        {error && (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#B91C1C', marginTop: 12 }}>
            {error}
          </Text>
        )}

        <View style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginBottom: 8 }}>
            Số sân dùng vòng này
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Array.from({ length: maxSelectableCourts }, (_, index) => index + 1).map(value => {
              const active = courtCount === value
              const disabled = value > Math.max(1, Math.floor(calculatorPlayerCount / 4))
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setCourtCount(value)}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 9,
                    alignItems: 'center',
                    backgroundColor: active ? '#0F6E56' : '#F8F3E8',
                    borderWidth: 1,
                    borderColor: active ? '#0F6E56' : '#E5E3DC',
                    opacity: disabled ? 0.35 : 1,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                    {value}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ marginTop: 14, backgroundColor: '#F8F3E8', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginBottom: 8 }}>
            Court calculator test
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            {COURT_PRESET_OPTIONS.map(preset => {
              const active = courtPreset === preset
              return (
                <TouchableOpacity
                  key={preset}
                  onPress={() => setCourtPreset(preset)}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: active ? '#0F6E56' : '#FFFCF5',
                    borderWidth: 1,
                    borderColor: active ? '#0F6E56' : '#E5E3DC',
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                    {PRESETS[preset].label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {COURT_DURATION_OPTIONS.map(duration => {
              const active = courtDurationMin === duration
              return (
                <TouchableOpacity
                  key={duration}
                  onPress={() => setCourtDurationMin(duration)}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: active ? '#1A2E2A' : '#FFFCF5',
                    borderWidth: 1,
                    borderColor: active ? '#1A2E2A' : '#E5E3DC',
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                    {duration}p
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#0F6E56', fontWeight: '900' }}>
            Goi y: {courtCalculator.recommended.courts} san
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864', marginTop: 4, lineHeight: 16 }}>
            {courtCalculator.reasoning}
          </Text>
          <View style={{ gap: 6, marginTop: 10 }}>
            {courtCalculator.alternatives.map(option => {
              const active = courtCount === option.courts
              return (
                <TouchableOpacity
                  key={option.courts}
                  disabled={option.feasibility === 'infeasible'}
                  onPress={() => setCourtCount(option.courts)}
                  style={{
                    borderRadius: 10,
                    padding: 9,
                    backgroundColor: active ? '#E1F5EE' : '#FFFCF5',
                    borderWidth: 1,
                    borderColor: active ? '#88D4B5' : '#E5E3DC',
                    opacity: option.feasibility === 'infeasible' ? 0.45 : 1,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
                    {option.courts} san - {option.avg_matches_per_player.toFixed(1)} tran/nguoi - {option.feasibility}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 3 }}>
                    Rotation {(option.play_ratio * 100).toFixed(0)}% - quality {option.quality_score.toFixed(2)}
                  </Text>
                  {option.quality_notes[0] && (
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 3 }}>
                      {option.quality_notes[0]}
                    </Text>
                  )}
                  {option.warnings[0] && (
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#92400E', marginTop: 3 }}>
                      {option.warnings[0]}
                    </Text>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E5E3DC' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginBottom: 8 }}>
              Muc tieu session
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {[Math.max(1, courtCalculator.recommended.total_rounds - 2), courtCalculator.recommended.total_rounds, courtCalculator.recommended.total_rounds + 2]
                .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
                .map(value => {
                  const active = targetRounds === value
                  return (
                    <TouchableOpacity
                      key={`target-rounds-${value}`}
                      onPress={() => {
                        setTargetRounds(value)
                        setShowSessionReport(false)
                      }}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        paddingVertical: 8,
                        alignItems: 'center',
                        backgroundColor: active ? '#0F6E56' : '#FFFCF5',
                        borderWidth: 1,
                        borderColor: active ? '#0F6E56' : '#E5E3DC',
                      }}
                    >
                      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                        {value} vong
                      </Text>
                    </TouchableOpacity>
                  )
                })}
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: targetReached ? '#0F6E56' : '#596864', fontWeight: '900' }}>
              Progress: {completedRoundCount}/{targetRounds} vong
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <ActionButton
            label="Sync roster"
            icon={<RefreshCcw size={16} color="white" />}
            loading={busy === 'sync'}
            onPress={syncRoster}
          />
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginBottom: 8 }}>
            Tolerance cân trình theo PVNA
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0.3, 0.5, 0.8, 1.0].map(value => {
              const active = pvnaTolerance === value
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setPvnaTolerance(value)}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 9,
                    alignItems: 'center',
                    backgroundColor: active ? '#0F6E56' : '#F8F3E8',
                    borderWidth: 1,
                    borderColor: active ? '#0F6E56' : '#E5E3DC',
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                    ±{value.toFixed(1)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>

        <FairnessBanner
          score={fairnessScore}
          warnings={fairnessWarnings}
          playersById={playersById}
          adjustmentReasons={fairnessAdjustment.applied_for_warnings}
        />

      {targetReached && !activeRound && (
        <View style={{ backgroundColor: '#E1F5EE', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#88D4B5' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#0F6E56', fontWeight: '900' }}>
            Da du muc tieu {targetRounds} vong
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#0F6E56', marginTop: 5, lineHeight: 16 }}>
            Nen ket thuc session va xem report fairness. Host van co the chay them vong neu con gio.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <ActionButton
              label={showSessionReport ? 'An report' : 'Xem report'}
              icon={<Star size={16} color="white" />}
              onPress={() => setShowSessionReport(current => !current)}
            />
            {workingAlternative && (
              <ActionButton
                label="Chay them vong"
                icon={<Play size={16} color="white" />}
                loading={busy === 'start'}
                disabled={Boolean(activeRound)}
                onPress={() => startRound(workingAlternative)}
              />
            )}
          </View>
        </View>
      )}

      {activeRound && (
        <View style={{ backgroundColor: '#E1F5EE', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#88D4B5' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#0F6E56', fontWeight: '900' }}>
            VÒNG {activeRound.round_no} ĐANG CHẠY
          </Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            {activeRound.matches.map(match => (
              <MatchCard key={`active-${match.court_idx}`} match={match} state={state} playersById={playersById} />
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <ActionButton
              label="End round & commit"
              icon={<CheckCircle2 size={16} color="white" />}
              loading={busy === 'end'}
              onPress={endActiveRound}
              danger={false}
            />
          </View>
        </View>
      )}

      <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', fontWeight: '900' }}>
          Người chơi live
        </Text>
        <View style={{ gap: 8, marginTop: 10 }}>
          {rows.playerRows.length === 0 ? (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884' }}>
              Chưa có live state. Bấm Sync roster để lấy những người đã check-in có mặt.
            </Text>
          ) : rows.playerRows.map(row => {
            const player = playersById.get(row.player_id)
            const checkedOut = Boolean(row.checked_out_at)
            return (
              <View key={row.player_id} style={{ backgroundColor: checkedOut ? '#F3F0EA' : '#F8F3E8', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>
                      {player?.name ?? row.player_id}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 3, fontWeight: '800' }}>
                      {row.group_id ? `${groupAliases.get(row.group_id) ?? shortGroupId(row.group_id)} · ${shortGroupId(row.group_id)}` : shortGroupId(row.group_id)}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
                      PVNA {getPlayerPvna(player).toFixed(2)} · Trận {row.matches_played} · Nghỉ {row.consecutive_rest} · Chơi liền {row.consecutive_play}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <MiniButton
                      label={groupSelection.includes(row.player_id) ? 'Picked' : row.group_id ? 'Move group' : 'Group'}
                      loading={busy?.startsWith('group-')}
                      onPress={() => toggleGroupSelection(row.player_id)}
                      muted={groupSelection.includes(row.player_id)}
                    />
                    {row.group_id && (
                      <MiniButton
                        label="Clear"
                        loading={busy === `group-clear-${row.player_id}`}
                        onPress={() => clearGroup(row.player_id)}
                        muted
                      />
                    )}
                    <MiniButton
                      label={checkedOut ? 'In' : 'Out'}
                      icon={checkedOut ? <UserPlus size={13} color="white" /> : <UserMinus size={13} color="white" />}
                      loading={busy === `checkout-${row.player_id}`}
                      onPress={() => toggleCheckout(row.player_id, checkedOut)}
                    />
                    <MiniButton
                      label={row.opted_rest ? 'Play' : 'Rest'}
                      loading={busy === `rest-${row.player_id}`}
                      onPress={() => toggleRest(row.player_id, row.opted_rest)}
                      muted={row.opted_rest}
                    />
                  </View>
                </View>
              </View>
            )
          })} 
        </View>
        {rows.playerRows.length > 0 && (
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
            {groupSummaries.length > 0 && (
              <View style={{ gap: 7 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
                  Group hien tai
                </Text>
                {groupSummaries.map(group => (
                  <View key={group.group_id} style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC', gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
                        {group.label}: {group.player_ids.map(id => playerName(id, playersById)).join(', ')}
                      </Text>
                      <MiniButton
                        label="Clear group"
                        loading={busy === `group-clear-${group.group_id}`}
                        onPress={() => clearWholeGroup(group.group_id)}
                        muted
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
              Group ban: chon 2+ nguoi roi tao group. Group chi la bonus, khong bat buoc cung team.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ActionButton
                label={`Tao group (${groupSelection.length})`}
                loading={busy?.startsWith('group-')}
                disabled={groupSelection.length < 2}
                onPress={createGroupFromSelection}
              />
              <ActionButton
                label="Bo chon"
                disabled={groupSelection.length === 0}
                onPress={() => setGroupSelection([])}
                danger
              />
            </View>
          </View>
        )}
      </View>

      <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', fontWeight: '900' }}>
              Gợi ý vòng kế tiếp
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
              {suggestion.should_end ? 'Không đủ người để chơi tiếp.' : `${suggestion.alternatives.length} phương án`}
            </Text>
          </View>
          {suggestion.warnings.length > 0 && (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#A05A16', fontWeight: '900' }}>
              {suggestion.warnings.map(formatWarning).join(' · ')}
            </Text>
          )}
        </View>

        {suggestion.alternatives.length === 0 ? (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#7A8884', marginTop: 12 }}>
            {suggestion.should_end ? 'Suggest end: cần ít nhất 4 người đang có mặt và không xin nghỉ.' : 'Không có split hợp lệ theo tolerance hiện tại.'}
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {suggestion.alternatives.map((alternative, index) => (
                <TouchableOpacity
                  key={`alt-${index}`}
                  onPress={() => {
                    setSelectedAlternative(index)
                    setManualAlternative(null)
                    setSwapFromPlayerId(null)
                  }}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 9,
                    alignItems: 'center',
                    backgroundColor: selectedAlternative === index ? '#0F6E56' : '#F8F3E8',
                    borderWidth: 1,
                    borderColor: selectedAlternative === index ? '#0F6E56' : '#E5E3DC',
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: selectedAlternative === index ? 'white' : '#596864', fontWeight: '900' }}>
                    Alt {index + 1} · {alternative.score.toFixed(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {workingAlternative && (
              <View style={{ gap: 10, marginTop: 12 }}>
                <SuggestionStatsCard alternative={workingAlternative} />
                {fairnessPreview && (
                  <FairnessPreviewCard preview={fairnessPreview} />
                )}
                {workingAlternative.matches.map(match => (
                  <MatchCard key={`suggest-${match.court_idx}`} match={match} state={state} playersById={playersById} />
                ))}
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864' }}>
                  Nghỉ: {workingAlternative.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'} · Iter {workingAlternative.iterations ?? '-'} · {workingAlternative.runtime_ms ?? 0}ms
                </Text>
                <ManualSwapPanel
                  alternative={workingAlternative}
                  playersById={playersById}
                  selectedPlayerId={swapFromPlayerId}
                  onSelectPlayer={setSwapFromPlayerId}
                  onSwap={swapPlayersInWorkingAlternative}
                  onReset={() => {
                    setManualAlternative(null)
                    setSwapFromPlayerId(null)
                  }}
                />
                <ActionButton
                  label={targetReached ? 'Chay them vong' : 'Start selected round'}
                  icon={<Play size={16} color="white" />}
                  loading={busy === 'start'}
                  disabled={Boolean(activeRound)}
                  onPress={() => startRound(workingAlternative)}
                />
              </View>
            )}
          </>
        )}
      </View>
      {completedRounds.length > 0 && showSessionReport && (
        <SessionFairnessSummaryCard
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          playersById={playersById}
          durationMinutes={courtDurationMin}
          groupSummaries={groupSummaries}
        />
      )}
      {fairnessAudit && (
        <FairnessAuditCard audit={fairnessAudit} />
      )}
      {completedRounds.length > 0 && (
        <CompletedRoundsRecap rounds={completedRounds} state={state} playersById={playersById} />
      )}
    </ScrollView>
  )
}

async function invokeLiveSessionFunction(
  functionName: string,
  sessionId: string,
  body: Record<string, unknown> = {},
  extraQuery: Record<string, string | number> = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase function configuration')
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Host login expired')
  }

  const query = new URLSearchParams({ session_id: sessionId })
  Object.entries(extraQuery).forEach(([key, value]) => query.set(key, String(value)))

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Edge Function ${functionName} failed`)
  }

  return payload
}

function FairnessBanner({
  score,
  warnings,
  playersById,
  adjustmentReasons,
}: {
  score: SessionFairnessScore
  warnings: FairnessWarning[]
  playersById: Map<string, ArrangementPlayer>
  adjustmentReasons: string[]
}) {
  const primaryWarning = warnings.find(warning => warning.severity === 'critical') ?? warnings[0]
  const tone = primaryWarning ? warningTone(primaryWarning.severity) : { bg: '#E1F5EE', border: '#88D4B5', text: '#0F6E56' }

  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: RADIUS.xl, padding: 14, marginTop: 14, borderWidth: 1, borderColor: tone.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {primaryWarning ? <AlertTriangle size={18} color={tone.text} /> : <Star size={18} color={tone.text} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: tone.text, fontWeight: '900' }}>
            Fairness {score.total}/100 · {fairnessLabel(score)}
          </Text>
          {primaryWarning ? (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: tone.text, marginTop: 4, lineHeight: 16 }}>
              {primaryWarning.message} {formatAffectedPlayers(primaryWarning.affected_players, playersById)}
            </Text>
          ) : (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: tone.text, marginTop: 4 }}>
              Không có cảnh báo fairness ở thời điểm này.
            </Text>
          )}
        </View>
      </View>
      {primaryWarning && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: tone.text, marginTop: 8, lineHeight: 15 }}>
          Gợi ý: {primaryWarning.suggested_action}
        </Text>
      )}
      {adjustmentReasons.length > 0 && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 8, lineHeight: 15 }}>
          Engine tự hiệu chỉnh: {adjustmentReasons.join(', ').replace(/_/g, ' ')}
        </Text>
      )}
    </View>
  )
}

function SessionFairnessSummaryCard({
  summary,
  state,
  matchCountConsistencyRows,
  playersById,
  durationMinutes,
  groupSummaries,
}: {
  summary: SessionSummary
  state: SessionState
  matchCountConsistencyRows: MatchCountConsistencyRow[]
  playersById: Map<string, ArrangementPlayer>
  durationMinutes?: number
  groupSummaries: GroupSummary[]
}) {
  const maxMatches = Math.max(1, ...summary.per_player.map(player => player.matches_played))
  const matchCounts = summary.per_player.map(player => player.matches_played)
  const matchRange = matchCounts.length === 0 ? 0 : Math.max(...matchCounts) - Math.min(...matchCounts)
  const displayedDuration = durationMinutes ?? summary.duration_minutes
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const rest = computeRestFairness(state)
  const gender = computeGenderPrefSatisfaction(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const groupAuditRows = buildGroupAuditRows(state, groupSummaries)
  const breakdown = summary.fairness_score.breakdown
  const partnerRepeats = partner.repeat_pairs.filter(pair => pair.count > 1)
  const opponentRepeats = opponent.repeat_pairs.filter(pair => pair.count > 1)
  const breakdownRows = [
    ['So tran', breakdown.match_count, 25, `range ${matchRange}, avg ${averageNumber(matchCounts).toFixed(1)}`],
    ['Partner', breakdown.partner_diversity, 20, `ratio ${(partner.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(20 * partner.avg_diversity_ratio).toFixed(1)}/20, repeat pairs ${partnerRepeats.length}`],
    ['Doi thu', breakdown.opponent_diversity, 15, `ratio ${(opponent.avg_diversity_ratio * 100).toFixed(0)}%, raw ${(15 * opponent.avg_diversity_ratio).toFixed(1)}/15, repeat pairs ${opponentRepeats.length}, max burden ${opponentBurden.max_repeated_opponents}`],
    ['Nghi', breakdown.rest, 20, `violations ${rest.violations.length}`],
    ['Gender pref', breakdown.gender_prefs, 20, `${gender.satisfied_count}/${gender.total_pref_opportunities} satisfied (${Math.round(gender.satisfaction_rate * 100)}%)`],
  ] as const
  const lines = [
    `Chênh tối đa ${matchRange} trận`,
    `Trung bình ${averageNumber(summary.per_player.map(player => player.unique_partners)).toFixed(1)} partners khác/người`,
    `${Math.round(summary.overall_pref_satisfaction_rate * 100)}% preferences được đáp ứng`,
  ]

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#1A2E2A', fontWeight: '900' }}>
            Tổng kết fairness
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 3 }}>
            {summary.total_rounds} vòng · {summary.total_players} người · {displayedDuration} phút
          </Text>
        </View>
        <View style={{ backgroundColor: '#E1F5EE', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: '#0F6E56', fontWeight: '900' }}>
            {summary.fairness_score.total}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#0F6E56', fontWeight: '900' }}>
            {fairnessLabel(summary.fairness_score)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 7, marginTop: 12 }}>
        {summary.per_player.map(player => (
          <View key={`fairness-player-${player.player_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 8, backgroundColor: '#F3E7D4', borderRadius: 999, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(8, (player.matches_played / maxMatches) * 100)}%`, height: '100%', backgroundColor: '#0F6E56' }} />
            </View>
            <Text style={{ width: 92, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900' }} numberOfLines={1}>
              {playerName(player.player_id, playersById)}
            </Text>
            <Text style={{ width: 20, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900', textAlign: 'right' }}>
              {player.matches_played}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: 12, gap: 5 }}>
        {lines.map(line => (
          <Text key={line} style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864', lineHeight: 16 }}>
            ✓ {line}
          </Text>
        ))}
        {summary.highlights.flagged_issues.length > 0 && (
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#A05A16', lineHeight: 16 }}>
            ℹ {summary.highlights.flagged_issues.length} cảnh báo fairness cần theo dõi
          </Text>
        )}
      </View>

      <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
          Chi tiet diem
        </Text>
        {breakdownRows.map(([label, value, max, detail]) => (
          <View key={`breakdown-${label}`} style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 82, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
                {label}
              </Text>
              <View style={{ flex: 1, height: 7, borderRadius: 999, backgroundColor: '#F3E7D4', overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(4, (value / max) * 100)}%`, height: '100%', backgroundColor: value === max ? '#0F6E56' : '#A05A16' }} />
              </View>
              <Text style={{ width: 42, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#1A2E2A', fontWeight: '900' }}>
                {value}/{max}
              </Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 4, lineHeight: 14 }}>
              {detail}
            </Text>
          </View>
        ))}
      </View>

      {matchCountConsistencyRows.length > 0 && (
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#A05A16', fontWeight: '900' }}>
            Canh bao dong bo so tran
          </Text>
          <View style={{ backgroundColor: '#FFF3CD', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E3C77A', gap: 4 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A4A00', lineHeight: 14 }}>
              Live state khac replay tu lich su round. Audit report dang dung replay tu rounds.
            </Text>
            {matchCountConsistencyRows.slice(0, 12).map(row => (
              <Text key={`match-count-mismatch-${row.player_id}`} style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A4A00', lineHeight: 14 }}>
                {playerName(row.player_id, playersById)}: live {row.live}, replay {row.replay}
              </Text>
            ))}
            {matchCountConsistencyRows.length > 12 && (
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A4A00', lineHeight: 14 }}>
                +{matchCountConsistencyRows.length - 12} players khac
              </Text>
            )}
          </View>
        </View>
      )}

      <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
          Cap lap nhieu nhat
        </Text>
        <RepeatPairsBlock
          title="Partner lap"
          pairs={partnerRepeats}
          playersById={playersById}
          emptyText="Khong co cap partner lap 2+ lan."
        />
        <RepeatPairsBlock
          title="Doi thu lap"
          pairs={opponentRepeats}
          playersById={playersById}
          emptyText="Khong co cap doi thu lap 2+ lan."
        />
      </View>

      <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
          Nguoi bi lap doi thu nhieu
        </Text>
        <OpponentBurdenBlock burden={opponentBurden} playersById={playersById} />
      </View>

      <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E3DC', gap: 8 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
          Group audit
        </Text>
        <GroupAuditBlock rows={groupAuditRows} playersById={playersById} />
      </View>

      {summary.fairness_evolution.length > 0 && (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
            Diễn biến
          </Text>
          {summary.fairness_evolution.slice(-6).map(point => (
            <View key={`fairness-evolution-${point.round}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 48, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900' }}>
                Vòng {point.round}
              </Text>
              <View style={{ flex: 1, height: 7, borderRadius: 999, backgroundColor: '#F3E7D4', overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(4, point.score)}%`, height: '100%', backgroundColor: '#0F6E56' }} />
              </View>
              <Text style={{ width: 28, fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#1A2E2A', fontWeight: '900', textAlign: 'right' }}>
                {point.score}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function RepeatPairsBlock({
  title,
  pairs,
  playersById,
  emptyText,
}: {
  title: string
  pairs: Array<{ player_a: string; player_b: string; count: number }>
  playersById: Map<string, ArrangementPlayer>
  emptyText: string
}) {
  return (
    <View style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
        {title}
      </Text>
      {pairs.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 5 }}>
          {emptyText}
        </Text>
      ) : (
        <View style={{ gap: 4, marginTop: 6 }}>
          {pairs.map(pair => (
            <Text
              key={`${title}-${pair.player_a}-${pair.player_b}`}
              style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: pair.count >= 3 ? '#A05A16' : '#596864', lineHeight: 14 }}
            >
              {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} lan
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

function OpponentBurdenBlock({
  burden,
  playersById,
}: {
  burden: ReturnType<typeof computeOpponentRepeatBurden>
  playersById: Map<string, ArrangementPlayer>
}) {
  const rows = burden.per_player
    .filter(player => player.repeated_opponents > 0)
    .sort((a, b) => {
      if (b.repeated_opponents !== a.repeated_opponents) {
        return b.repeated_opponents - a.repeated_opponents
      }
      return playerName(a.player_id, playersById).localeCompare(playerName(b.player_id, playersById))
    })

  return (
    <View style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
      {rows.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884' }}>
          Khong co ai bi lap doi thu.
        </Text>
      ) : (
        <View style={{ gap: 4 }}>
          {rows.map(row => (
            <Text
              key={`opponent-burden-${row.player_id}`}
              style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: row.repeated_opponents >= 4 ? '#A05A16' : '#596864', lineHeight: 14 }}
            >
              {playerName(row.player_id, playersById)}: {row.repeated_opponents} doi thu lap
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

function GroupAuditBlock({
  rows,
  playersById,
}: {
  rows: GroupAuditRow[]
  playersById: Map<string, ArrangementPlayer>
}) {
  if (rows.length === 0) {
    return (
      <View style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884' }}>
          Chua co group nao.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      {rows.map(row => (
        <View key={`group-audit-${row.group_id}`} style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
            {row.label}: {row.player_ids.map(id => playerName(id, playersById)).join(', ')}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 4 }}>
            Cung xuat hien trong {row.shared_matches} tran.
          </Text>
          <View style={{ gap: 3, marginTop: 6 }}>
            {row.pair_counts.map(pair => (
              <Text
                key={`group-pair-${row.group_id}-${pair.player_a}-${pair.player_b}`}
                style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: pair.count > 0 ? '#596864' : '#A05A16', lineHeight: 14 }}
              >
                {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} tran chung team
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function FairnessAuditCard({ audit }: { audit: FairnessAudit }) {
  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', fontWeight: '900' }}>
            Audit diem fairness
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
            Sau vong {audit.round_no}: {audit.before_total}{' -> '}{audit.after_total}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: audit.delta_total >= 0 ? '#0F6E56' : '#B45309', fontWeight: '900' }}>
          {audit.delta_total > 0 ? '+' : ''}{audit.delta_total}
        </Text>
      </View>

      <View style={{ gap: 8, marginTop: 12 }}>
        {audit.rows.map(row => (
          <View key={row.key} style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E5E3DC' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '900' }}>
                {row.label}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#596864', fontWeight: '900' }}>
                {row.before}{' -> '}{row.after}
              </Text>
              <Text style={{ width: 34, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: row.delta >= 0 ? '#0F6E56' : '#B45309', fontWeight: '900' }}>
                {row.delta > 0 ? '+' : ''}{row.delta}
              </Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 4, lineHeight: 15 }}>
              {row.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function FairnessPreviewCard({ preview }: { preview: FairnessPreview }) {
  const tone = preview.delta_total >= 0 ? '#0F6E56' : '#B45309'

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>
            Preview fairness neu start
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
            {preview.before_total}{' -> '}{preview.after_total}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: tone, fontWeight: '900' }}>
          {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}
        </Text>
      </View>

      <View style={{ gap: 7, marginTop: 10 }}>
        {preview.rows.map(row => (
          <View key={`preview-${row.key}`} style={{ backgroundColor: '#F8F3E8', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: '#E5E3DC' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }}>
                {row.label}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900' }}>
                {row.before}{' -> '}{row.after}
              </Text>
              <Text style={{ width: 34, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: row.delta >= 0 ? '#0F6E56' : '#B45309', fontWeight: '900' }}>
                {row.delta > 0 ? '+' : ''}{row.delta}
              </Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginTop: 3, lineHeight: 13 }}>
              {row.detail}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function formatAffectedPlayers(playerIds: string[], playersById: Map<string, ArrangementPlayer>) {
  if (playerIds.length === 0) return ''
  return `(${playerIds.map(id => playerName(id, playersById)).join(', ')})`
}

function averageNumber(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function ManualSwapPanel({
  alternative,
  playersById,
  selectedPlayerId,
  onSelectPlayer,
  onSwap,
  onReset,
}: {
  alternative: SuggestionAlternative
  playersById: Map<string, ArrangementPlayer>
  selectedPlayerId: string | null
  onSelectPlayer: (playerId: string | null) => void
  onSwap: (fromId: string, toId: string) => void
  onReset: () => void
}) {
  const playingIds = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
  const targetIds = [...new Set([...playingIds, ...alternative.resting])].filter(id => id !== selectedPlayerId)

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC', gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900' }}>
          Swap tay: chon 1 nguoi dang danh, roi chon nguoi muon doi cho.
        </Text>
        <MiniButton label="Reset" onPress={onReset} muted />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {playingIds.map(playerId => {
          const active = selectedPlayerId === playerId
          return (
            <TouchableOpacity
              key={`swap-from-${playerId}`}
              onPress={() => onSelectPlayer(active ? null : playerId)}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 7,
                backgroundColor: active ? '#0F6E56' : '#F8F3E8',
                borderWidth: 1,
                borderColor: active ? '#0F6E56' : '#E5E3DC',
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: active ? 'white' : '#596864', fontWeight: '900' }}>
                {playerName(playerId, playersById)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {selectedPlayerId && (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900' }}>
            Doi {playerName(selectedPlayerId, playersById)} voi:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {targetIds.map(playerId => {
              const isResting = alternative.resting.includes(playerId)
              return (
                <TouchableOpacity
                  key={`swap-to-${playerId}`}
                  onPress={() => onSwap(selectedPlayerId, playerId)}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: isResting ? '#FFF7D6' : '#F8F3E8',
                    borderWidth: 1,
                    borderColor: isResting ? '#E5B94E' : '#E5E3DC',
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', fontWeight: '900' }}>
                    {playerName(playerId, playersById)}{isResting ? ' (rest)' : ''}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}
    </View>
  )
}

function CompletedRoundsRecap({
  rounds,
  state,
  playersById,
}: {
  rounds: SessionRoundRow[]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
}) {
  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.xl, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: '#1A2E2A', fontWeight: '900' }}>
        Lich su round da xong
      </Text>
      <View style={{ gap: 10, marginTop: 10 }}>
        {rounds.map(round => (
          <View key={round.id ?? `${round.session_id}-${round.round_no}`} style={{ backgroundColor: '#F8F3E8', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC', gap: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#0F6E56', fontWeight: '900' }}>
              Round {round.round_no}{round.ended_at ? ` · ${new Date(round.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
            {round.matches.map(match => (
              <MatchCard key={`completed-${round.round_no}-${match.court_idx}`} match={match} state={state} playersById={playersById} />
            ))}
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864' }}>
              Nghi: {round.resting.map(id => playerName(id, playersById)).join(', ') || 'Khong co'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function SuggestionStatsCard({ alternative }: { alternative: SuggestionAlternative }) {
  const metrics = [
    { label: 'PVNA diff tổng', value: alternative.stats.pvna_diff.toFixed(2), tone: '#0F6E56' },
    { label: 'Partner lặp', value: String(alternative.stats.partner_repeats), tone: '#A05A16' },
    { label: 'Đối thủ lặp', value: String(alternative.stats.opponent_repeats), tone: '#7C3AED' },
    { label: 'Group bonus', value: String(alternative.stats.group_bonus), tone: '#2563EB' },
    { label: 'Gender pref', value: alternative.stats.gender_pref_penalty.toFixed(1), tone: '#BE185D' },
    { label: 'Score tổng', value: alternative.score.toFixed(1), tone: '#1A2E2A' },
  ]

  return (
    <View style={{ backgroundColor: '#F8F3E8', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '900', marginBottom: 8 }}>
        Vì sao phương án này được chọn
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {metrics.map(metric => (
          <View key={metric.label} style={{ width: '48%', backgroundColor: '#FFFCF5', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: '#ECE3D3' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#8A8174', fontWeight: '900' }}>{metric.label}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: metric.tone, fontWeight: '900', marginTop: 3 }}>{metric.value}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', lineHeight: 15, marginTop: 9 }}>
        Score thấp hơn là tốt hơn. Engine ưu tiên không để ai nghỉ quá lâu, cân PVNA hai đội, giảm lặp partner/đối thủ và cộng điểm cho nhóm bạn cùng vòng.
      </Text>
    </View>
  )
}

function MatchCard({ match, state, playersById }: { match: Match; state: SessionState; playersById: Map<string, ArrangementPlayer> }) {
  const diff = Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state))
  const scored = match.stats && match.score != null ? { score: match.score, stats: match.stats } : scoreMatch(match.team_a, match.team_b, state)
  const metrics = [
    ['Score', Number.isFinite(scored.score) ? scored.score.toFixed(1) : '-'],
    ['PVNA', scored.stats.pvna_diff.toFixed(2)],
    ['Partner lặp', String(scored.stats.partner_repeats)],
    ['Đối thủ lặp', String(scored.stats.opponent_repeats)],
    ['Group', String(scored.stats.group_bonus)],
    ['Gender pref', scored.stats.gender_pref_penalty.toFixed(1)],
  ]

  return (
    <View style={{ backgroundColor: '#F8F3E8', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '900' }}>
        Sân {match.court_idx + 1} · PVNA diff {diff.toFixed(2)}
      </Text>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 6, lineHeight: 18 }}>
        {getMatchLabel(match, playersById)}
      </Text>
      <View style={{ marginTop: 8, gap: 4 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', lineHeight: 14 }}>
          A: {match.team_a.map(id => formatPlayerPreference(id, playersById, state)).join(' / ')}
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#596864', lineHeight: 14 }}>
          B: {match.team_b.map(id => formatPlayerPreference(id, playersById, state)).join(' / ')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
        {metrics.map(([label, value]) => (
          <View key={`${match.court_idx}-${label}`} style={{ backgroundColor: '#FFFCF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#ECE3D3' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#8A8174', fontWeight: '900' }}>
              {label}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900', marginTop: 2 }}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ActionButton({
  label,
  icon,
  loading,
  onPress,
  disabled,
  danger,
}: {
  label: string
  icon?: React.ReactNode
  loading?: boolean
  onPress: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        flex: 1,
        backgroundColor: danger ? '#B91C1C' : '#0F6E56',
        opacity: disabled ? 0.45 : loading ? 0.7 : 1,
        paddingVertical: 12,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
      }}
    >
      {loading ? <ActivityIndicator color="white" /> : icon}
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: 'white', fontWeight: '900' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function MiniButton({
  label,
  icon,
  loading,
  onPress,
  muted,
}: {
  label: string
  icon?: React.ReactNode
  loading?: boolean
  onPress: () => void
  muted?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      style={{
        minWidth: 54,
        backgroundColor: muted ? '#A05A16' : '#0F6E56',
        opacity: loading ? 0.7 : 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 4,
      }}
    >
      {loading ? <ActivityIndicator color="white" size="small" /> : icon}
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: 'white', fontWeight: '900' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}
