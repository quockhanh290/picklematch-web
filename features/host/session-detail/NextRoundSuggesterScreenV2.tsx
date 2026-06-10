import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SessionDashboardCard,
  StatusInlineItem,
  PlayerCell,
  LateArrivalsCta,
  ManagePlayersButton,
  StatusChipRow,
  AlternativeTabs,
  FairnessPreviewCard,
  FairnessPreviewSheet,
  EngineExplainCard,
  NextMatchSuggestionCard,
  CourtLaneLiveMatchBoard,
  LiveMatchBoard,
  RoundDivider,
  SuggestedRoundHeader,
  SectionEyebrow,
  SuggestedLiveMatchCard,
  LiveMatchScoreBoard,
  SuggestedMatchTile,
  SuggestedTeamBlock,
  LiveScoreTeam,
  LiveMatchScoreCard,
  ScoreStepper,
  MatchList,
  MatchTile,
  RepeatCompactSummary,
  RepeatSummaryChip,
  RepeatInlineDetail,
  RepeatExpandedVisual,
  RepeatPlayerCell,
  RepeatInlinePlayer,
  RepeatExpandedConnectionVisual,
  RepeatConnectionSection,
  RepeatConnectionRow,
  RepeatConnectionPlayer,
  TeamBlock,
  RestingRow,
  EngineConstraintNotice,
  PlanningRoundCard,
  EmptyPlanCard,
  SettingsSheet,
  CourtSuggestionOptions,
  FairnessSheet,
  PlayerMatchDistributionBlock,
  FairnessEvolutionBlock,
  LatestFairnessAuditCard,
  buildLogicalRoundDisplayMap
} from './next-round-v2/components/ScreenComponents'

import { buildPreviewBatchKey } from './next-round-v2/preview'
import { fetchLiveMatchesPreview } from './next-round-v2/api'
import { getMissingPreviewCourtIdxs, getRequestedReplacementCourtIdxs, hasFulfilledReplacementCourts, isPreviewBoardComplete } from './next-round-v2/court-lanes'
import { ActivityIndicator, Alert, AppState, Dimensions, Platform, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertTriangle,
  ChevronDown,
  Minus,
  Plus,
  Repeat2,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react-native'

import { SecondaryNavbar } from '@/components/design'
import { colors } from '@/constants/colors'
import { BORDER, RADIUS, SHADOW as LAYOUT_SHADOW, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, getCourtPresetTargetMatches, PRESETS, PRESET_ROTATION_TARGETS, type CourtOption, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
import { Tier } from '@/lib/next-round-suggester/classify'
import type { SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import type { AlternativeAudit } from '@/lib/next-round-suggester/alternatives'
import { commitCompletedRound, pairHistoryRowsFromState } from '@/lib/next-round-suggester/commit'
import { auditManualSwap, buildSwappedAlternative } from '@/lib/next-round-suggester/manual-swap'
import {
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
  MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER,
  MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER,
  getProjectedRepeatSummary,
  scoreMatch,
} from '@/lib/next-round-suggester/score'
import { suggestNextMatch, suggestNextRound } from '@/lib/next-round-suggester/suggest'
import { buildSessionStateFingerprint } from '@/lib/next-round-suggester/state-version'
import type { FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import {
  type FairnessAudit,
  type MatchCountConsistencyRow,
  type FairnessPreview,
} from '@/lib/next-round-suggester/fairness/audit'
import type { GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import { computeFairnessEvolution } from '@/lib/next-round-suggester/fairness/summary'
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
import { computeRepeatPressure } from '@/lib/next-round-suggester/fairness/pressure'
import type {
  Match,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionRoundRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'
import { checkInLiveSessionPlayers, invokeLiveSessionFunction, loadLatestSyncablePlayerIds, markSessionPlayersPresent, repairLiveSessionPlayerStateFromRounds } from './next-round-v2/api'
import { getNextRoundTelemetry, markNextRoundStage } from './next-round-v2/telemetry'
import { Card, NextRoundSheet, PlayerAvatar, SheetTitle } from './next-round-v2/components'
import { COURT_DURATION_OPTIONS, COURT_PRESET_OPTIONS, PVNA_TOLERANCE_OPTIONS } from './next-round-v2/constants'
import { ChoiceRow, NavbarRightActions, StickyRoundCta } from './next-round-v2/controls'
import {
  HistorySheet as HistorySheetView,
  LateArrivalsSheet as LateArrivalsSheetView,
  MoreSheet as MoreSheetView,
  RecapView as RecapViewModule,
  SwapSheet as SwapSheetView,
} from './next-round-v2/flow-sheets'
import {
  ctaTextStyle,
  eyebrowStyle,
  formatNumber,
  getPlayerPvna,
  getTeamPvna,
  playerName,
  repeatRiskLabel,
} from './next-round-v2/helpers'
import type { NextRoundSuggesterV2Props } from './next-round-v2/types'
import { useNextRoundModel } from './next-round-v2/useNextRoundModel'
import { useCheckInMutation, useCheckOutMutation, useStartMatchMutation, useCompleteMatchMutation } from './next-round-v2/mutations'
const { width: SCREEN_WIDTH } = Dimensions.get('window')
const LIVE_SCORE_CARD_WIDTH = SCREEN_WIDTH > 400 ? 90 : SCREEN_WIDTH > 360 ? 80 : 72
const LIVE_SCORE_CARD_HEIGHT = LIVE_SCORE_CARD_WIDTH * 1.25
const LIVE_SCORE_FONT_SIZE = SCREEN_WIDTH > 400 ? 56 : SCREEN_WIDTH > 360 ? 48 : 42
const LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 4
function isCourtLaneBoardEnabled() {
  const isDevRuntime = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
  if (!isDevRuntime) return false
  if (process.env.EXPO_PUBLIC_USE_COURT_LANE_BOARD === '1') return true
  const locationSearch = Platform.OS === 'web' && typeof globalThis !== 'undefined'
    ? (globalThis as { location?: { search?: string } }).location?.search
    : null
  return typeof locationSearch === 'string'
    && new URLSearchParams(locationSearch).get('courtLaneBoard') === '1'
}
const USE_COURT_LANE_BOARD = isCourtLaneBoardEnabled()
const LiveMatchBoardComponent: typeof LiveMatchBoard = USE_COURT_LANE_BOARD
  ? CourtLaneLiveMatchBoard as typeof LiveMatchBoard
  : LiveMatchBoard
const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_REPEAT_COST_WEIGHT = 3
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1

function getWebVisualViewportHeight() {
  if (Platform.OS !== 'web') return null
  if (typeof window === 'undefined') return null
  const visualViewportHeight = window.visualViewport?.height
  if (typeof visualViewportHeight === 'number' && Number.isFinite(visualViewportHeight)) {
    return Math.round(visualViewportHeight)
  }
  return Math.round(window.innerHeight || Dimensions.get('window').height)
}

function isScrollDebugEnabled() {
  if (Platform.OS !== 'web') return false
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return params.get('debugScroll') === '1'
      || hashParams.get('debugScroll') === '1'
      || window.localStorage?.getItem('nrv2ScrollDebug') === '1'
  } catch {
    return false
  }
}

function getWebDocumentScrollMetrics(): Partial<ScrollDebugMetrics> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return {}
  const doc = document.documentElement
  const body = document.body
  const layoutHeight = Math.round(window.visualViewport?.height ?? window.innerHeight ?? doc.clientHeight ?? 0)
  const contentHeight = Math.round(Math.max(
    doc.scrollHeight,
    body?.scrollHeight ?? 0,
    doc.offsetHeight,
    body?.offsetHeight ?? 0,
  ))
  const scrollY = Math.round(window.scrollY ?? doc.scrollTop ?? body?.scrollTop ?? 0)
  return { layoutHeight, contentHeight, scrollY }
}

type ScrollDebugMetrics = {
  viewportHeight: number | null
  visualViewportHeight: number | null
  innerHeight: number | null
  layoutHeight: number | null
  contentHeight: number | null
  scrollY: number
  distanceToBottom: number | null
}

function fairnessLabel(score: SessionFairnessScore) {
  if (score.grade === 'excellent') return 'Rất đều'
  if (score.grade === 'good') return 'Đều'
  if (score.grade === 'acceptable') return 'Tạm ổn'
  return 'Cần chỉnh'
}

function churnLevelLabel(level: string) {
  if (level === 'low') return 'thấp'
  if (level === 'medium') return 'vừa'
  if (level === 'high') return 'cao'
  return level
}

function feasibilityLabel(feasibility: string) {
  if (feasibility === 'optimal') return 'Tối ưu'
  if (feasibility === 'tight') return 'Vừa khít'
  if (feasibility === 'infeasible') return 'Không khả thi'
  return feasibility
}

function warningTitle(type: string) {
  if (type === 'match_count_imbalance') return 'Lệch số trận'
  if (type === 'projected_match_count_imbalance') return 'Sắp lệch số trận'
  if (type === 'underplayed') return 'Có người chơi ít hơn'
  if (type === 'partner_repeat') return 'Lặp partner (đồng đội)'
  if (type === 'opponent_repeat') return 'Lặp đối thủ'
  if (type === 'opponent_repeat_burden') return 'Một người gặp lại nhiều đối thủ'
  if (type === 'projected_opponent_repeat_burden') return 'Sắp lặp đối thủ nhiều'
  if (type === 'rest_violation') return 'Nghỉ liên tiếp'
  if (type === 'gender_pref_unsatisfied') return 'Sở thích giới tính chưa tốt'
  if (type === 'gender_pref_impossible') return 'Sở thích giới tính khó đáp ứng'
  return type.replace(/_/g, ' ')
}


function warningTone(theme: ReturnType<typeof useAppTheme>, severity: FairnessWarning['severity'] | 'ok') {
  if (severity === 'critical') return { bg: theme.dangerBg, border: theme.dangerText, text: theme.dangerText }
  if (severity === 'warning') return { bg: theme.warningBg, border: theme.warningStrong, text: theme.warningText }
  if (severity === 'info') return { bg: theme.infoBg, border: theme.outlineVariant, text: theme.infoText }
  return { bg: theme.successBg, border: theme.secondaryContainer, text: theme.successText }
}

function toUserSafeActionError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  
  if (message.includes('A round is already active')) return 'Đang có vòng đấu đang diễn ra.'
  if (message.includes('A player can only be assigned once per round')) return 'Mỗi người chơi chỉ có thể xếp lịch 1 lần trong mỗi vòng.'
  if (message.includes('Could not read login session')) return 'Không thể đọc phiên đăng nhập. Vui lòng mở bằng Safari/Chrome hoặc đăng nhập lại.'
  if (message.includes('Invalid manual matches')) return 'Các trận đấu tự chọn không hợp lệ.'
  if (message.includes('Manual match has invalid court index')) return 'Trận đấu tự chọn có số sân không hợp lệ.'
  if (message.includes('Manual matches cannot reuse the same court')) return 'Các trận đấu tự chọn không thể trùng sân.'
  if (message.includes('Manual matches exceed court count')) return 'Số trận đấu tự chọn vượt quá số lượng sân.'
  if (message.includes('Manual matches must use checked-in players')) return 'Trận đấu tự chọn phải sử dụng người chơi đã check-in.'
  if (message.includes('Player is in a live match')) return 'Người này đang trong trận live. Hãy kết thúc hoặc hủy trận trước.'
  if (message.includes('Request timed out')) return 'Yêu cầu quá hạn. Vui lòng kiểm tra kết nối mạng và thử lại.'
  if (message.includes('Preview is stale') || message.includes('Preview version')) return 'Gợi ý trên màn hình đã cũ. Vui lòng làm mới gợi ý rồi bắt đầu lại.'
  if (message.includes('Round commit audit failed')) return 'Đánh giá lưu vòng thất bại. Vui lòng làm mới trước khi tiếp tục.'
  if (message.includes('Session changed')) return 'Buổi chơi đã thay đổi. Vui lòng làm mới và kiểm tra vòng đấu đã đổi trước khi bắt đầu.'
  if (message.includes('Temporary network issue')) return 'Lỗi kết nối mạng tạm thời. Vui lòng thử lại.'
  
  if (message.startsWith('Could not ')) return 'Không thể thực hiện thao tác: ' + message
  return 'Thao tác thất bại. Vui lòng thử lại.'
}

function changedPairHistoryRows(beforeRows: SessionPairHistoryRow[], afterRows: SessionPairHistoryRow[]) {
  const beforeByKey = new Map(beforeRows.map((row) => [`${row.player_a}:${row.player_b}`, row]))
  return afterRows.filter((row) => {
    const before = beforeByKey.get(`${row.player_a}:${row.player_b}`)
    return !before || before.partner_count !== row.partner_count || before.opponent_count !== row.opponent_count
  })
}

function buildProjectedStateAfterLiveMatch(
  state: SessionState,
  match: SessionLiveMatchRow,
  roundNo?: number,
): SessionState {
  const playedIds = new Set([...match.team_a, ...match.team_b])
  const players = new Map(state.players)
  const effectiveRoundNo = roundNo ?? match.round_no ?? match.sequence_no

  players.forEach((player, playerId) => {
    if (playedIds.has(playerId)) {
      players.set(playerId, {
        ...player,
        matches_played: player.matches_played + 1,
        last_played_round: effectiveRoundNo,
        consecutive_play: player.consecutive_play + 1,
        consecutive_rest: 0,
        opted_rest: false,
      })
      return
    }
  })

  const incrementPair = (playerAId: string, playerBId: string, type: 'partner' | 'opponent') => {
    const playerA = players.get(playerAId)
    const playerB = players.get(playerBId)
    if (playerA) {
      const partnerCounts = new Map(playerA.partner_counts)
      const opponentCounts = new Map(playerA.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
      players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (playerB) {
      const partnerCounts = new Map(playerB.partner_counts)
      const opponentCounts = new Map(playerB.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
      players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner')
  incrementPair(match.team_b[0], match.team_b[1], 'partner')
  for (const playerAId of match.team_a) {
    for (const playerBId of match.team_b) {
      incrementPair(playerAId, playerBId, 'opponent')
    }
  }

  const newMatch = {
    court_idx: match.court_idx ?? 0,
    team_a: match.team_a,
    team_b: match.team_b,
  }
  const existingRound = state.rounds.find(r => r.round_no === effectiveRoundNo)
  const rounds = existingRound
    ? state.rounds.map(r =>
        r.round_no === effectiveRoundNo ? { ...r, matches: [...r.matches, newMatch] } : r,
      )
    : [
        ...state.rounds,
        {
          session_id: state.session_id,
          round_no: effectiveRoundNo,
          status: 'completed' as const,
          matches: [newMatch],
          resting: [],
          started_at: match.started_at ? new Date(match.started_at) : null,
          ended_at: new Date(),
        },
      ]

  return { ...state, players, rounds }
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function waitForUiFrame() {
  return new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 0)
  })
}

function createClientRequestId(action: 'start' | 'end' | 'match') {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${action}_${Date.now().toString(36)}_${randomPart}`
}

type ActionResult = {
  reload?: boolean
  reconcileAfterMs?: number
  targetReachedAfterMatch?: boolean
  reconcile?: {
    action: 'start' | 'end'
    expectedLiveStateVersion?: number | null
    expectedRoundNo?: number | null
    expectedRoundStatus?: 'active' | 'completed'
  }
}

type BuildSuggestedMatchOptions = {
  courtIdx?: number
  stateOverride?: SessionState
  liveMatchRowsOverride?: SessionLiveMatchRow[]
}

type SuggestedLiveMatchRow = SessionLiveMatchRow & {
  preview_live_state_version?: number | null
  preview_countable_match_count?: number | null
  warnings?: string[]
  tradeoffs?: SuggestionTradeoff[]
  approval_required?: boolean
  configured_pvna_tolerance?: number
  effective_pvna_tolerance?: number
  fairness_reasons?: string[]
  fairness_reason_details?: string[]
  tradeoff_choices?: SuggestionTradeoffChoice[]
  recommended_tradeoff_choice?: SuggestionTradeoffChoiceId
}

type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}

const getSuggestedLaneCourtIdx = (match: Pick<SessionLiveMatchRow, 'court_idx' | 'sequence_no'>): number | null => {
  const courtIdx = Number(match.court_idx ?? match.sequence_no)
  return Number.isFinite(courtIdx) ? courtIdx : null
}

const getMatchPlayerIds = (match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>): string[] => [
  ...match.team_a.map(String),
  ...match.team_b.map(String),
]

function getSuggestedMatchPvnaGap(match: Pick<SessionLiveMatchRow, 'team_a' | 'team_b'>, state: SessionState) {
  const getTeamPvna = (team: readonly string[]) => team.reduce(
    (sum, playerId) => sum + (state.players.get(String(playerId))?.pvna ?? 0),
    0,
  )
  return Math.abs(getTeamPvna(match.team_a) - getTeamPvna(match.team_b))
}

function hasHardPreviewQualityViolation(
  match: SuggestedLiveMatchRow,
  state: SessionState,
  pvnaTolerance: number,
) {
  const pvnaGap = getSuggestedMatchPvnaGap(match, state)
  const pvnaOverBy = pvnaGap - pvnaTolerance
  if (pvnaOverBy > 1) return true

  const roundNo = Number(match.round_no ?? 0)
  const isEarlyOrMidRound = roundNo < 5
  if (!isEarlyOrMidRound) return false

  return pvnaOverBy > 0.25
}

function isSameCourtAndPlayers(
  left: Pick<SessionLiveMatchRow, 'court_idx' | 'team_a' | 'team_b'>,
  right: Pick<SessionLiveMatchRow, 'court_idx' | 'team_a' | 'team_b'>,
) {
  if (Number(left.court_idx ?? -1) !== Number(right.court_idx ?? -1)) return false
  const leftPlayers = getMatchPlayerIds(left).sort()
  const rightPlayers = getMatchPlayerIds(right).sort()
  return leftPlayers.length === rightPlayers.length
    && leftPlayers.every((playerId, index) => playerId === rightPlayers[index])
}

function shouldInvalidatePreviewAfterStartError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  return message.includes('Session changed')
    || message.includes('Preview is stale')
    || message.includes('Preview version')
    || message.includes('A player is already in a live match')
    || message.includes('Court already has a live match')
    || message.includes('available checked-in players')
}









export function NextRoundSuggesterScreenV2({ sessionId, players = [], courts, bootstrapTelemetry = null, initialShowReport = false }: NextRoundSuggesterV2Props) {
  const checkInMutation = useCheckInMutation(sessionId)
  const checkOutMutation = useCheckOutMutation(sessionId)
  const startMatchMutation = useStartMatchMutation(sessionId)
  const completeMatchMutation = useCompleteMatchMutation(sessionId)
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isWeb = Platform.OS === 'web'
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(() => getWebVisualViewportHeight())
  const scrollDebugEnabled = useMemo(() => isScrollDebugEnabled(), [])
  const [scrollDebugMetrics, setScrollDebugMetrics] = useState<ScrollDebugMetrics>({
    viewportHeight: getWebVisualViewportHeight(),
    visualViewportHeight: null,
    innerHeight: null,
    layoutHeight: null,
    contentHeight: null,
    scrollY: 0,
    distanceToBottom: null,
  })
  const scrollDebugMetricsRef = useRef(scrollDebugMetrics)
  const isFirstFocusRef = useRef(true)
  const [busy, setBusy] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)
  const autoSyncAttemptedRef = useRef(false)
  const autoRepairStateAttemptedRef = useRef(false)
  const completingCleanupTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const completingMatchExpectedPlayedRef = useRef(new Map<string, { playerIds: string[]; expectedPlayed: number }>())
  const lateArrivalInFlightRef = useRef(new Set<string>())
  const reconcileTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const liveMatchMutationQueueRef = useRef(Promise.resolve())
  const suggestedPreviewBatchRef = useRef<SuggestedPreviewBatch | null>(null)
  const suggestedLaneCacheRef = useRef(new Map<number, SuggestedLiveMatchRow>())
  const previewRequestInFlightRef = useRef(false)
  const previewRequestInFlightSerialRef = useRef<number | null>(null)
  const previewRequestSerialRef = useRef(0)
  const previewPendingRequestKeysRef = useRef(new Set<string>())
  const previewRetryTimeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const sessionGenerationRef = useRef(0)
  const activeSessionIdRef = useRef(sessionId)
  const previewBatchKeyRef = useRef<string | null>(null)
  const previewBaseKeyRef = useRef<string | null>(null)
  const previewRecoveryKeyRef = useRef<string | null>(null)
  const previewIncompleteRetryRef = useRef<{ key: string; count: number }>({ key: '', count: 0 })
  const previewBlockedIncompleteKeysRef = useRef(new Set<string>())
  const startingPreviewIdsRef = useRef(new Set<string>())
  const endingLiveMatchIdsRef = useRef(new Set<string>())
  const completedLiveMatchCommitIdsRef = useRef(new Set<string>())
  const cancelingLiveMatchIdsRef = useRef(new Set<string>())
  const model = useNextRoundModel({ sessionId, players, courts, initialShowReport })
  const [optimisticLiveMatches, setOptimisticLiveMatches] = useState<LiveDisplayMatchRow[]>([])
  const [liveMatchDisplayKeys, setLiveMatchDisplayKeys] = useState<Record<string, string>>({})
  const [startingPreviewIds, setStartingPreviewIds] = useState<Set<string>>(() => new Set())
  const [startedPreviewIds, setStartedPreviewIds] = useState<Set<string>>(() => new Set())
  const [endingLiveMatchIds, setEndingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const [completingLiveMatchIds, setCompletingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const [creatingNextMatchIds, setCreatingNextMatchIds] = useState<Set<string>>(() => new Set())
  const [completedLiveMatchCommitNonce, setCompletedLiveMatchCommitNonce] = useState(0)
  const [completingLiveMatchPlaceholders, setCompletingLiveMatchPlaceholders] = useState<Map<string, SessionLiveMatchRow>>(() => new Map())
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0)
  const [isSuggestingPreview, setIsSuggestingPreview] = useState(false)
  const completingLiveMatchPlaceholdersRef = useRef(completingLiveMatchPlaceholders)
  const [suggestedSwapMatch, setSuggestedSwapMatch] = useState<SuggestedLiveMatchRow | null>(null)
  const {
    activeRound,
    alternativeOrder,
    alternativeAudits,
    applyCompletedLiveMatch,
    applyEndedRound,
    applyLiveMatches,
    applyLiveStateVersion,
    applyStartedRound,
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
    error,
    fairnessAudit,
    fairnessAdjustment,
    fairnessPreview,
    fairnessScore,
    fairnessWarnings,
    groupSummaries,
    hasManualSwapHardGuard,
    loadLiveState,
    loading,
    liveStateVersion,
    manualAlternative,
    matchCountConsistencyRows,
    phase,
    playersById,
    planTelemetry,
    presentCount,
    pvnaTolerance,
    refreshing,
    rememberRoundSelection,
    reportState,
    reportReady,
    rosterPlayers,
    rows,
    selectAlternativeForRound,
    selectedAlternative,
    selectionUndo,
    sessionSummary,
    settingsHydrated,
    setCourtCount,
    setCourtDurationMin,
    setCourtPreset,
    setError,
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
    undoRoundSelection,
    workingAlternative,
  } = model
  useEffect(() => {
    markNextRoundStage(sessionId, 'screen_shell_paint', {
      loading,
    })
  }, [loading, sessionId])

  const lastBusRefreshRef = useRef(0)
  const liveStateVersionRef = useRef<number | null>(rows.liveStateVersion ?? null)

  React.useEffect(() => {
    const nextVersion = rows.liveStateVersion
    if (nextVersion == null) return
    liveStateVersionRef.current = liveStateVersionRef.current === null
      ? nextVersion
      : Math.max(liveStateVersionRef.current, nextVersion)
  }, [rows.liveStateVersion])
  React.useEffect(() => {
    completingLiveMatchPlaceholdersRef.current = completingLiveMatchPlaceholders
  }, [completingLiveMatchPlaceholders])
  const updateScrollDebugMetrics = useCallback((patch: Partial<ScrollDebugMetrics>) => {
    if (!scrollDebugEnabled) return
    const visualViewportHeight = typeof window !== 'undefined' && typeof window.visualViewport?.height === 'number'
      ? Math.round(window.visualViewport.height)
      : null
    const innerHeight = typeof window !== 'undefined' ? Math.round(window.innerHeight || 0) : null
    const next = {
      ...scrollDebugMetricsRef.current,
      viewportHeight: getWebVisualViewportHeight(),
      visualViewportHeight,
      innerHeight,
      ...patch,
    }
    next.distanceToBottom = next.contentHeight != null && next.layoutHeight != null
      ? Math.round(next.contentHeight - next.layoutHeight - next.scrollY)
      : null
    scrollDebugMetricsRef.current = next
    setScrollDebugMetrics(next)
  }, [scrollDebugEnabled])
  React.useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return

    let frame: number | null = null
    const updateViewportHeight = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const nextHeight = getWebVisualViewportHeight()
        setWebViewportHeight(current => current === nextHeight ? current : nextHeight)
        updateScrollDebugMetrics({ viewportHeight: nextHeight, ...getWebDocumentScrollMetrics() })
      })
    }

    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
    window.addEventListener('scroll', updateViewportHeight, { passive: true })
    window.addEventListener('orientationchange', updateViewportHeight)
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('scroll', updateViewportHeight)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('scroll', updateViewportHeight)
      window.removeEventListener('orientationchange', updateViewportHeight)
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight)
    }
  }, [isWeb, updateScrollDebugMetrics])
  React.useEffect(() => {
    const sessionChanged = activeSessionIdRef.current !== sessionId
    activeSessionIdRef.current = sessionId
    sessionGenerationRef.current += 1
    previewRequestSerialRef.current += 1
    previewRequestInFlightRef.current = false
    previewRequestInFlightSerialRef.current = null
    if (sessionChanged) liveStateVersionRef.current = null
    autoRepairStateAttemptedRef.current = false
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
    previewBatchKeyRef.current = null
    previewBaseKeyRef.current = null
    previewPendingRequestKeysRef.current.clear()
    previewBlockedIncompleteKeysRef.current.clear()
    previewIncompleteRetryRef.current = { key: '', count: 0 }
    previewRetryTimeoutsRef.current.forEach(clearTimeout)
    previewRetryTimeoutsRef.current.clear()
    completingMatchExpectedPlayedRef.current.clear()
    completedLiveMatchCommitIdsRef.current.clear()
    completingCleanupTimeoutsRef.current.forEach(clearTimeout)
    completingCleanupTimeoutsRef.current.clear()
    setOptimisticLiveMatches([])
    setStartingPreviewIds(new Set())
    setStartedPreviewIds(new Set())
    setEndingLiveMatchIds(new Set())
    setCompletingLiveMatchIds(new Set())
    setCreatingNextMatchIds(new Set())
    setCompletingLiveMatchPlaceholders(new Map())
    setIsSuggestingPreview(false)
    setLiveMatchDisplayKeys({})
  }, [sessionId])
  React.useEffect(() => {
    if (phase !== 'recap' || matchCountConsistencyRows.length === 0) {
      autoRepairStateAttemptedRef.current = false
      return
    }
    if (activeRound || autoRepairStateAttemptedRef.current) return
    autoRepairStateAttemptedRef.current = true

    void repairLiveSessionPlayerStateFromRounds(sessionId)
      .then(() => loadLiveState())
      .catch(error => {
        console.warn('Could not repair live session player state', error)
      })
  }, [activeRound, loadLiveState, matchCountConsistencyRows.length, phase, sessionId])
  React.useEffect(() => {
    setOptimisticLiveMatches(current => {
      if (current.length === 0) return current
      const serverIds = new Set(rows.liveMatchRows.map(match => match.id))
      const next = current.filter(match => !serverIds.has(match.id))
      return next.length === current.length ? current : next
    })
  }, [rows.liveMatchRows])
  React.useEffect(() => () => {
    reconcileTimeoutsRef.current.forEach(clearTimeout)
    reconcileTimeoutsRef.current = []
    completingCleanupTimeoutsRef.current.forEach(clearTimeout)
    completingCleanupTimeoutsRef.current.clear()
    previewRetryTimeoutsRef.current.forEach(clearTimeout)
    previewRetryTimeoutsRef.current.clear()
  }, [])

  // Xóa completing match khỏi busyIds khi state (deferred) đã phản ánh đủ matches_played mới.
  React.useEffect(() => {
    const pending = completingMatchExpectedPlayedRef.current
    if (pending.size === 0) return
    const toRemove: string[] = []
    for (const [matchId, { playerIds, expectedPlayed }] of pending) {
      const player = state.players.get(playerIds[0])
      if (player && player.matches_played >= expectedPlayed) {
        toRemove.push(matchId)
      }
    }
    if (toRemove.length === 0) return
    for (const id of toRemove) pending.delete(id)
    setCompletingLiveMatchIds(current => {
      const next = new Set(current)
      let changed = false
      for (const id of toRemove) {
        if (next.has(id)) { next.delete(id); changed = true }
      }
      return changed ? next : current
    })
  }, [state])


  const scheduleReconcile = useCallback((result: ActionResult) => {
    if (!result.reconcile) return
    const delayMs = result.reconcileAfterMs ?? 600
    const expected = result.reconcile
    const timeoutId = setTimeout(() => {
      void loadLiveState().then((serverRows) => {
        if (!serverRows) return
        const mismatches: Record<string, unknown> = {}
        if (
          expected.expectedLiveStateVersion != null
          && Number.isFinite(expected.expectedLiveStateVersion)
          && serverRows.liveStateVersion !== expected.expectedLiveStateVersion
        ) {
          mismatches.live_state_version = {
            expected: expected.expectedLiveStateVersion,
            actual: serverRows.liveStateVersion,
          }
        }
        if (expected.expectedRoundNo != null && Number.isFinite(expected.expectedRoundNo) && expected.expectedRoundStatus) {
          const serverRound = serverRows.roundRows.find(round => round.round_no === expected.expectedRoundNo)
          if (!serverRound || serverRound.status !== expected.expectedRoundStatus) {
            mismatches.round = {
              round_no: expected.expectedRoundNo,
              expected_status: expected.expectedRoundStatus,
              actual_status: serverRound?.status ?? null,
            }
          }
        }
        if (Object.keys(mismatches).length > 0) {
          console.warn('[NextRoundSuggesterV2] background reconcile mismatch', {
            action: expected.action,
            sessionId,
            ...mismatches,
          })
        }
      }).catch((error) => {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] background reconcile failed', error)
      })
    }, delayMs)
    reconcileTimeoutsRef.current.push(timeoutId)
  }, [loadLiveState, sessionId])



  useFocusEffect(useCallback(() => {
    if (isFirstFocusRef.current) { isFirstFocusRef.current = false; return }
    if (Date.now() - lastBusRefreshRef.current < 2000) return
    void loadLiveState()
  }, [loadLiveState]))

  const openRoster = useCallback(() => {
    router.push({ pathname: '/host/session/[id]/roster', params: { id: sessionId } } as any)
  }, [sessionId])

  const runAction = useCallback(async (key: string, action: () => Promise<ActionResult | void>) => {
    if (actionInFlightRef.current) {
      if (__DEV__) console.warn('[NextRoundSuggesterV2] action ignored while another action is running', { key, busy })
      setError('Đang xử lý thao tác trước đó, thử lại sau vài giây.')
      return
    }
    actionInFlightRef.current = true
    setBusy(key)
    setError(null)
    try {
      const result = await action()
      if (result?.reload !== false) {
        await loadLiveState()
      }
      if (result?.reload === false) {
        scheduleReconcile(result)
      }
    } catch (err: any) {
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] action failed', err)
      setError(safeMessage)
      await loadLiveState()
      if (err && typeof err === 'object') {
        try {
          ;(err as { message?: string }).message = safeMessage
        } catch {
          err = new Error(safeMessage)
          // Keep the user-facing fallback below safe when the error object is readonly.
        }
      } else {
        err = new Error(safeMessage)
      }
      Alert.alert('Lỗi', err?.message ?? 'Không thể thực hiện thao tác')
    } finally {
      actionInFlightRef.current = false
      setBusy(null)
    }
  }, [busy, loadLiveState, scheduleReconcile])

  const syncRoster = useCallback(async () => {
    await runAction('sync', async () => {
      const playerIds = await loadLatestSyncablePlayerIds(
        sessionId,
        checkedInPlayers.map(player => String(player.id)),
      )
      if (playerIds.length === 0) {
        throw new Error('Không có người chơi đã xác nhận để cập nhật danh sách.')
      }
      await invokeLiveSessionFunction('session-sync-roster', sessionId, { player_ids: playerIds })
    })
  }, [runAction, sessionId, checkedInPlayers])

  React.useEffect(() => {
    if (loading || activeRound || autoSyncAttemptedRef.current) return

    if (rows.playerRows.length > 0) return

    const checkedInIds = checkedInPlayers.map(player => String(player.id))
    if (checkedInIds.length === 0) return

    const livePresentIds = new Set(
      rows.playerRows
        .filter(row => !row.checked_out_at)
        .map(row => String(row.player_id)),
    )
    const missingLiveRows = checkedInIds.some(playerId => !livePresentIds.has(playerId))
    if (!missingLiveRows) return

    autoSyncAttemptedRef.current = true
    void syncRoster()
  }, [activeRound, checkedInPlayers, loading, rows.playerRows, syncRoster])

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void loadLiveState()
    })
    return () => sub.remove()
  }, [loadLiveState])

  const addLateArrivalToRoster = async (playerId: string) => {
    if (lateArrivalInFlightRef.current.has(playerId)) return
    lateArrivalInFlightRef.current.add(playerId)
    setBusy(`late-${playerId}`)
    setError(null)
    const player = playersById.get(playerId)
    const optimisticRow: SessionPlayerStateRow = {
      session_id: sessionId,
      player_id: playerId,
      group_id: null,
      checked_in_at: new Date().toISOString(),
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
      players: {
        pvna: getPlayerPvna(player) ?? 0,
        elo: player?.elo,
        gender: player?.gender,
        partner_gender_pref: player?.metadata?.partner_gender_pref as string | null | undefined,
        opponent_gender_pref: player?.metadata?.opponent_gender_pref as string | null | undefined,
      },
      session_players: {
        metadata: player?.metadata ?? null,
      },
    }
    try {
      await checkInMutation.mutateAsync({ playerIds: [playerId], optimisticRows: [optimisticRow] })
      void markSessionPlayersPresent(sessionId, [playerId]).catch((error) => {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] late arrival session_players status update failed', error)
      })
    } catch (err: any) {
      
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] late arrival failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    } finally {
      lateArrivalInFlightRef.current.delete(playerId)
      setBusy(null)
    }
  }

  // buildSuggestedMatchPayloads has been moved to Edge Function
  const startLiveMatch = async (match: SuggestedLiveMatchRow) => {
    const startT0 = nowMs()
    if (startingPreviewIdsRef.current.has(match.id) || startedPreviewIds.has(match.id)) return
    startingPreviewIdsRef.current.add(match.id)
    if (__DEV__) console.log('[NextRoundSuggesterV2] start live match press', {
      matchId: match.id,
      version: liveStateVersionRef.current,
      courtIdx: match.court_idx,
      roundNo: match.round_no,
      status: match.status,
    })
    const previewVersionNumber = Number(match.preview_live_state_version ?? 0)
    const previewCountableMatchCountNumber = Number(match.preview_countable_match_count ?? -1)
    const previewVersion = Number.isFinite(previewVersionNumber) && previewVersionNumber > 0
      ? previewVersionNumber
      : null
    const previewCountableMatchCount = Number.isFinite(previewCountableMatchCountNumber) && previewCountableMatchCountNumber >= 0
      ? previewCountableMatchCountNumber
      : null
    if (previewVersion === null || previewCountableMatchCount === null) {
      startingPreviewIdsRef.current.delete(match.id)
      setError(toUserSafeActionError(new Error('Preview version missing')))
      void loadLiveState()
      return
    }
    const hasCompletedAfterPreview = effectiveLiveMatchRows
      .filter(row => row.status !== 'cancelled')
      .some(row => row.status === 'completed' && row.sequence_no >= previewCountableMatchCount)
    if (hasCompletedAfterPreview) {
      startingPreviewIdsRef.current.delete(match.id)
      const startedCourtIdx = getSuggestedLaneCourtIdx(match)
      if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)
      setSuggestedLiveMatches(current => current.filter(row => row.id !== match.id))
      suggestedPreviewBatchRef.current = null
      setPreviewRefreshNonce(value => value + 1)
      setError('Gợi ý vừa cũ sau khi có trận kết thúc. Đang tạo lại trận phù hợp hơn.')
      return
    }
    const startedCourtIdx = getSuggestedLaneCourtIdx(match)
    if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)

    setStartingPreviewIds(current => {
      const next = new Set(current)
      next.add(match.id)
      return next
    })
    const optimisticSequenceNo = [...rows.liveMatchRows, ...optimisticLiveMatches]
      .filter(row => row.status !== 'cancelled')
      .length
    const optimisticMatch: LiveDisplayMatchRow = {
      ...match,
      client_preview_id: match.id,
      status: 'live',
      started_at: new Date().toISOString(),
      score_a: match.score_a ?? 0,
      score_b: match.score_b ?? 0,
      resting: match.resting ?? [],
      sequence_no: optimisticSequenceNo,
    }
    setStartedPreviewIds(current => {
      const next = new Set(current)
      next.add(match.id)
      return next
    })
    setOptimisticLiveMatches(current => [
      ...current.filter(row => row.id !== match.id),
      optimisticMatch,
    ])
    await waitForUiFrame()

    const executeStart = async () => {
      const actionT0 = nowMs()
      const expectedVersion = liveStateVersionRef.current
      if (expectedVersion === null) throw new Error('Session changed')
      const payloadBuildT0 = nowMs()
      const rpcPayload = {
        p_session_id: sessionId,
        p_expected_live_state_version: expectedVersion,
        p_match: {
          court_idx: match.court_idx,
          team_a: match.team_a,
          team_b: match.team_b,
          resting: match.resting ?? [],
          round_no: match.round_no ?? -1,
        },
        p_audit_payload: {
          client_request_id: createClientRequestId('match'),
          source: 'client-preview-start-live-match',
          preview_id: match.id,
          preview_live_state_version: previewVersion,
          preview_countable_match_count: previewCountableMatchCount,
          expected_round_matches: queueCourtCount,
        },
      }
      const payloadBuildMs = nowMs() - payloadBuildT0
      const rpcT0 = nowMs()
      const { data: payload, error: rpcError } = await supabase.rpc('start_live_session_match_from_payload_versioned', {
        ...rpcPayload,
      })
      if (rpcError) throw rpcError
      const rpcMs = nowMs() - rpcT0
      const nextVersion = Number(payload?.live_state_version)
      if (Number.isFinite(nextVersion)) {
        liveStateVersionRef.current = liveStateVersionRef.current === null
          ? nextVersion
          : Math.max(liveStateVersionRef.current, nextVersion)
      }
      if (payload.match) {
        setLiveMatchDisplayKeys(current => ({
          ...current,
          [payload.match.id]: match.id,
        }))
        setStartedPreviewIds(current => {
          const next = new Set(current)
          next.add(match.id)
          return next
        })
        setSuggestedLiveMatches(prev => prev.filter(row => row.id !== match.id))
        setOptimisticLiveMatches(current => [
          ...current.filter(row => row.id !== match.id && row.id !== payload.match.id),
          {
            ...payload.match,
            client_preview_id: match.id,
          },
        ])
      }
      const applyT0 = nowMs()
      applyLiveMatches(payload.match ? [payload.match] : [], payload.live_state_version)
      const applyMs = nowMs() - applyT0
      if (__DEV__) console.log('[NextRoundSuggesterV2] start live match timing', {
        matchId: match.id,
        courtIdx: match.court_idx,
        roundNo: match.round_no,
        expectedVersion,
        nextVersion: payload?.live_state_version,
        payloadBuildMs: Math.round(payloadBuildMs),
        rpcMs: Math.round(rpcMs),
        applyMs: Math.round(applyMs),
        actionMs: Math.round(nowMs() - actionT0),
        totalMs: Math.round(nowMs() - startT0),
      })
      return {
        reload: false,
        reconcileAfterMs: 600,
      }
    }

    const queuedStart = liveMatchMutationQueueRef.current
      .catch(() => undefined)
      .then(executeStart)
    liveMatchMutationQueueRef.current = queuedStart.then(() => undefined, () => undefined)

    try {
      const result = await queuedStart
      startingPreviewIdsRef.current.delete(match.id)
      setStartingPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      if (result?.reload !== false) {
        await loadLiveState()
      } else {
        scheduleReconcile(result)
      }
    } catch (err: any) {
      startingPreviewIdsRef.current.delete(match.id)
      setStartingPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      const reconciledRows = await loadLiveState()
      const committedMatch = reconciledRows?.liveMatchRows.find(row =>
        row.status === 'live' && isSameCourtAndPlayers(row, match),
      )
      if (committedMatch) {
        const reconciledVersion = Number(reconciledRows?.liveStateVersion)
        if (Number.isFinite(reconciledVersion)) {
          liveStateVersionRef.current = liveStateVersionRef.current === null
            ? reconciledVersion
            : Math.max(liveStateVersionRef.current, reconciledVersion)
        }
        setLiveMatchDisplayKeys(current => ({
          ...current,
          [committedMatch.id]: match.id,
        }))
        setSuggestedLiveMatches(current => current.filter(row => row.id !== match.id))
        setOptimisticLiveMatches(current => [
          ...current.filter(row => row.id !== match.id && row.id !== committedMatch.id),
          {
            ...committedMatch,
            client_preview_id: match.id,
          },
        ])
        applyLiveMatches([committedMatch], reconciledRows?.liveStateVersion)
        if (__DEV__) console.warn('[NextRoundSuggesterV2] start response failed but match was committed; reconciled', {
          matchId: match.id,
          committedMatchId: committedMatch.id,
          courtIdx: match.court_idx,
          error: err?.message ?? String(err),
        })
        return
      }
      setStartedPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setOptimisticLiveMatches(current => current.filter(row => row.id !== match.id))
      if (shouldInvalidatePreviewAfterStartError(err)) {
        if (startedCourtIdx !== null) suggestedLaneCacheRef.current.delete(startedCourtIdx)
        setSuggestedLiveMatches(current => current.filter(row => row.id !== match.id))
        suggestedPreviewBatchRef.current = null
        setPreviewRefreshNonce(value => value + 1)
      } else if (startedCourtIdx !== null) {
        suggestedLaneCacheRef.current.set(startedCourtIdx, match)
      }
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] start match failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    }
  }

  const completeLiveMatch = async (match: SessionLiveMatchRow, score: { a: number; b: number }) => {
    const completeT0 = nowMs()
    if (endingLiveMatchIdsRef.current.has(match.id)) return
    endingLiveMatchIdsRef.current.add(match.id)
    const pressedVersion = liveStateVersionRef.current
    if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match press', {
      matchId: match.id,
      version: pressedVersion,
      courtIdx: match.court_idx,
      status: match.status,
    })
    setEndingLiveMatchIds(current => new Set(current).add(match.id))
    setCompletingLiveMatchIds(current => new Set(current).add(match.id))
    setCreatingNextMatchIds(current => new Set(current).add(match.id))
    setCompletingLiveMatchPlaceholders(current => {
      const next = new Map(current)
      next.set(match.id, match)
      return next
    })
    suggestedPreviewBatchRef.current = null
    const playerIds = [...match.team_a, ...match.team_b]
    const expectedPlayed = (state.players.get(match.team_a[0])?.matches_played ?? 0) + 1
    completingMatchExpectedPlayedRef.current.set(match.id, { playerIds, expectedPlayed })
    await waitForUiFrame()

    const executeComplete = async () => {
      const actionT0 = nowMs()
      const expectedVersion = liveStateVersionRef.current
      if (expectedVersion === null) throw new Error('Session changed')
      const projectT0 = nowMs()
      const projectedState = buildProjectedStateAfterLiveMatch(state, match)
      const projectMs = nowMs() - projectT0
      const targetT0 = nowMs()
      const projectedActivePlayers = [...projectedState.players.values()]
        .filter(player => player.checked_out_at === null)
      const targetReachedAfterMatch = effectiveTargetRounds > 0
        && projectedActivePlayers.length > 0
        && projectedActivePlayers.every(player => player.matches_played >= effectiveTargetRounds)
      const targetMs = nowMs() - targetT0
      const fairnessT0 = nowMs()
      const projectedScore = computeSessionFairness(projectedState).total
      const fairnessMs = nowMs() - fairnessT0
      const completePayload = {
        expected_live_state_version: expectedVersion,
        match_id: match.id,
        score_a: score.a,
        score_b: score.b,
        score_after: projectedScore,
        audit_payload: {
          client_request_id: createClientRequestId('match'),
          sequence_no: match.sequence_no,
          expected_round_matches: queueCourtCount,
        },
      }
      const rpcT0 = nowMs()
      const { data, error: rpcError } = await supabase.rpc('complete_live_session_match_versioned', {
        p_session_id: sessionId,
        p_expected_live_state_version: completePayload.expected_live_state_version,
        p_match_id: completePayload.match_id,
        p_score_a: completePayload.score_a,
        p_score_b: completePayload.score_b,
        p_score_after: completePayload.score_after,
        p_audit_payload: {
          ...completePayload.audit_payload,
          source: 'client-direct-complete-live-match',
        },
      })
      if (rpcError) throw rpcError
      const rpcMs = nowMs() - rpcT0
      const payload = data
      const nextVersion = Number(payload?.live_state_version)
      if (Number.isFinite(nextVersion)) {
        liveStateVersionRef.current = liveStateVersionRef.current === null
          ? nextVersion
          : Math.max(liveStateVersionRef.current, nextVersion)
      }
      if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match committed', {
        matchId: match.id,
        status: payload?.match?.status,
        liveStateVersion: payload?.live_state_version,
        targetReachedAfterMatch,
        projectMs: Math.round(projectMs),
        fairnessMs: Math.round(fairnessMs),
        rpcMs: Math.round(rpcMs),
        sincePressMs: Math.round(nowMs() - completeT0),
      })
      const applyT0 = nowMs()
      const completedMatch = (payload.match ?? { ...match, status: 'completed', ended_at: new Date().toISOString() }) as SessionLiveMatchRow
      applyCompletedLiveMatch(
        completedMatch,
        payload.changed_player_state ?? [],
        payload.changed_pair_history ?? [],
        payload.live_state_version,
      )
      const applyMs = nowMs() - applyT0
      // Any in-flight preview was built from the pre-completion player/pair state.
      previewRequestSerialRef.current += 1
      previewRequestInFlightRef.current = false
      previewRequestInFlightSerialRef.current = null
      previewRetryTimeoutsRef.current.forEach(clearTimeout)
      previewRetryTimeoutsRef.current.clear()
      setIsSuggestingPreview(false)
      completedLiveMatchCommitIdsRef.current.add(match.id)
      setCompletedLiveMatchCommitNonce(value => value + 1)
      suggestedPreviewBatchRef.current = null
      setStartedPreviewIds(new Set())
      setPreviewRefreshNonce(value => value + 1)
      if (__DEV__) console.log('[NextRoundSuggesterV2] complete live match timing', {
        matchId: match.id,
        courtIdx: match.court_idx,
        completedStatus: completedMatch.status,
        expectedVersion,
        nextVersion: payload.live_state_version,
        targetReachedAfterMatch,
        projectMs: Math.round(projectMs),
        fairnessMs: Math.round(fairnessMs),
        rpcMs: Math.round(rpcMs),
        applyMs: Math.round(applyMs),
        targetMs: Math.round(targetMs),
        actionMs: Math.round(nowMs() - actionT0),
        totalMs: Math.round(nowMs() - completeT0),
      })
      return {
        reload: false,
        reconcileAfterMs: 600,
        targetReachedAfterMatch,
      }
    }

    const queuedComplete = liveMatchMutationQueueRef.current
      .catch(() => undefined)
      .then(executeComplete)
    liveMatchMutationQueueRef.current = queuedComplete.then(() => undefined, () => undefined)

    try {
      const result = await queuedComplete
      endingLiveMatchIdsRef.current.delete(match.id)
      if (result?.reload !== false) {
        await loadLiveState()
      } else {
        scheduleReconcile(result)
      }
      setEndingLiveMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      if (result?.targetReachedAfterMatch) {
        setCompletingLiveMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCreatingNextMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
        setCompletingLiveMatchPlaceholders(current => {
          if (!current.has(match.id)) return current
          const next = new Map(current)
          next.delete(match.id)
          return next
        })
        return
      }
      const previousWatchdog = completingCleanupTimeoutsRef.current.get(match.id)
      if (previousWatchdog) clearTimeout(previousWatchdog)
      const cleanupId = setTimeout(() => {
        completingCleanupTimeoutsRef.current.delete(match.id)
        if (!completingLiveMatchPlaceholdersRef.current.has(match.id)) return
        previewBlockedIncompleteKeysRef.current.clear()
        suggestedPreviewBatchRef.current = null
        setPreviewRefreshNonce(value => value + 1)
        void loadLiveState()
      }, 3000)
      completingCleanupTimeoutsRef.current.set(match.id, cleanupId)
    } catch (err: any) {
      endingLiveMatchIdsRef.current.delete(match.id)
      const watchdog = completingCleanupTimeoutsRef.current.get(match.id)
      if (watchdog) clearTimeout(watchdog)
      completingCleanupTimeoutsRef.current.delete(match.id)
      setEndingLiveMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      completingMatchExpectedPlayedRef.current.delete(match.id)
      setCreatingNextMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setCompletingLiveMatchPlaceholders(current => {
        if (!current.has(match.id)) return current
        const next = new Map(current)
        next.delete(match.id)
        return next
      })
      setCompletingLiveMatchIds(current => {
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] complete match failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    }
  }

  const cancelLiveMatch = async (match: SessionLiveMatchRow) => {
    const cancelT0 = nowMs()
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
    setStartedPreviewIds(new Set())
    setPreviewRefreshNonce(value => value + 1)
    await runAction(`cancel-match-${match.id}`, async () => {
      const expectedVersion = liveStateVersionRef.current
      if (expectedVersion === null) throw new Error('Session changed')
      const rpcT0 = nowMs()
      const { data: payload, error: rpcError } = await supabase.rpc('cancel_live_session_match_versioned', {
        p_session_id: sessionId,
        p_expected_live_state_version: expectedVersion,
        p_match_id: match.id,
        p_audit_payload: {
          client_request_id: createClientRequestId('match'),
          sequence_no: match.sequence_no,
          source: 'client-direct-cancel-live-match',
        },
      })
      if (rpcError) throw rpcError
      const applyT0 = nowMs()
      applyLiveMatches(payload.match ? [payload.match] : [], payload.live_state_version)
      const applyMs = nowMs() - applyT0
      if (__DEV__) console.log('[NextRoundSuggesterV2] cancel live match timing', {
        matchId: match.id,
        expectedVersion,
        nextVersion: payload?.live_state_version,
        rpcMs: Math.round(nowMs() - rpcT0),
        applyMs: Math.round(applyMs),
        totalMs: Math.round(nowMs() - cancelT0),
      })
      return {
        reload: false,
        reconcileAfterMs: 600,
      }
    })
  }

  const startRound = async (alternative: SuggestionAlternative) => {
    await runAction('start', async () => {
      if (activeRound) throw new Error('Đang có vòng active. Hãy kết thúc vòng hiện tại trước.')
      const unavailableIds = alternative.matches
        .flatMap(match => [...match.team_a, ...match.team_b])
        .filter(playerId => {
          const player = state.players.get(playerId)
          return !player || player.checked_out_at !== null || player.opted_rest
        })
      if (unavailableIds.length > 0) {
        throw new Error('Manual matches must use checked-in players')
      }
      const clientRequestId = createClientRequestId('start')
      const startAuditPayload = {
        client_request_id: clientRequestId,
        suggestion_idx: selectedAlternative,
        manual: alternative.matches,
        decision_mode: manualAlternative !== null ? 'host_manual_matches' : 'host_selected_alternative',
        expected_state_fingerprint: buildSessionStateFingerprint(state),
        courts: courtCount,
        pvna_tolerance: pvnaTolerance,
        client_telemetry: {
          bootstrap: bootstrapTelemetry,
          ...planTelemetry,
          measured_at: new Date().toISOString(),
          live_state_version: liveStateVersion,
          suggestion_updating: suggestionIsUpdating,
        },
        decision_context: {
          selected_alternative_index: selectedAlternative,
          manual_swap_applied: manualAlternative !== null,
          last_host_action: selectionUndo?.reason ?? null,
          setup: {
            court_count: courtCount,
            pvna_tolerance: pvnaTolerance,
            court_preset: courtPreset,
            court_duration_min: courtDurationMin,
            target_rounds: effectiveTargetRounds,
          },
          selected_alternative: {
            score: alternative.score,
            stats: alternative.stats,
            warnings: alternative.warnings,
          },
          fairness_preview: fairnessPreview,
          fairness_warnings: fairnessWarnings.map(warning => ({
            severity: warning.severity,
            type: warning.type,
            affected_players: warning.affected_players,
            message: warning.message,
            suggested_action: warning.suggested_action,
          })),
          available_actions: suggestedRoundActions.map(action => ({
            type: action.type,
            label: action.label,
            detail: action.detail,
          })),
        },
      }
      if (liveStateVersion === null) {
        await invokeLiveSessionFunction('session-rounds-start', sessionId, startAuditPayload)
        return
      }
      const payload = await invokeLiveSessionFunction('session-rounds-start-versioned', sessionId, {
        expected_live_state_version: liveStateVersion,
        round_no: state.current_round,
        matches: alternative.matches,
        resting: alternative.resting,
        audit_payload: {
          ...startAuditPayload,
          source: 'NextRoundSuggesterScreenV2',
        },
      })
      applyStartedRound(payload?.round, payload?.live_state_version)
      return {
        reload: false,
        reconcileAfterMs: 600,
        reconcile: {
          action: 'start',
          expectedLiveStateVersion: payload?.live_state_version != null ? Number(payload.live_state_version) : null,
          expectedRoundNo: Number(payload?.round?.round_no ?? state.current_round),
          expectedRoundStatus: 'active',
        },
      }
    })
  }

  const endActiveRound = async () => {
    await runAction('end', async () => {
      if (!activeRound) throw new Error('Không có vòng active.')
      const clientRequestId = createClientRequestId('end')
      const validateCommitAudit = (commitAudit: any) => {
        const invalidDeltas = commitAudit?.deltas?.filter((row: any) =>
          row?.played ? row?.delta !== 1 : row?.delta !== 0
        ) ?? []
        if (invalidDeltas.length > 0) {
          console.error('[NextRoundSuggesterV2] commit audit mismatch', invalidDeltas)
          throw new Error('Round commit audit failed. Please refresh before continuing.')
        }
      }
      if (liveStateVersion === null) {
        const payload = await invokeLiveSessionFunction('session-rounds-end', sessionId, {}, { round_no: activeRound.round_no })
        validateCommitAudit(payload?.commit_audit)
        return
      }
      const existingPairs = pairHistoryRowsFromState(state)
      const committed = commitCompletedRound(
        state,
        {
          round_no: activeRound.round_no,
          matches: activeRound.matches,
          resting: activeRound.resting,
        },
        existingPairs,
      )
      const playedIds = new Set(activeRound.matches.flatMap(match => [...match.team_a, ...match.team_b]))
      const commitAudit = {
        deltas: [...committed.players.values()].map((player) => {
          const before = state.players.get(player.player_id)
          return {
            player_id: player.player_id,
            played: playedIds.has(player.player_id),
            before: before?.matches_played ?? 0,
            after: player.matches_played,
            delta: player.matches_played - (before?.matches_played ?? 0),
          }
        }),
      }
      validateCommitAudit(commitAudit)
      const playerStatePayload = [...committed.players.values()].map((player) => ({
        player_id: player.player_id,
        matches_played: player.matches_played,
        last_played_round: player.last_played_round,
        consecutive_rest: player.consecutive_rest,
        consecutive_play: player.consecutive_play,
        opted_rest: player.opted_rest,
      }))
      const pairHistoryPayload = changedPairHistoryRows(existingPairs, committed.pairHistory).map((row) => ({
        player_a: row.player_a,
        player_b: row.player_b,
        partner_count: row.partner_count,
        opponent_count: row.opponent_count,
      }))
      const scoreAfter = computeSessionFairness({
        ...state,
        current_round: Math.max(state.current_round, activeRound.round_no + 1),
        players: committed.players,
        rounds: state.rounds.map((round) =>
          round.round_no === activeRound.round_no
            ? {
                ...round,
                status: 'completed' as const,
                ended_at: new Date(),
              }
            : round,
        ),
      }).total
      const payload = await invokeLiveSessionFunction('session-rounds-end-versioned', sessionId, {
        expected_live_state_version: liveStateVersion,
        round_no: activeRound.round_no,
        player_state: playerStatePayload,
        pair_history: pairHistoryPayload,
        score_after: scoreAfter,
        audit_payload: {
          client_request_id: clientRequestId,
          source: 'NextRoundSuggesterScreenV2',
          commit_audit: commitAudit,
        },
      }, { round_no: activeRound.round_no })
      const changedPlayerState = Array.isArray(payload?.changed_player_state) && payload.changed_player_state.length > 0
        ? payload.changed_player_state
        : playerStatePayload
      const changedPairHistory = Array.isArray(payload?.changed_pair_history) && payload.changed_pair_history.length > 0
        ? payload.changed_pair_history
        : pairHistoryPayload
      applyEndedRound(activeRound.round_no, payload?.round, changedPlayerState, changedPairHistory, payload?.live_state_version)
      return {
        reload: false,
        reconcileAfterMs: 600,
        reconcile: {
          action: 'end',
          expectedLiveStateVersion: payload?.live_state_version != null ? Number(payload.live_state_version) : null,
          expectedRoundNo: activeRound.round_no,
          expectedRoundStatus: 'completed',
        },
      }
    })
  }

  const openSwapForPlayer = useCallback((playerId: string, match?: SuggestedLiveMatchRow) => {
    setSuggestedSwapMatch(match ?? null)
    setSwapFromPlayerId(playerId)
    setSheet('swap')
  }, [setSwapFromPlayerId, setSheet])

  const swapPlayersInWorkingAlternative = (fromId: string, toId: string) => {
    const base = manualAlternative ?? suggestion.alternatives[selectedAlternative]
    if (!base || fromId === toId) return
    const result = buildSwappedAlternative(base, state, fromId, toId)
    if (!result.alternative) {
      if (result.error) setError(result.error)
      return
    }
    rememberRoundSelection(`Đổi ${playerName(fromId, playersById)}`)
    setManualAlternative(result.alternative)
    setSwapFromPlayerId(null)
    setSheet(null)
  }

  const swapPlayersInSuggestedLiveMatch = (fromId: string, toId: string) => {
    if (!suggestedSwapMatch || fromId === toId) return
    const nextMatch = swapPlayersInSuggestedMatch(suggestedSwapMatch, fromId, toId)
    setSuggestedLiveMatches(current => current.map(match => match.id === nextMatch.id ? nextMatch : match))
    if (suggestedPreviewBatchRef.current) {
      suggestedPreviewBatchRef.current = {
        ...suggestedPreviewBatchRef.current,
        matches: suggestedPreviewBatchRef.current.matches.map(match => match.id === nextMatch.id ? nextMatch : match),
      }
    }
    const courtIdx = getSuggestedLaneCourtIdx(nextMatch)
    if (courtIdx !== null) suggestedLaneCacheRef.current.set(courtIdx, nextMatch)
    setSuggestedSwapMatch(null)
    setSwapFromPlayerId(null)
    setSheet(null)
  }

  const plannedPlayerCount = useMemo(() => workingAlternative
    ? new Set([
      ...workingAlternative.matches.flatMap(match => [...match.team_a, ...match.team_b]),
      ...workingAlternative.resting,
    ]).size
    : presentCount, [workingAlternative, presentCount])
  const activePlayerCount = useMemo(() => activeRound
    ? new Set([
      ...activeRound.matches.flatMap(match => [...match.team_a, ...match.team_b]),
      ...activeRound.resting,
    ]).size
    : presentCount, [activeRound, presentCount])
  const effectiveLiveMatchRows = useMemo(() => {
    const byId = new Map<string, LiveDisplayMatchRow>()
    for (const match of rows.liveMatchRows) {
      byId.set(match.id, {
        ...match,
        client_preview_id: liveMatchDisplayKeys[match.id],
      })
    }
    for (const match of optimisticLiveMatches) {
      if (!byId.has(match.id)) byId.set(match.id, match)
    }
    return [...byId.values()].sort((left, right) =>
      (left.court_idx ?? left.sequence_no) - (right.court_idx ?? right.sequence_no)
    )
  }, [liveMatchDisplayKeys, optimisticLiveMatches, rows.liveMatchRows])
  const activeLiveMatches = useMemo(
    () => {
      const matches = effectiveLiveMatchRows.filter(match =>
        match.status === 'live' || completingLiveMatchIds.has(match.id) || creatingNextMatchIds.has(match.id)
      )
      const byId = new Map(matches.map(match => [match.id, match]))
      completingLiveMatchPlaceholders.forEach((match, id) => {
        byId.set(id, match)
      })
      return [...byId.values()]
    },
    [completingLiveMatchIds, completingLiveMatchPlaceholders, creatingNextMatchIds, effectiveLiveMatchRows],
  )

  const capacityOccupyingLiveMatchCount = useMemo(
    () => effectiveLiveMatchRows.filter(match =>
      match.status === 'live'
      && !completedLiveMatchCommitIdsRef.current.has(match.id)
    ).length,
    [completedLiveMatchCommitNonce, effectiveLiveMatchRows],
  )
  const completedLiveMatches = useMemo(
    () => effectiveLiveMatchRows.filter(match => match.status === 'completed'),
    [effectiveLiveMatchRows],
  )
  const isPreviewInvalidatedByCompletedMatch = useCallback((match: SuggestedLiveMatchRow) => {
    const previewCountableMatchCount = Number(match.preview_countable_match_count ?? -1)
    if (!Number.isFinite(previewCountableMatchCount) || previewCountableMatchCount < 0) return true
    return effectiveLiveMatchRows
      .filter(row => row.status !== 'cancelled')
      .some(row => row.status === 'completed' && row.sequence_no >= previewCountableMatchCount)
  }, [effectiveLiveMatchRows])
  const busyLiveMatchPlayerIds = useMemo(() => new Set(
    effectiveLiveMatchRows
      .filter(match => match.status === 'live')
      .flatMap(match => [...match.team_a, ...match.team_b]),
  ), [effectiveLiveMatchRows])
  const nextMatchSuggestion = useMemo(
    () => USE_COURT_LANE_BOARD
      ? null
      : suggestNextMatch(state, {
        tier_overrides: fairnessAdjustment.tier_overrides,
        busy_player_ids: busyLiveMatchPlayerIds,
      }),
    [busyLiveMatchPlayerIds, fairnessAdjustment.tier_overrides, state],
  )
  const [suggestedLiveMatches, setSuggestedLiveMatches] = useState<SuggestedLiveMatchRow[]>([])
  const [edgeDebug, setEdgeDebug] = useState<any>(null)
  const queueCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const suggestedQueueCount = Math.max(0, queueCourtCount - capacityOccupyingLiveMatchCount)
  const getReusableSuggestedLaneMatches = useCallback(() => {
    const occupiedCourts = new Set<number>()
    const usedPlayerIds = new Set<string>()
    for (const match of activeLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) occupiedCourts.add(courtIdx)
      getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
    }

    const reusable: SuggestedLiveMatchRow[] = []
    const nextCache = new Map<number, SuggestedLiveMatchRow>()
    const reusableCandidates = new Map<number, SuggestedLiveMatchRow>(suggestedLaneCacheRef.current)
    for (const match of suggestedLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null && !reusableCandidates.has(courtIdx)) {
        reusableCandidates.set(courtIdx, match)
      }
    }
    const cachedMatches = [...reusableCandidates.entries()]
      .sort(([leftCourt], [rightCourt]) => leftCourt - rightCourt)

    for (const [courtIdx, match] of cachedMatches) {
      if (reusable.length >= suggestedQueueCount) break
      if (match.status !== 'suggested') continue
      if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) continue
      if (!Number.isFinite(courtIdx) || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      if (match.preview_live_state_version == null || match.preview_countable_match_count == null) continue
      if (isPreviewInvalidatedByCompletedMatch(match)) continue
      if (hasHardPreviewQualityViolation(match, state, pvnaTolerance)) continue

      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => usedPlayerIds.has(playerId))) continue

      playerIds.forEach(playerId => usedPlayerIds.add(playerId))
      reusable.push(match)
      nextCache.set(courtIdx, match)
    }

    suggestedLaneCacheRef.current = nextCache
    return reusable
  }, [activeLiveMatches, isPreviewInvalidatedByCompletedMatch, pvnaTolerance, queueCourtCount, startedPreviewIds, startingPreviewIds, state, suggestedLiveMatches, suggestedQueueCount])
  const getCurrentPreviewBoardForEdge = useCallback(() => {
    const occupiedCourts = new Set<number>()
    const usedPlayerIds = new Set<string>()
    for (const match of activeLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) occupiedCourts.add(courtIdx)
      getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
    }

    const candidates = new Map<number, SuggestedLiveMatchRow>(suggestedLaneCacheRef.current)
    for (const match of suggestedLiveMatches) {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null && !candidates.has(courtIdx)) candidates.set(courtIdx, match)
    }

    const board: SuggestedLiveMatchRow[] = []
    for (const [courtIdx, match] of [...candidates.entries()].sort(([left], [right]) => left - right)) {
      if (match.status !== 'suggested') continue
      if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) continue
      if (!Number.isFinite(courtIdx) || courtIdx < 0 || courtIdx >= queueCourtCount) continue
      if (occupiedCourts.has(courtIdx)) continue
      const playerIds = getMatchPlayerIds(match)
      if (playerIds.some(playerId => usedPlayerIds.has(playerId))) continue
      playerIds.forEach(playerId => usedPlayerIds.add(playerId))
      board.push(match)
    }
    return board
  }, [activeLiveMatches, queueCourtCount, startedPreviewIds, startingPreviewIds, suggestedLiveMatches])
  const previewBatchKey = useMemo(
    () => buildPreviewBatchKey(sessionId, state, queueCourtCount, pvnaTolerance, fairnessAdjustment),
    [fairnessAdjustment, pvnaTolerance, queueCourtCount, sessionId, state],
  )
  const previewLaneCacheKey = useMemo(() => {
    const playerKey = rows.playerRows
      .map(row => {
        const player = playersById.get(String(row.player_id))
        return [
          row.player_id,
          row.group_id ?? '',
          row.checked_out_at ? 'out' : 'in',
          row.opted_rest ? 'rest' : 'play',
          row.players?.pvna ?? getPlayerPvna(player) ?? '',
          row.players?.gender ?? player?.gender ?? '',
          row.players?.partner_gender_pref ?? player?.metadata?.partner_gender_pref ?? '',
          row.players?.opponent_gender_pref ?? player?.metadata?.opponent_gender_pref ?? '',
        ].join(':')
      })
      .sort()
      .join('|')
    const tierKey = Object.entries(fairnessAdjustment.tier_overrides)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, tier]) => `${playerId}:${tier}`)
      .join(',')
    return [
      sessionId,
      state.status,
      queueCourtCount,
      pvnaTolerance,
      state.config.pvna_tolerance,
      JSON.stringify(state.config.weights),
      fairnessAdjustment.applied_for_warnings.map(String).sort().join(','),
      tierKey,
      playerKey,
    ].join('||')
  }, [fairnessAdjustment, playersById, pvnaTolerance, queueCourtCount, rows.playerRows, sessionId, state.config.pvna_tolerance, state.config.weights, state.status])
  React.useEffect(() => {
    if (previewBaseKeyRef.current === null) {
      previewBaseKeyRef.current = previewLaneCacheKey
      return
    }
    if (previewBaseKeyRef.current === previewLaneCacheKey) return
    previewBaseKeyRef.current = previewLaneCacheKey
    suggestedPreviewBatchRef.current = null
    suggestedLaneCacheRef.current.clear()
  }, [previewLaneCacheKey])
  const previewRequestKey = useMemo(() => {
    const rowVersionKey = [
      rows.playerRows.length,
      rows.pairRows.length,
      rows.roundRows.length,
      rows.liveStateVersion ?? 'noversion',
    ].join(':')
    const liveRowsKey = effectiveLiveMatchRows
      .map(match => `${match.id}:${match.status}:${match.court_idx ?? ''}:${match.sequence_no}`)
      .join(',')
    const completingKey = [...completingLiveMatchIds].sort().join(',')
    const creatingKey = [...creatingNextMatchIds].sort().join(',')
    return [
      previewBatchKey,
      rowVersionKey,
      liveRowsKey,
      completingKey,
      creatingKey,
      previewRefreshNonce,
    ].join('||')
  }, [
    completingLiveMatchIds,
    creatingNextMatchIds,
    effectiveLiveMatchRows,
    previewBatchKey,
    previewRefreshNonce,
    rows.liveStateVersion,
    rows.pairRows.length,
    rows.playerRows.length,
    rows.roundRows.length,
  ])
  React.useEffect(() => {
    if (previewBatchKeyRef.current === null) {
      previewBatchKeyRef.current = previewRequestKey
      return
    }
    if (previewBatchKeyRef.current === previewRequestKey) return
    previewBatchKeyRef.current = previewRequestKey
    setStartedPreviewIds(current => current.size === 0 ? current : new Set())
  }, [previewRequestKey])
  const previewBodyRef = useRef({
    effectiveLiveMatchRows,
    liveStateVersion: rows.liveStateVersion,
    completingLiveMatchIds,
    playersById,
    rows,
    queueCourtCount,
    pvnaTolerance,
    suggestedQueueCount,
    sessionId,
  })
  previewBodyRef.current = { effectiveLiveMatchRows, liveStateVersion: rows.liveStateVersion, completingLiveMatchIds, playersById, rows, queueCourtCount, pvnaTolerance, suggestedQueueCount, sessionId }

  useEffect(() => {
    if (!USE_COURT_LANE_BOARD) return
    if (phase !== 'plan' || !settingsHydrated || rows.playerRows.length === 0) return
    if (isSuggestingPreview || previewRequestInFlightRef.current || suggestedQueueCount === 0) return
    if (suggestedPreviewBatchRef.current?.key !== previewRequestKey) return

    const visibleSuggestedCount = suggestedLiveMatches.filter(match => !startedPreviewIds.has(match.id)).length
    if (visibleSuggestedCount > 0 && visibleSuggestedCount === suggestedPreviewBatchRef.current.matches.length) return
    if (visibleSuggestedCount >= suggestedQueueCount) return

    const recoveryKey = [
      previewBatchKey,
      rows.liveStateVersion ?? 'noversion',
      suggestedQueueCount,
      visibleSuggestedCount,
      effectiveLiveMatchRows.map(match => `${match.id}:${match.status}:${match.court_idx ?? ''}`).join(','),
    ].join('||')

    if (previewRecoveryKeyRef.current === recoveryKey) return
    previewRecoveryKeyRef.current = recoveryKey
    suggestedPreviewBatchRef.current = null
    setPreviewRefreshNonce(value => value + 1)
  }, [
    completedLiveMatchCommitNonce,
    effectiveLiveMatchRows,
    isSuggestingPreview,
    phase,
    previewBatchKey,
    previewRequestKey,
    rows.liveStateVersion,
    rows.playerRows.length,
    settingsHydrated,
    startedPreviewIds,
    suggestedLiveMatches,
    suggestedQueueCount,
  ])

  useEffect(() => {
    const previewReady = phase === 'plan'
      && settingsHydrated
      && rows.playerRows.length > 0

    if (!previewReady) {
      setSuggestedLiveMatches(current => current.length === 0 ? current : [])
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
      return
    }

    const cachedBatch = suggestedPreviewBatchRef.current
    if (cachedBatch?.key === previewRequestKey) {
      const reusableCachedMatches = cachedBatch.matches
        .filter((match: SuggestedLiveMatchRow) => !startedPreviewIds.has(match.id))
        .filter((match: SuggestedLiveMatchRow) => !isPreviewInvalidatedByCompletedMatch(match))
      const newMatches = reusableCachedMatches
        .filter((match: SuggestedLiveMatchRow) => !hasHardPreviewQualityViolation(match, state, pvnaTolerance))
        .slice(0, suggestedQueueCount)
      if (newMatches.length < Math.min(reusableCachedMatches.length, suggestedQueueCount)) {
        suggestedPreviewBatchRef.current = null
        suggestedLaneCacheRef.current.clear()
      } else if (newMatches.length === 0 && cachedBatch.matches.length > 0) {
        suggestedPreviewBatchRef.current = null
        suggestedLaneCacheRef.current.clear()
      } else {
        setSuggestedLiveMatches(prev => {
          if (prev.length === newMatches.length && prev.every((m, i) => m.id === newMatches[i].id)) return prev
          return newMatches
        })
        return
      }
    }

    if (suggestedQueueCount === 0) {
      setSuggestedLiveMatches(current => current.length === 0 ? current : [])
      suggestedPreviewBatchRef.current = null
      suggestedLaneCacheRef.current.clear()
      return
    }

    const waitingForCompletionCommit = [...completingLiveMatchPlaceholdersRef.current.keys()].some(matchId =>
      !completedLiveMatchCommitIdsRef.current.has(matchId)
      && effectiveLiveMatchRows.some(match => match.id === matchId && match.status === 'live')
    )
    if (waitingForCompletionCommit) return

    const currentPreviewBoardForEdge = getCurrentPreviewBoardForEdge()
    // Capture the visible board before reusable filtering clears previews made stale
    // by the just-completed match. Edge revalidates and restamps retained lanes.
    const reusableMatches = getReusableSuggestedLaneMatches()
    const hasHardReusableQualityViolation = currentPreviewBoardForEdge.some(match =>
      hasHardPreviewQualityViolation(match, state, pvnaTolerance)
    )
    const pendingReplacementCourts = new Set<number>()
    completingLiveMatchPlaceholdersRef.current.forEach(match => {
      const courtIdx = getSuggestedLaneCourtIdx(match)
      if (courtIdx !== null) pendingReplacementCourts.add(courtIdx)
    })
    const reusableCourts = new Set(reusableMatches.map(match => getSuggestedLaneCourtIdx(match)).filter((courtIdx): courtIdx is number => courtIdx !== null))
    const missingReplacementCourt = [...pendingReplacementCourts].some(courtIdx => !reusableCourts.has(courtIdx))
    if (!hasHardReusableQualityViolation && !missingReplacementCourt && reusableMatches.length >= suggestedQueueCount) {
      const newMatches = reusableMatches.slice(0, suggestedQueueCount)
      suggestedPreviewBatchRef.current = { key: previewRequestKey, matches: newMatches }
      setSuggestedLiveMatches(prev => {
        if (prev.length === newMatches.length && prev.every((m, i) => m.id === newMatches[i].id)) return prev
        return newMatches
      })
      return
    }
    const fetchSuggestedCount = Math.max(
      1,
      Math.min(
        suggestedQueueCount,
        hasHardReusableQualityViolation || missingReplacementCourt
          ? hasHardReusableQualityViolation
            ? suggestedQueueCount
            : Math.max(1, pendingReplacementCourts.size)
          : Math.max(1, suggestedQueueCount - reusableMatches.length),
      ),
    )
    const incompleteRequestKey = [
      previewBatchKey,
      rows.liveStateVersion ?? 'noversion',
      suggestedQueueCount,
      [...pendingReplacementCourts].sort((left, right) => left - right).join(','),
      reusableMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
      effectiveLiveMatchRows.map(match => `${match.id}:${match.status}:${match.court_idx ?? ''}`).join(','),
    ].join('||')
    if (previewBlockedIncompleteKeysRef.current.has(incompleteRequestKey)) return
    if (previewPendingRequestKeysRef.current.has(incompleteRequestKey)) return
    previewPendingRequestKeysRef.current.add(incompleteRequestKey)
    let cancelledBeforeStart = false
    let requestStarted = false
    const requestSerial = previewRequestSerialRef.current + 1
    previewRequestSerialRef.current = requestSerial
    const requestSessionGeneration = sessionGenerationRef.current
    const isCurrentPreviewRequest = () =>
      previewRequestSerialRef.current === requestSerial
      && sessionGenerationRef.current === requestSessionGeneration
    previewRequestInFlightRef.current = true
    previewRequestInFlightSerialRef.current = requestSerial
    setIsSuggestingPreview(true)
    markNextRoundStage(sessionId, 'preview_request_scheduled', {
      suggested_queue_count: fetchSuggestedCount,
      live_state_version: rows.liveStateVersion,
    })

    const previewT0 = nowMs()
    const timer = setTimeout(() => {
      if (cancelledBeforeStart || !isCurrentPreviewRequest()) return
      requestStarted = true
      markNextRoundStage(sessionId, 'preview_request_start', {
        suggested_queue_count: fetchSuggestedCount,
        live_state_version: rows.liveStateVersion,
      })
      if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch start', {
        suggestedQueueCount: fetchSuggestedCount,
        targetSuggestedQueueCount: suggestedQueueCount,
        liveStateVersion: rows.liveStateVersion,
      })

      const snap = previewBodyRef.current
      const snapshotCountableMatchCount = snap.effectiveLiveMatchRows.filter(match => match.status !== 'cancelled').length
      const snapshotLiveStateVersion = Math.max(
        Number(snap.liveStateVersion ?? 0),
        Number(liveStateVersionRef.current ?? 0),
      )
      const missingPreviewCourtIdxs = getMissingPreviewCourtIdxs({
        courtCount: snap.queueCourtCount,
        liveMatches: activeLiveMatches,
        previewMatches: currentPreviewBoardForEdge,
      })
      const retainedPreviewBusyRows = hasHardReusableQualityViolation ? [] : currentPreviewBoardForEdge.map((match, index): SessionLiveMatchRow => ({
        ...match,
        id: `retained-preview-busy-${match.id}`,
        sequence_no: snapshotCountableMatchCount + index,
        status: 'suggested',
      }))
      const requestedReplacementCourtIdxs = currentPreviewBoardForEdge.length > 0
        && !hasHardReusableQualityViolation
        ? getRequestedReplacementCourtIdxs({
            pendingReplacementCourtIdxs: pendingReplacementCourts,
            missingPreviewCourtIdxs,
            limit: fetchSuggestedCount,
          })
        : []
      const previewMode: 'full_board' | 'replace_courts' = requestedReplacementCourtIdxs.length > 0 && !hasHardReusableQualityViolation
        ? 'replace_courts'
        : 'full_board'
      const body = {
        mode: previewMode,
        count: fetchSuggestedCount,
        court_count: snap.queueCourtCount,
        pvna_tolerance: snap.pvnaTolerance,
        court_idxs: requestedReplacementCourtIdxs,
        current_preview_board: currentPreviewBoardForEdge,
        live_match_rows: [...snap.effectiveLiveMatchRows, ...retainedPreviewBusyRows],
        live_state_version: snapshotLiveStateVersion,
        completing_live_match_ids: Array.from(snap.completingLiveMatchIds),
        players: Array.from(snap.playersById.entries()).map(([id, p]) => ({ id, name: p.name })),
        player_rows: snap.rows.playerRows,
        pair_rows: snap.rows.pairRows,
        round_rows: snap.rows.roundRows,
      }
      if (__DEV__) console.log('[NextRoundSuggesterV2] preview request board', {
        mode: previewMode,
        currentPreviewCourts: currentPreviewBoardForEdge.map(match => getSuggestedLaneCourtIdx(match)),
        pendingReplacementCourts: [...pendingReplacementCourts],
        requestedReplacementCourts: requestedReplacementCourtIdxs,
      })

      fetchLiveMatchesPreview(snap.sessionId, body)
        .then(res => {
          if (!isCurrentPreviewRequest()) return
          setEdgeDebug(res.debug)
          if (__DEV__) {
            const riskyMatches = (res.payloads ?? []).filter((p: any) => p._exhaustive_diag)
            riskyMatches.forEach((p: any) => {
              console.log('[preview] vượt cap PVNA — exhaustive fallback diag', {
                court: p.court_idx,
                pvnaDiff: p._exhaustive_diag.bestPvnaDiff,
                timedOut: p._exhaustive_diag.timedOut,
                combinationsEvaluated: p._exhaustive_diag.combinationsEvaluated,
                eligibleCount: p._exhaustive_diag.eligibleCount,
                bestHasTradeoffs: p._exhaustive_diag.bestHasTradeoffs,
                elapsedMs: p._exhaustive_diag.elapsedMs,
              })
            })
          }
          const edgeReturnedFinalBoard = Array.isArray(res.final_preview_board) && res.final_preview_board.length > 0
          const responsePayloads = edgeReturnedFinalBoard
            ? res.final_preview_board
            : (res.payloads ?? [])
          const rawFetchedCourtIdxs = responsePayloads
            .map((match: any, index: number) => Number(match.court_idx ?? index))
            .filter((courtIdx: number) => Number.isFinite(courtIdx))
          const fetchedCourtIdxsAreOneBased = !edgeReturnedFinalBoard
            && rawFetchedCourtIdxs.length > 0
            && !rawFetchedCourtIdxs.includes(0)
            && Math.min(...rawFetchedCourtIdxs) >= 1
            && Math.max(...rawFetchedCourtIdxs) <= queueCourtCount
          const fetchedMatches: SuggestedLiveMatchRow[] = responsePayloads.map((match: any, index: number): SuggestedLiveMatchRow => {
            const rawCourtIdx = Number(match.court_idx ?? index)
            const zeroBasedCourtIdx = fetchedCourtIdxsAreOneBased ? rawCourtIdx - 1 : rawCourtIdx
            const normalizedCourtIdx = Number.isFinite(zeroBasedCourtIdx)
              ? Math.max(0, Math.min(queueCourtCount - 1, zeroBasedCourtIdx))
              : index
            return {
            ...match,
            id: `preview-${normalizedCourtIdx}-${match.team_a.join('-')}-${match.team_b.join('-')}`,
            session_id: sessionId,
            sequence_no: index,
            round_no: match.round_no,
            court_idx: normalizedCourtIdx,
            status: 'suggested',
            team_a: match.team_a,
            team_b: match.team_b,
            resting: match.resting ?? [],
            preview_live_state_version: snapshotLiveStateVersion,
            preview_countable_match_count: snapshotCountableMatchCount,
            score_a: 0,
            score_b: 0,
            suggested_at: new Date().toISOString(),
            started_at: null,
            ended_at: null,
            }
          })
          const replacementCourtIdxs = new Set<number>()
          completingLiveMatchPlaceholdersRef.current.forEach(match => {
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) replacementCourtIdxs.add(courtIdx)
          })
          if (edgeReturnedFinalBoard) {
            const stampedMatches = fetchedMatches
              .filter(match => match.status === 'suggested')
              .filter(match => !startedPreviewIds.has(match.id))
              .filter(match => !startingPreviewIds.has(match.id))
              .filter(match => !startingPreviewIdsRef.current.has(match.id))
              .map(match => ({
                ...match,
                preview_live_state_version: match.preview_live_state_version ?? snapshotLiveStateVersion,
                preview_countable_match_count: match.preview_countable_match_count ?? snapshotCountableMatchCount,
              }))
              .sort((left, right) => {
                const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
                const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
                return leftCourtIdx - rightCourtIdx
              })
            const nextLaneCache = new Map<number, SuggestedLiveMatchRow>()
            stampedMatches.forEach(match => {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx !== null) nextLaneCache.set(courtIdx, match)
            })
            const hasPendingReplacementCourts = replacementCourtIdxs.size > 0
            const previewBatchComplete = stampedMatches.length > 0
              && hasFulfilledReplacementCourts(stampedMatches, replacementCourtIdxs)
            const shouldCommitPreviewBatch = previewBatchComplete
            if (shouldCommitPreviewBatch) {
              suggestedLaneCacheRef.current = nextLaneCache
              suggestedPreviewBatchRef.current = previewBatchComplete
                ? { key: previewRequestKey, matches: stampedMatches }
                : null
              setSuggestedLiveMatches(stampedMatches)
            } else {
              suggestedPreviewBatchRef.current = null
            }
            const replacementCourts = new Set(
              [...replacementCourtIdxs].filter(courtIdx => nextLaneCache.has(courtIdx)),
            )
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (!replacementCourts.has(Number(match.court_idx ?? -1))) return
              const watchdog = completingCleanupTimeoutsRef.current.get(matchId)
              if (watchdog) clearTimeout(watchdog)
              completingCleanupTimeoutsRef.current.delete(matchId)
            })
            setCompletingLiveMatchIds(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Set(current)
              completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            setCreatingNextMatchIds(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Set(current)
              completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            setCompletingLiveMatchPlaceholders(current => {
              if (current.size === 0 || replacementCourts.size === 0) return current
              const next = new Map(current)
              current.forEach((match, matchId) => {
                if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
              })
              return next
            })
            markNextRoundStage(sessionId, 'preview_ready', {
              preview_ms: Math.round(nowMs() - previewT0),
              match_count: stampedMatches.length,
              fetched_match_count: fetchedMatches.length,
              retained_preview_count: Math.max(0, stampedMatches.length - replacementCourts.size),
              live_state_version: rows.liveStateVersion,
            })
            if (!previewBatchComplete) {
              const retryKey = [
                incompleteRequestKey,
                [...replacementCourtIdxs].sort((left, right) => left - right).join(','),
                fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
                stampedMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
              ].join('||')
              const currentRetry = previewIncompleteRetryRef.current.key === retryKey
                ? previewIncompleteRetryRef.current.count + 1
                : 1
              previewIncompleteRetryRef.current = { key: retryKey, count: currentRetry }
              if (currentRetry < 2) {
                const retryTimeout = setTimeout(() => {
                  previewRetryTimeoutsRef.current.delete(retryTimeout)
                  if (sessionGenerationRef.current !== requestSessionGeneration) return
                  setPreviewRefreshNonce(value => value + 1)
                }, 350)
                previewRetryTimeoutsRef.current.add(retryTimeout)
              } else {
                previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
                const retryTimeout = setTimeout(() => {
                  previewRetryTimeoutsRef.current.delete(retryTimeout)
                  if (sessionGenerationRef.current !== requestSessionGeneration) return
                  previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
                  setPreviewRefreshNonce(value => value + 1)
                }, 3000)
                previewRetryTimeoutsRef.current.add(retryTimeout)
              }
            } else {
              previewIncompleteRetryRef.current = { key: '', count: 0 }
              previewBlockedIncompleteKeysRef.current.clear()
              previewRetryTimeoutsRef.current.forEach(clearTimeout)
              previewRetryTimeoutsRef.current.clear()
            }
            if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch done', {
              totalMs: Math.round(nowMs() - previewT0),
              matchCount: stampedMatches.length,
              fetchedMatchCount: fetchedMatches.length,
              retainedPreviewCount: Math.max(0, stampedMatches.length - replacementCourts.size),
              edgeFinalBoard: true,
            })
            return
          }
          const retainedMatches = hasHardReusableQualityViolation ? [] : getReusableSuggestedLaneMatches()
          const usedCourts = new Set<number>()
          const usedPlayerIds = new Set<string>()
          const busyCourtIdxs = new Set<number>()
          for (const match of activeLiveMatches) {
            if (
              completingLiveMatchIds.has(match.id)
              || creatingNextMatchIds.has(match.id)
              || completingLiveMatchPlaceholdersRef.current.has(match.id)
            ) {
              continue
            }
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) {
              usedCourts.add(courtIdx)
              busyCourtIdxs.add(courtIdx)
            }
            getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
          }
          const matches: SuggestedLiveMatchRow[] = []
          const getMatchSignature = (match: SuggestedLiveMatchRow) => [
            ...match.team_a.map(String).sort(),
            ...match.team_b.map(String).sort(),
          ].join('|')
          const buildRetargetedMatch = (match: SuggestedLiveMatchRow, courtIdx: number): SuggestedLiveMatchRow => ({
            ...match,
            id: `preview-${courtIdx}-${match.team_a.join('-')}-${match.team_b.join('-')}`,
            court_idx: courtIdx,
          })
          const addMatchIfValid = (match: SuggestedLiveMatchRow) => {
            if (matches.length >= suggestedQueueCount) return
            if (match.status !== 'suggested') return
            if (startedPreviewIds.has(match.id) || startingPreviewIds.has(match.id) || startingPreviewIdsRef.current.has(match.id)) return
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx === null || courtIdx < 0 || courtIdx >= queueCourtCount) return
            if (matches.some(existing => getSuggestedLaneCourtIdx(existing) === courtIdx)) return
            if (usedCourts.has(courtIdx) && !replacementCourtIdxs.has(courtIdx)) return
            const playerIds = getMatchPlayerIds(match)
            if (playerIds.some(playerId => usedPlayerIds.has(playerId))) return
            usedCourts.add(courtIdx)
            playerIds.forEach(playerId => usedPlayerIds.add(playerId))
            matches.push(match)
          }
          const fillOpenCourtsFromFetched = () => {
            if (matches.length >= suggestedQueueCount) return
            const usedSignatures = new Set(matches.map(getMatchSignature))
            const openCourtIdxs: number[] = []
            for (let courtIdx = 0; courtIdx < queueCourtCount; courtIdx += 1) {
              if (matches.some(match => getSuggestedLaneCourtIdx(match) === courtIdx)) continue
              if (usedCourts.has(courtIdx) && !replacementCourtIdxs.has(courtIdx)) continue
              openCourtIdxs.push(courtIdx)
            }
            for (const courtIdx of openCourtIdxs) {
              if (matches.length >= suggestedQueueCount) break
              const fallbackMatch = fetchedMatches.find(match => {
                const signature = getMatchSignature(match)
                if (usedSignatures.has(signature)) return false
                const playerIds = getMatchPlayerIds(match)
                return !playerIds.some(playerId => usedPlayerIds.has(playerId))
              })
              if (!fallbackMatch) break
              usedSignatures.add(getMatchSignature(fallbackMatch))
              addMatchIfValid(buildRetargetedMatch(fallbackMatch, courtIdx))
            }
          }
          const replacementMatches: SuggestedLiveMatchRow[] = []
          const usedReplacementSignatures = new Set<string>()
          for (const replacementCourtIdx of replacementCourtIdxs) {
            const directMatch = fetchedMatches.find(match => getSuggestedLaneCourtIdx(match) === replacementCourtIdx)
            const fallbackMatch = directMatch
              ?? fetchedMatches.find(match => !usedReplacementSignatures.has(getMatchSignature(match)))
            if (!fallbackMatch) continue
            const replacementMatch = getSuggestedLaneCourtIdx(fallbackMatch) === replacementCourtIdx
              ? fallbackMatch
              : buildRetargetedMatch(fallbackMatch, replacementCourtIdx)
            usedReplacementSignatures.add(getMatchSignature(fallbackMatch))
            replacementMatches.push(replacementMatch)
          }
          replacementMatches.forEach(addMatchIfValid)
          retainedMatches
            .filter(match => !usedReplacementSignatures.has(getMatchSignature(match)))
            .forEach(addMatchIfValid)
          fillOpenCourtsFromFetched()
          const orderedFetchedMatches = [...fetchedMatches].sort((left, right) => {
            const leftCourtIdx = getSuggestedLaneCourtIdx(left) ?? Number.MAX_SAFE_INTEGER
            const rightCourtIdx = getSuggestedLaneCourtIdx(right) ?? Number.MAX_SAFE_INTEGER
            return leftCourtIdx - rightCourtIdx
          })
          orderedFetchedMatches
            .filter(match => {
              const courtIdx = getSuggestedLaneCourtIdx(match)
              return (courtIdx === null || !replacementCourtIdxs.has(courtIdx))
              && !usedReplacementSignatures.has(getMatchSignature(match))
            })
            .forEach(addMatchIfValid)
          fillOpenCourtsFromFetched()
          if (matches.length < suggestedQueueCount && fetchedMatches.length > matches.length) {
            matches.splice(0, matches.length)
            usedCourts.clear()
            usedPlayerIds.clear()
            busyCourtIdxs.clear()
            for (const match of activeLiveMatches) {
              if (
                completingLiveMatchIds.has(match.id)
                || creatingNextMatchIds.has(match.id)
                || completingLiveMatchPlaceholdersRef.current.has(match.id)
              ) {
                continue
              }
              const courtIdx = getSuggestedLaneCourtIdx(match)
              if (courtIdx !== null) {
                usedCourts.add(courtIdx)
                busyCourtIdxs.add(courtIdx)
              }
              getMatchPlayerIds(match).forEach(playerId => usedPlayerIds.add(playerId))
            }
            orderedFetchedMatches.forEach(addMatchIfValid)
            fillOpenCourtsFromFetched()
          }
          const stampedMatches = matches.map(match => ({
            ...match,
            preview_live_state_version: match.preview_live_state_version ?? snapshotLiveStateVersion,
            preview_countable_match_count: match.preview_countable_match_count ?? snapshotCountableMatchCount,
          }))
          const nextLaneCache = new Map<number, SuggestedLiveMatchRow>()
          stampedMatches.forEach(match => {
            const courtIdx = getSuggestedLaneCourtIdx(match)
            if (courtIdx !== null) nextLaneCache.set(courtIdx, match)
          })
          const hasPendingReplacementCourts = replacementCourtIdxs.size > 0
          const previewBatchComplete = isPreviewBoardComplete({
            matches: stampedMatches,
            expectedCount: suggestedQueueCount,
            replacementCourtIdxs,
          })
          const shouldCommitPreviewBatch = previewBatchComplete || !hasPendingReplacementCourts
          if (shouldCommitPreviewBatch) {
            suggestedLaneCacheRef.current = nextLaneCache
            suggestedPreviewBatchRef.current = previewBatchComplete
              ? { key: previewRequestKey, matches: stampedMatches }
              : null
            setSuggestedLiveMatches(stampedMatches)
          } else {
            suggestedPreviewBatchRef.current = null
          }
          const replacementCourts = new Set(stampedMatches.map((match: SuggestedLiveMatchRow) => Number(match.court_idx ?? -1)))
          completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
            if (!replacementCourts.has(Number(match.court_idx ?? -1))) return
            const watchdog = completingCleanupTimeoutsRef.current.get(matchId)
            if (watchdog) clearTimeout(watchdog)
            completingCleanupTimeoutsRef.current.delete(matchId)
          })
          setCompletingLiveMatchIds(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Set(current)
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          setCreatingNextMatchIds(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Set(current)
            completingLiveMatchPlaceholdersRef.current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          setCompletingLiveMatchPlaceholders(current => {
            if (current.size === 0 || replacementCourts.size === 0) return current
            const next = new Map(current)
            current.forEach((match, matchId) => {
              if (replacementCourts.has(Number(match.court_idx ?? -1))) next.delete(matchId)
            })
            return next
          })
          markNextRoundStage(sessionId, 'preview_ready', {
            preview_ms: Math.round(nowMs() - previewT0),
            match_count: stampedMatches.length,
            fetched_match_count: fetchedMatches.length,
            retained_preview_count: retainedMatches.length,
            live_state_version: rows.liveStateVersion,
          })
          if (!previewBatchComplete) {
            const retryKey = [
              incompleteRequestKey,
              [...replacementCourtIdxs].sort((left, right) => left - right).join(','),
              fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
              matches.map(match => getSuggestedLaneCourtIdx(match)).join(','),
            ].join('||')
            const currentRetry = previewIncompleteRetryRef.current.key === retryKey
              ? previewIncompleteRetryRef.current.count + 1
              : 1
            previewIncompleteRetryRef.current = { key: retryKey, count: currentRetry }
            if (__DEV__) console.warn('[NextRoundSuggesterV2] preview batch incomplete, retrying', {
              suggestedQueueCount,
              matchCount: matches.length,
              replacementCourts: [...replacementCourtIdxs],
              fulfilledReplacementCourts: [...replacementCourtIdxs].every(courtIdx => nextLaneCache.has(courtIdx)),
              fetchedCourts: fetchedMatches.map(match => getSuggestedLaneCourtIdx(match)),
              retainedCourts: retainedMatches.map(match => getSuggestedLaneCourtIdx(match)),
              resultCourts: matches.map(match => getSuggestedLaneCourtIdx(match)),
              retryCount: currentRetry,
            })
            if (currentRetry < 2) {
              const retryTimeout = setTimeout(() => {
                previewRetryTimeoutsRef.current.delete(retryTimeout)
                if (sessionGenerationRef.current !== requestSessionGeneration) return
                setPreviewRefreshNonce(value => value + 1)
              }, 350)
              previewRetryTimeoutsRef.current.add(retryTimeout)
            } else {
              previewBlockedIncompleteKeysRef.current.add(incompleteRequestKey)
              const retryTimeout = setTimeout(() => {
                previewRetryTimeoutsRef.current.delete(retryTimeout)
                if (sessionGenerationRef.current !== requestSessionGeneration) return
                previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
                setPreviewRefreshNonce(value => value + 1)
              }, 3000)
              previewRetryTimeoutsRef.current.add(retryTimeout)
            }
          } else {
            previewIncompleteRetryRef.current = { key: '', count: 0 }
            previewBlockedIncompleteKeysRef.current.clear()
            previewRetryTimeoutsRef.current.forEach(clearTimeout)
            previewRetryTimeoutsRef.current.clear()
          }
          if (__DEV__) console.log('[NextRoundSuggesterV2] browser telemetry', getNextRoundTelemetry(sessionId).stageDurationsMs)
          if (__DEV__) console.log('[NextRoundSuggesterV2] preview fetch done', {
            totalMs: Math.round(nowMs() - previewT0),
            matchCount: matches.length,
            fetchedMatchCount: fetchedMatches.length,
            retainedPreviewCount: retainedMatches.length,
          })
        })
        .catch(err => {
          if (!isCurrentPreviewRequest()) return
          setIsSuggestingPreview(false)
          previewBlockedIncompleteKeysRef.current.delete(incompleteRequestKey)
          const retryTimeout = setTimeout(() => {
            previewRetryTimeoutsRef.current.delete(retryTimeout)
            if (sessionGenerationRef.current !== requestSessionGeneration) return
            setPreviewRefreshNonce(value => value + 1)
          }, 1000)
          previewRetryTimeoutsRef.current.add(retryTimeout)
          setEdgeDebug(`ERROR: ${err.message || 'Unknown error'}`)
          console.warn('[NextRoundSuggesterV2] Live preview fetch failed', err)
          Alert.alert('Lỗi gợi ý trận đấu', err.message || 'Không thể lấy gợi ý trận đấu từ server')
        })
        .finally(() => {
          const requestBecameStale = !isCurrentPreviewRequest()
            && sessionGenerationRef.current === requestSessionGeneration
          previewPendingRequestKeysRef.current.delete(incompleteRequestKey)
          if (previewRequestInFlightSerialRef.current === requestSerial) {
            previewRequestInFlightRef.current = false
            previewRequestInFlightSerialRef.current = null
          }
          if (isCurrentPreviewRequest()) setIsSuggestingPreview(false)
          if (requestBecameStale) setPreviewRefreshNonce(value => value + 1)
        })
    }, 80)

    return () => {
      if (!requestStarted) {
        cancelledBeforeStart = true
        clearTimeout(timer)
        previewPendingRequestKeysRef.current.delete(incompleteRequestKey)
      }
      if (!requestStarted && isCurrentPreviewRequest()) {
        previewRequestInFlightRef.current = false
        previewRequestInFlightSerialRef.current = null
        setIsSuggestingPreview(false)
      } else if (requestStarted && isCurrentPreviewRequest()) {
        previewRequestSerialRef.current += 1
        previewRequestInFlightRef.current = false
        previewRequestInFlightSerialRef.current = null
        setIsSuggestingPreview(false)
      }
    }
  }, [activeLiveMatches, completedLiveMatchCommitNonce, effectiveLiveMatchRows, getCurrentPreviewBoardForEdge, getReusableSuggestedLaneMatches, isPreviewInvalidatedByCompletedMatch, phase, previewRequestKey, pvnaTolerance, queueCourtCount, rows.playerRows.length, settingsHydrated, state, suggestedQueueCount, startedPreviewIds, startingPreviewIds])
  const liveLogicalRoundByMatchId = useMemo(
    () => buildLogicalRoundDisplayMap([...completedLiveMatches, ...activeLiveMatches], queueCourtCount),
    [activeLiveMatches, completedLiveMatches, queueCourtCount],
  )
  const heroRoundNo = useMemo(() => {
    if (activeRound) return activeRound.round_no
    const displayedRoundNos = [
      ...activeLiveMatches.map(match => liveLogicalRoundByMatchId.get(match.id) ?? ((match.round_no ?? 0) + 1)),
      ...suggestedLiveMatches.map(match => (match.round_no ?? 0) + 1),
    ].filter(roundNo => Number.isFinite(roundNo) && roundNo > 0)
    if (displayedRoundNos.length > 0) return Math.max(...displayedRoundNos)
    if (activeLiveMatches.length > 0) {
      return Math.min(
        ...activeLiveMatches.map(match => liveLogicalRoundByMatchId.get(match.id) ?? ((match.round_no ?? 0) + 1)),
      )
    }
    if (suggestedLiveMatches.length > 0) {
      return Math.min(...suggestedLiveMatches.map(match => (match.round_no ?? 0) + 1))
    }
    const countableLiveMatches = effectiveLiveMatchRows.filter(match => match.status !== 'cancelled').length
    return Math.floor(countableLiveMatches / queueCourtCount) + 1
  }, [activeLiveMatches, activeRound, effectiveLiveMatchRows, liveLogicalRoundByMatchId, queueCourtCount, suggestedLiveMatches])
  const liveCompletedRoundCount = useMemo(() => {
    const countableLiveMatches = effectiveLiveMatchRows
      .filter(match => match.status !== 'cancelled')
      .length
    const completedByLiveMatches = countableLiveMatches === 0
      ? completedRoundCount
      : Math.floor(countableLiveMatches / queueCourtCount)
    return Math.max(completedRoundCount, completedByLiveMatches)
  }, [completedRoundCount, effectiveLiveMatchRows, queueCourtCount])
  const heroPlayerCount = phase === 'active' ? activePlayerCount : plannedPlayerCount
  const { rosterTotalCount, checkedOutCount, requestedRestCount } = useMemo(() => ({
    rosterTotalCount: rows.playerRows.length,
    checkedOutCount: rows.playerRows.filter(row => Boolean(row.checked_out_at)).length,
    requestedRestCount: rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length,
  }), [rows.playerRows])
  const planningInProgress = phase === 'plan' && (!settingsHydrated || (!USE_COURT_LANE_BOARD && !workingAlternative)) && (
    !settingsHydrated
    || suggestionIsUpdating
    || busy === 'sync'
    || (rows.playerRows.length === 0 && checkedInPlayers.length > 0 && !autoSyncAttemptedRef.current)
  )
  const liveBoardRenderKey = useMemo(() => {
    if (!isWeb) return 'live-board'
    const liveKey = activeLiveMatches
      .map(match => `${(match as LiveDisplayMatchRow).client_preview_id ?? match.id}:${match.status}:${match.sequence_no ?? ''}`)
      .join(',')
    const suggestedKey = suggestedLiveMatches
      .map(match => `${match.id}:${match.status}:${match.sequence_no ?? ''}`)
      .join(',')
    return [
      rows.liveStateVersion ?? 'noversion',
      liveKey,
      suggestedKey,
    ].join('|')
  }, [activeLiveMatches, isWeb, rows.liveStateVersion, suggestedLiveMatches])
  const lateArrivalPlayers = useMemo(() => {
    const livePlayerIds = new Set(rows.playerRows.map(row => String(row.player_id)))
    return rosterPlayers.filter(player => {
      const playerId = String(player.id)
      if (player.status && player.status !== 'confirmed') return false
      const status = player.checkInStatus
      return (status === 'pending' || status === 'no_show') && (!livePlayerIds.has(playerId) || busy === `late-${playerId}`)
    })
  }, [busy, rows.playerRows, rosterPlayers])

  const navbarRightSlot = <NavbarRightActions onRefresh={loadLiveState} refreshing={refreshing} />

  if (loading) {
    return (
      <View
        testID="nrv2-screen"
        style={{
          flex: 1,
          minHeight: 0,
          backgroundColor: theme.background,
          ...(isWeb
            ? {
                minHeight: webViewportHeight ?? 0,
                overflow: 'visible',
              }
            : null),
        }}
      >
        <SecondaryNavbar title="QUẢN LÝ TRẬN ĐẤU" rightSlot={navbarRightSlot} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </View>
    )
  }

  return (
    <View
      testID="nrv2-screen"
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.background,
        ...(isWeb
          ? {
              minHeight: webViewportHeight ?? 0,
              overflow: 'visible',
            }
          : null),
      }}
    >
      <SecondaryNavbar title={phase === 'recap' ? 'BÁO CÁO TRẬN ĐẤU' : 'QUẢN LÝ TRẬN ĐẤU'} rightSlot={navbarRightSlot} />
      {phase === 'recap' ? (
        <RecapViewModule
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          groupSummaries={groupSummaries}
          playersById={playersById}
          liveMatchRows={rows.liveMatchRows}
          onOpenHistory={() => setSheet('history')}
          onContinue={() => setShowSessionReport(false)}
          hideContinue={initialShowReport}
        />
      ) : (
        <ScrollView
          style={{
            ...(isWeb
              ? {
                  flexGrow: 0,
                  flexShrink: 0,
                  overflow: 'visible',
                  overflowY: 'visible',
                  overflowAnchor: 'none',
                  touchAction: 'pan-y',
                  willChange: 'transform',
                  transform: [{ translateZ: 0 }],
                } as any
              : {
                  flex: 1,
                  minHeight: 0,
                }),
          }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={scrollDebugEnabled ? 100 : undefined}
          onLayout={scrollDebugEnabled ? (event) => {
            updateScrollDebugMetrics({ layoutHeight: Math.round(event.nativeEvent.layout.height) })
          } : undefined}
          onContentSizeChange={scrollDebugEnabled ? (_width, height) => {
            updateScrollDebugMetrics({ contentHeight: Math.round(height) })
          } : undefined}
          onScroll={scrollDebugEnabled ? (event) => {
            const nativeEvent = event.nativeEvent
            updateScrollDebugMetrics({
              scrollY: Math.round(nativeEvent.contentOffset.y),
              layoutHeight: Math.round(nativeEvent.layoutMeasurement.height),
              contentHeight: Math.round(nativeEvent.contentSize.height),
            })
          } : undefined}
          contentContainerStyle={{
            flexGrow: 1,
            padding: SPACING.xl,
            paddingBottom: 126 + insets.bottom,
            ...(isWeb ? { minHeight: webViewportHeight ?? 0 } : null),
          }}
        >
          <SessionDashboardCard
            phase={phase}
            roundNo={heroRoundNo}
            presentCount={heroPlayerCount}
            rosterTotalCount={rosterTotalCount}
            checkedOutCount={checkedOutCount}
            requestedRestCount={requestedRestCount}
            lateCount={lateArrivalPlayers.length}
            groupSummaries={groupSummaries}
            playersById={playersById}
            courtCount={courtCount}
            roundPace={15}
            pvnaTolerance={pvnaTolerance}
            sessionDuration={courtDurationMin}
            fairnessScore={fairnessScore}
            completedRounds={liveCompletedRoundCount}
            targetRounds={effectiveTargetRounds}
            onOpenRoster={openRoster}
            onFairnessPress={() => setSheet('fairness')}
            onSettingsPress={() => setSheet('settings')}
            onLatePress={() => setSheet('late-arrivals')}
          />

          {phase === 'plan' && (
            <>
              {reportReady && !activeRound ? (
                <Card style={{ marginTop: 14, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.primary }}>
                    Đã đủ số vòng mục tiêu
                  </Text>
                  <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
                    Có thể xem report hoặc tạo thêm trận nếu buổi chơi vẫn tiếp tục.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowSessionReport(true)}
                    style={{ marginTop: 12, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={ctaTextStyle(theme.onPrimary, 12)}>Xem report</Text>
                  </TouchableOpacity>
                </Card>
              ) : null}
              <LiveMatchBoardComponent
                liveMatches={activeLiveMatches}
                suggestedMatches={suggestedLiveMatches}
                completedMatches={completedLiveMatches}
                roundSize={queueCourtCount}
                targetRounds={effectiveTargetRounds}
                roundPace={15}
                busy={busy}
                startingPreviewIds={startingPreviewIds}
                endingLiveMatchIds={endingLiveMatchIds}
                completingMatchIds={completingLiveMatchIds}
                creatingNextMatchIds={creatingNextMatchIds}
                isSuggestingPreview={isSuggestingPreview}
                state={state}
                pvnaTolerance={pvnaTolerance}
                playersById={playersById}
                onStartMatch={startLiveMatch}
                onCompleteMatch={completeLiveMatch}
                onCancelMatch={cancelLiveMatch}
                onPlayerPress={openSwapForPlayer}
                onOpenSettings={() => setSheet('settings')}
                onOpenSwap={(match) => { setSuggestedSwapMatch(match); setSwapFromPlayerId(null); setSheet('swap') }}
              />
              {planningInProgress || (!USE_COURT_LANE_BOARD && isSuggestingPreview) ? (
                <PlanningRoundCard syncingRoster={busy === 'sync' || isSuggestingPreview} />
              ) : !USE_COURT_LANE_BOARD && suggestedLiveMatches.length === 0 && activeLiveMatches.length === 0 && nextMatchSuggestion ? (
                <EmptyPlanCard
                  state={state}
                  suggestion={nextMatchSuggestion}
                  courtCount={1}
                  tierOverrides={fairnessAdjustment.tier_overrides}
                  onSetCourtCount={setCourtCount}
                  onOpenSettings={() => setSheet('settings')}
                  onSyncRoster={syncRoster}
                  busy={busy === 'sync'}
                />
              ) : null}
            </>
          )}

          {phase === 'active' && activeRound && (
            <>
              <MatchList
                title={`${activeRound.matches.length} trận đang diễn ra`}
                matches={activeRound.matches}
                state={state}
                playersById={playersById}
                onPlayerPress={openSwapForPlayer}
              />
              <RestingRow resting={activeRound.resting} playersById={playersById} />
            </>
          )}

          {selectionUndo && (
            <TouchableOpacity
              onPress={undoRoundSelection}
              style={{
                marginTop: 12,
                height: 44,
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: theme.outlineVariant,
                backgroundColor: theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={ctaTextStyle(theme.primary, 13)}>Hoàn tác đánh đổi: {selectionUndo.reason}</Text>
            </TouchableOpacity>
          )}

          {error ? (
            <View testID="nrv2-error-banner" style={{ marginTop: 12, backgroundColor: theme.dangerBg, borderRadius: RADIUS.md, padding: 12, borderWidth: BORDER.hairline, borderColor: theme.dangerText }}>
              <Text style={{ fontFamily: SCREEN_FONTS.body, color: theme.dangerText, fontSize: 12 }}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {scrollDebugEnabled ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8 + insets.bottom,
            zIndex: 9999,
            borderRadius: RADIUS.sm,
            backgroundColor: 'rgba(0,0,0,0.72)',
            paddingHorizontal: 8,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            vh {scrollDebugMetrics.viewportHeight ?? '-'} / vv {scrollDebugMetrics.visualViewportHeight ?? '-'} / in {scrollDebugMetrics.innerHeight ?? '-'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            layout {scrollDebugMetrics.layoutHeight ?? '-'} / content {scrollDebugMetrics.contentHeight ?? '-'}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, lineHeight: 13, color: '#fff' }}>
            y {scrollDebugMetrics.scrollY} / bottom {scrollDebugMetrics.distanceToBottom ?? '-'}
          </Text>
        </View>
      ) : null}

      {phase !== 'recap' && phase === 'active' && (
        <StickyRoundCta
          busy={busy}
          primaryLabel={phase === 'active' ? 'Kết thúc & lưu vòng' : reportReady ? 'Tạo thêm trận' : completedLiveMatches.length === 0 ? 'Tạo các trận đầu tiên' : 'Tạo trận kế tiếp'}
          onPrimary={() => {
            if (phase === 'active') void endActiveRound()
            else return
          }}
          disabled={false}
          computing={false}
          onMore={() => setSheet('more')}
        />
      )}

      <NextRoundSheet visible={sheet === 'settings'} snap="88" onClose={() => setSheet(null)}>
        {sheet === 'settings' ? (
          <SettingsSheet
            playerCount={calculatorPlayerCount}
            initial={{ courtCount, courtPreset, pvnaTolerance, courtDurationMin, targetRounds: effectiveTargetRounds }}
            onApply={(s) => {
              setCourtCount(s.courtCount)
              setCourtPreset(s.courtPreset)
              setPvnaTolerance(s.pvnaTolerance)
              setCourtDurationMin(s.courtDurationMin)
              setTargetRounds(s.targetRounds)
              setSheet(null)
            }}
          />
        ) : null}
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'fairness'} snap="88" onClose={() => setSheet(null)}>
        <FairnessSheet
          score={fairnessScore}
          state={state}
          warnings={fairnessWarnings}
          latestAudit={fairnessAudit}
          groupSummaries={groupSummaries}
          playersById={playersById}
        />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'preview'} snap="88" onClose={() => setSheet(null)}>
        <FairnessPreviewSheet preview={fairnessPreview} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'swap'} snap="88" onClose={() => {
        setSuggestedSwapMatch(null)
        setSheet(null)
      }}>
        {suggestedSwapMatch ? (
          <SuggestedLiveMatchSwapSheet
            match={suggestedSwapMatch}
            state={state}
            playersById={playersById}
            swapFromPlayerId={swapFromPlayerId}
            setSwapFromPlayerId={setSwapFromPlayerId}
            onSwap={swapPlayersInSuggestedLiveMatch}
          />
        ) : (
          <SwapSheetView
            state={state}
            alternative={workingAlternative}
            playersById={playersById}
            swapFromPlayerId={swapFromPlayerId}
            setSwapFromPlayerId={setSwapFromPlayerId}
            onSwap={swapPlayersInWorkingAlternative}
          />
        )}
      </NextRoundSheet>


<NextRoundSheet visible={sheet === 'history'} snap="88" onClose={() => setSheet(null)}>
        <HistorySheetView rounds={completedRounds} playersById={playersById} />
      </NextRoundSheet>

      <NextRoundSheet visible={sheet === 'late-arrivals'} snap="50" onClose={() => setSheet(null)}>
        <LateArrivalsSheetView players={lateArrivalPlayers} busy={busy} onAddPlayer={playerId => { void addLateArrivalToRoster(playerId) }} />
      </NextRoundSheet>

<NextRoundSheet visible={sheet === 'more'} snap="50" onClose={() => setSheet(null)}>
        <MoreSheetView
          onSyncRoster={syncRoster}
          onOpenRoster={openRoster}
          onOpenReport={() => {
            setSheet(null)
            setShowSessionReport(true)
          }}
          onOpenHistory={() => setSheet('history')}
          onOpenFairness={() => setSheet('fairness')}
          canOpenReport={reportReady && !activeRound}
          busy={busy}
        />
      </NextRoundSheet>
    </View>
  )
}

function swapPlayersInSuggestedMatch(match: SuggestedLiveMatchRow, fromId: string, toId: string): SuggestedLiveMatchRow {
  const replaceInTeam = (team: string[]) => team.map(playerId => {
    if (playerId === fromId) return toId
    if (playerId === toId) return fromId
    return playerId
  }) as [string, string]

  const teamA = replaceInTeam(match.team_a)
  const teamB = replaceInTeam(match.team_b)
  const toWasResting = (match.resting ?? []).includes(toId)
  const restingBase = toWasResting
    ? [...(match.resting ?? []).filter(playerId => playerId !== toId), fromId]
    : (match.resting ?? [])
  const playingAfter = new Set([...teamA, ...teamB])
  const resting = [...new Set(restingBase)].filter(playerId => !playingAfter.has(playerId))

  return {
    ...match,
    team_a: teamA,
    team_b: teamB,
    resting,
  }
}

function buildSuggestedSwapImpact(match: SuggestedLiveMatchRow, fromId: string, toId: string, state: SessionState) {
  const beforePvnaDiff = Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state))
  const beforeRepeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
  const afterMatch = swapPlayersInSuggestedMatch(match, fromId, toId)
  const afterPvnaDiff = Math.abs(getTeamPvna(afterMatch.team_a, state) - getTeamPvna(afterMatch.team_b, state))
  const afterRepeat = getProjectedRepeatSummary(afterMatch.team_a, afterMatch.team_b, state)
  const beforeRepeatOver = beforeRepeat.pair_over_by + beforeRepeat.player_over_by
  const afterRepeatOver = afterRepeat.pair_over_by + afterRepeat.player_over_by
  const pvnaDelta = afterPvnaDiff - beforePvnaDiff
  const repeatDelta = afterRepeatOver - beforeRepeatOver
  const qualityDelta = -pvnaDelta - repeatDelta * 0.35
  const label = qualityDelta > 0.08
    ? 'Tốt hơn'
    : qualityDelta < -0.08
      ? 'Giảm chất lượng'
      : 'Ít đổi'

  return {
    label,
    qualityDelta,
    beforePvnaDiff,
    afterPvnaDiff,
    beforeRepeatOver,
    afterRepeatOver,
    beforePartnerMax: beforeRepeat.max_partner_pair_count,
    afterPartnerMax: afterRepeat.max_partner_pair_count,
    beforeOpponentMax: beforeRepeat.max_opponent_pair_count,
    afterOpponentMax: afterRepeat.max_opponent_pair_count,
  }
}

function describeSuggestedMatchRepeats(
  match: SuggestedLiveMatchRow,
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
) {
  const lines: string[] = []
  for (const team of [match.team_a, match.team_b]) {
    const count = (state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0) + 1
    if (count >= 2) {
      lines.push(`${playerName(team[0], playersById)} và ${playerName(team[1], playersById)} làm đồng đội lần thứ ${count}`)
    }
  }

  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      const count = (state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0) + 1
      if (count >= 2) {
        lines.push(`${playerName(playerA, playersById)} gặp lại ${playerName(playerB, playersById)} lần thứ ${count}`)
      }
    }
  }

  if (lines.length === 0) return 'Không lặp lại đối thủ/đồng đội.'
  return lines.slice(0, 4).join('; ') + (lines.length > 4 ? `; +${lines.length - 4} lặp khác` : '.')
}

function SuggestedLiveMatchSwapSheet({
  match,
  state,
  playersById,
  swapFromPlayerId,
  setSwapFromPlayerId,
  onSwap,
}: {
  match: SuggestedLiveMatchRow
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  swapFromPlayerId: string | null
  setSwapFromPlayerId: (playerId: string) => void
  onSwap: (fromId: string, toId: string) => void
}) {
  const theme = useAppTheme()
  const playingIds = [...match.team_a, ...match.team_b]
  const targetIds = [...new Set([...playingIds, ...(match.resting ?? [])])]
  const candidates = swapFromPlayerId
    ? targetIds
        .filter(playerId => playerId !== swapFromPlayerId)
        .map(playerId => ({
          playerId,
          impact: buildSuggestedSwapImpact(match, swapFromPlayerId, playerId, state),
        }))
        .sort((left, right) => {
          const qualityDiff = right.impact.qualityDelta - left.impact.qualityDelta
          if (Math.abs(qualityDiff) > 0.001) return qualityDiff
          const repeatDiff = left.impact.afterRepeatOver - right.impact.afterRepeatOver
          if (repeatDiff !== 0) return repeatDiff
          const pvnaDiff = left.impact.afterPvnaDiff - right.impact.afterPvnaDiff
          if (Math.abs(pvnaDiff) > 0.001) return pvnaDiff
          const leftPlaying = playingIds.includes(left.playerId)
          const rightPlaying = playingIds.includes(right.playerId)
          if (leftPlaying !== rightPlaying) return leftPlaying ? 1 : -1
          return playerName(left.playerId, playersById).localeCompare(playerName(right.playerId, playersById))
        })
    : []

  return (
    <View>
      <SheetTitle title="Đổi người trận gợi ý" subtitle={`Sân ${(match.court_idx ?? 0) + 1}: đổi trực tiếp trong suggested live match đang chọn.`} />
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>1. Đổi ra</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {playingIds.map(playerId => {
          const active = swapFromPlayerId === playerId
          return (
            <TouchableOpacity
              key={playerId}
              onPress={() => setSwapFromPlayerId(playerId)}
              style={{
                height: 44,
                borderRadius: RADIUS.full,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                paddingHorizontal: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <PlayerAvatar name={playerName(playerId, playersById)} size={24} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: active ? theme.onPrimary : theme.onSurface }}>
                {playerName(playerId, playersById)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {swapFromPlayerId ? (
        <>
          <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>2. Đổi với</Text>
          <View style={{ gap: 8 }}>
            {candidates.map(({ playerId, impact }) => {
              const impactColor = impact.label === 'Tốt hơn'
                ? theme.primary
                : impact.label === 'Giảm chất lượng'
                  ? theme.dangerText
                  : theme.outline
              const pvnaText = `${impact.beforePvnaDiff.toFixed(2)} -> ${impact.afterPvnaDiff.toFixed(2)}`
              const repeatText = describeSuggestedMatchRepeats(
                swapPlayersInSuggestedMatch(match, swapFromPlayerId, playerId),
                state,
                playersById,
              )
              return (
                <TouchableOpacity
                  key={playerId}
                  onPress={() => onSwap(swapFromPlayerId, playerId)}
                  style={{
                    minHeight: 58,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.surface,
                    borderWidth: BORDER.hairline,
                    borderColor: theme.outlineVariant,
                    borderLeftWidth: 4,
                    borderLeftColor: impactColor,
                    padding: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <PlayerAvatar name={playerName(playerId, playersById)} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline, fontWeight: '900' }}>
                        PVNA {(state.players.get(playerId)?.pvna ?? 0).toFixed(2)}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.label, fontSize: 11, color: impactColor, fontWeight: '900' }}>
                      {impact.label} · chênh PVNA {pvnaText}
                    </Text>
                    <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, lineHeight: 14, color: theme.outline }}>
                      {repeatText}
                    </Text>
                  </View>
                  <Text style={ctaTextStyle(impactColor, 12)}>
                    Đổi
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      ) : null}
    </View>
  )
}
