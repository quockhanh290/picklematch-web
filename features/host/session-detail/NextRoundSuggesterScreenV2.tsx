import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Dimensions, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
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
import { BORDER, RADIUS, SHADOW as LAYOUT_SHADOW, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { calculateOptimalCourts, PRESETS, type CourtOption, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
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
import { Card, NextRoundSheet, PlayerAvatar, SheetTitle } from './next-round-v2/components'
import { COURT_DURATION_OPTIONS, COURT_PRESET_OPTIONS, PVNA_TOLERANCE_OPTIONS } from './next-round-v2/constants'
import { ChoiceRow, NavbarRightActions, StickyRoundCta } from './next-round-v2/controls'
import {
  BreakdownRow,
  GroupAuditBlock,
  HistorySheet as HistorySheetView,
  LateArrivalsSheet as LateArrivalsSheetView,
  MoreSheet as MoreSheetView,
  RecapView as RecapViewModule,
  RepeatDetailsBlock,
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
import { refreshBus } from './next-round-v2/refreshBus'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const LIVE_SCORE_CARD_WIDTH = SCREEN_WIDTH > 400 ? 90 : SCREEN_WIDTH > 360 ? 80 : 72
const LIVE_SCORE_CARD_HEIGHT = LIVE_SCORE_CARD_WIDTH * 1.25
const LIVE_SCORE_FONT_SIZE = SCREEN_WIDTH > 400 ? 56 : SCREEN_WIDTH > 360 ? 48 : 42
const LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 4
const BALANCED_PVNA_COST_WEIGHT = 10
const BALANCED_REPEAT_COST_WEIGHT = 3
const BALANCED_AFFECTED_PLAYER_COST_WEIGHT = 1

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

function autoPvnaReasonDetails(
  warningTypes: string[],
  warnings: FairnessWarning[],
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
) {
  const warningTypeSet = new Set(warningTypes)
  return warnings
    .filter(warning => warningTypeSet.has(warning.type))
    .flatMap(warning => {
      const lines = [warning.message]
      if (warning.type === 'rest_violation' && warning.affected_players.length > 0) {
        const players = warning.affected_players.slice(0, 6).map(playerId => {
          const consecutiveRest = state.players.get(playerId)?.consecutive_rest ?? 0
          return `${playerName(playerId, playersById)} ${consecutiveRest} vòng`
        })
        const hiddenCount = Math.max(0, warning.affected_players.length - players.length)
        lines.push(`Đang ưu tiên kéo vào sân: ${players.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} người` : ''}.`)
      } else if (warning.affected_players.length > 0) {
        const players = warning.affected_players.slice(0, 6).map(playerId => playerName(playerId, playersById))
        const hiddenCount = Math.max(0, warning.affected_players.length - players.length)
        lines.push(`Ảnh hưởng: ${players.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} người` : ''}.`)
      }
      lines.push(warning.suggested_action)
      return lines
    })
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .slice(0, 4)
}

function warningTone(theme: ReturnType<typeof useAppTheme>, severity: FairnessWarning['severity'] | 'ok') {
  if (severity === 'critical') return { bg: theme.dangerBg, border: theme.dangerText, text: theme.dangerText }
  if (severity === 'warning') return { bg: theme.warningBg, border: theme.warningStrong, text: theme.warningText }
  if (severity === 'info') return { bg: theme.infoBg, border: theme.outlineVariant, text: theme.infoText }
  return { bg: theme.successBg, border: theme.secondaryContainer, text: theme.successText }
}

function toUserSafeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  
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

function buildPreviewBatchKey(
  sessionId: string,
  state: SessionState,
  courtCount: number,
  pvnaTolerance: number,
  fairnessAdjustment: { tier_overrides: Record<string, Tier>; applied_for_warnings: unknown[] },
) {
  const playersKey = [...state.players.values()]
    .map(player => {
      const partnerKey = [...player.partner_counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, count]) => `${playerId}:${count}`)
        .join(',')
      const opponentKey = [...player.opponent_counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, count]) => `${playerId}:${count}`)
        .join(',')
      return [
        player.player_id,
        player.pvna,
        player.group_id ?? '',
        player.checked_out_at ? 'out' : 'in',
        player.opted_rest ? 'rest' : 'play',
        player.matches_played,
        player.last_played_round,
        player.consecutive_rest,
        player.consecutive_play,
        player.gender ?? '',
        player.partner_gender_pref,
        player.opponent_gender_pref,
        partnerKey,
        opponentKey,
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
    state.current_round,
    courtCount,
    pvnaTolerance,
    state.config.pvna_tolerance,
    JSON.stringify(state.config.weights),
    fairnessAdjustment.applied_for_warnings.map(String).sort().join(','),
    tierKey,
    playersKey,
  ].join('||')
}

function getAlternativePvnaGap(alternative: SuggestionAlternative) {
  return Math.max(
    0,
    ...alternative.matches.map(match => match.stats?.pvna_diff ?? 0),
    alternative.stats?.pvna_diff ?? 0,
  )
}

function getAlternativeRepeatMetrics(alternative: SuggestionAlternative, state: SessionState) {
  return alternative.matches.reduce((summary, match) => {
    const repeat = getProjectedRepeatSummary(match.team_a, match.team_b, state)
    return {
      repeat_over_by: summary.repeat_over_by + repeat.pair_over_by + repeat.player_over_by,
      affected_pairs: summary.affected_pairs + repeat.affected_pairs,
      affected_players: summary.affected_players + repeat.affected_players,
      max_partner_pair: Math.max(summary.max_partner_pair, repeat.max_partner_pair_count),
      max_opponent_pair: Math.max(summary.max_opponent_pair, repeat.max_opponent_pair_count),
    }
  }, {
    repeat_over_by: 0,
    affected_pairs: 0,
    affected_players: 0,
    max_partner_pair: 0,
    max_opponent_pair: 0,
  })
}

function getTradeoffChoiceMetrics(
  alternative: SuggestionAlternative,
  state: SessionState,
  configuredPvnaTolerance: number,
): SuggestionTradeoffChoice['metrics'] {
  const pvnaGap = getAlternativePvnaGap(alternative)
  const repeat = getAlternativeRepeatMetrics(alternative, state)
  const pvnaOverBy = Math.max(0, pvnaGap - configuredPvnaTolerance)
  return {
    pvna_gap: pvnaGap,
    pvna_over_by: pvnaOverBy,
    repeat_over_by: repeat.repeat_over_by,
    affected_pairs: repeat.affected_pairs,
    affected_players: repeat.affected_players,
    max_partner_pair: repeat.max_partner_pair,
    max_opponent_pair: repeat.max_opponent_pair,
    total_cost:
      pvnaOverBy * BALANCED_PVNA_COST_WEIGHT +
      repeat.repeat_over_by * BALANCED_REPEAT_COST_WEIGHT +
      repeat.affected_players * BALANCED_AFFECTED_PLAYER_COST_WEIGHT,
  }
}

function compareByNumber(left: number, right: number) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareChoiceMetrics(
  left: SuggestionTradeoffChoice['metrics'],
  right: SuggestionTradeoffChoice['metrics'],
  fields: Array<keyof SuggestionTradeoffChoice['metrics']>,
) {
  for (const field of fields) {
    const diff = compareByNumber(left[field], right[field])
    if (diff !== 0) return diff
  }
  return 0
}

function buildTradeoffChoiceExplanation(
  id: SuggestionTradeoffChoiceId,
  metrics: SuggestionTradeoffChoice['metrics'],
  configuredPvnaTolerance: number,
) {
  const lines: string[] = [
    `PVNA ${formatNumber(metrics.pvna_gap, 2)} / cap ${formatNumber(configuredPvnaTolerance, 2)}`,
  ]
  if (metrics.pvna_over_by > 0) {
    lines.push(`Vượt PVNA +${formatNumber(metrics.pvna_over_by, 2)}`)
  }
  if (metrics.repeat_over_by > 0) {
    lines.push(`Lặp vượt cap ${metrics.repeat_over_by} điểm trên ${metrics.affected_pairs} cặp`)
  } else {
    lines.push('Không vượt cap lặp')
  }
  if (metrics.max_partner_pair > 0 || metrics.max_opponent_pair > 0) {
    lines.push(`Nặng nhất: partner ${metrics.max_partner_pair} lần, đối thủ ${metrics.max_opponent_pair} lần`)
  }
  if (id === 'balanced') {
    lines.push(`Tổng trade-off ${formatNumber(metrics.total_cost, 1)}`)
  }
  return lines
}

function buildLiveTradeoffChoices(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  configuredPvnaTolerance: number,
): { choices: SuggestionTradeoffChoice[]; recommended: SuggestionTradeoffChoiceId } | null {
  const candidates = alternatives
    .filter(alternative => alternative.matches.length > 0)
    .map(alternative => ({
      alternative,
      metrics: getTradeoffChoiceMetrics(alternative, state, configuredPvnaTolerance),
    }))
  if (candidates.length < 2) return null

  const hasMeaningfulTradeoff = candidates.some(({ metrics }) =>
    metrics.pvna_over_by > 0 || metrics.repeat_over_by > 0,
  )
  if (!hasMeaningfulTradeoff) return null

  const pickBest = (
    fields: Array<keyof SuggestionTradeoffChoice['metrics']>,
  ) => [...candidates].sort((left, right) => {
    const metricDiff = compareChoiceMetrics(left.metrics, right.metrics, fields)
    if (metricDiff !== 0) return metricDiff
    return left.alternative.score - right.alternative.score
  })[0]

  const picked = [
    {
      id: 'balanced' as const,
      label: 'Cân bằng',
      item: pickBest(['total_cost', 'pvna_over_by', 'repeat_over_by']),
    },
    {
      id: 'keep_pvna' as const,
      label: 'Giữ PVNA',
      item: pickBest(['pvna_over_by', 'pvna_gap', 'repeat_over_by']),
    },
    {
      id: 'reduce_repeat' as const,
      label: 'Giảm lặp',
      item: pickBest(['repeat_over_by', 'affected_pairs', 'max_opponent_pair', 'max_partner_pair', 'pvna_over_by']),
    },
  ]

  const seen = new Set<string>()
  const choices = picked.flatMap(({ id, label, item }) => {
    const matchKey = item.alternative.matches
      .map(match => `${match.team_a.join(':')}|${match.team_b.join(':')}`)
      .join(';')
    if (seen.has(matchKey)) return []
    seen.add(matchKey)
    return [{
      id,
      label,
      alternative: item.alternative,
      metrics: item.metrics,
      explanation: buildTradeoffChoiceExplanation(id, item.metrics, configuredPvnaTolerance),
    }]
  })

  if (choices.length < 2) return null
  if (!choices.some(choice => choice.metrics.pvna_over_by > 0 || choice.metrics.repeat_over_by > 0)) {
    return null
  }
  return {
    choices,
    recommended: choices.some(choice => choice.id === 'balanced') ? 'balanced' : choices[0].id,
  }
}

export function NextRoundSuggesterScreenV2({ sessionId, players, courts, bootstrapTelemetry = null }: NextRoundSuggesterV2Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isFirstFocusRef = useRef(true)
  const [busy, setBusy] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)
  const autoSyncAttemptedRef = useRef(false)
  const autoRepairStateAttemptedRef = useRef(false)
  const completingCleanupTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const completingMatchExpectedPlayedRef = useRef(new Map<string, { playerIds: string[]; expectedPlayed: number }>())
  const lateArrivalInFlightRef = useRef(new Set<string>())
  const reconcileTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const liveMatchMutationQueueRef = useRef(Promise.resolve())
  const suggestedPreviewBatchRef = useRef<SuggestedPreviewBatch | null>(null)
  const previewBatchKeyRef = useRef<string | null>(null)
  const model = useNextRoundModel({ sessionId, players, courts })
  const [liveScores, setLiveScores] = useState<Record<string, { a: number; b: number }>>({})
  const [optimisticLiveMatches, setOptimisticLiveMatches] = useState<LiveDisplayMatchRow[]>([])
  const [liveMatchDisplayKeys, setLiveMatchDisplayKeys] = useState<Record<string, string>>({})
  const [startingPreviewIds, setStartingPreviewIds] = useState<Set<string>>(() => new Set())
  const [startedPreviewIds, setStartedPreviewIds] = useState<Set<string>>(() => new Set())
  const [endingLiveMatchIds, setEndingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const [completingLiveMatchIds, setCompletingLiveMatchIds] = useState<Set<string>>(() => new Set())
  const {
    activeRound,
    alternativeOrder,
    alternativeAudits,
    addPlayerRow,
    applyCompletedLiveMatch,
    applyEndedRound,
    applyLiveMatches,
    applyLiveStateVersion,
    applyStartedRound,
    applySuggestedRoundAction,
    checkedInPlayers,
    clearPlayerRow,
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
    settlePlayerRow,
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

  const lastBusRefreshRef = useRef(0)
  const liveStateVersionRef = useRef<number | null>(rows.liveStateVersion ?? null)

  React.useEffect(() => {
    liveStateVersionRef.current = rows.liveStateVersion ?? null
  }, [rows.liveStateVersion])
  React.useEffect(() => {
    autoRepairStateAttemptedRef.current = false
    suggestedPreviewBatchRef.current = null
    previewBatchKeyRef.current = null
    setStartingPreviewIds(new Set())
    setStartedPreviewIds(new Set())
    setEndingLiveMatchIds(new Set())
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
      .then(() => loadLiveState({ silent: true }))
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
    completingCleanupTimeoutsRef.current = []
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

  React.useEffect(() => {
    const activeScores = rows.liveMatchRows
      .filter(match => match.status === 'live')
      .reduce<Record<string, { a: number; b: number }>>((acc, match) => {
        acc[match.id] = { a: match.score_a ?? 0, b: match.score_b ?? 0 }
        return acc
      }, {})
    setLiveScores(previous => {
      let changed = false
      const next = { ...previous }
      for (const [matchId, score] of Object.entries(activeScores)) {
        if (!next[matchId] || next[matchId].a !== score.a || next[matchId].b !== score.b) {
          next[matchId] = score
          changed = true
        }
      }
      for (const matchId of Object.keys(next)) {
        if (!activeScores[matchId]) {
          delete next[matchId]
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [rows.liveMatchRows])

  const scheduleReconcile = useCallback((result: ActionResult) => {
    if (!result.reconcile) return
    const delayMs = result.reconcileAfterMs ?? 600
    const expected = result.reconcile
    const timeoutId = setTimeout(() => {
      void loadLiveState({ silent: true }).then((serverRows) => {
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

  React.useEffect(() => {
    refreshBus.register(() => {
      lastBusRefreshRef.current = Date.now()
      void loadLiveState()
    })
    return () => refreshBus.unregister()
  }, [loadLiveState])

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
    addPlayerRow(optimisticRow)
    try {
      const checkinPayload = await checkInLiveSessionPlayers(sessionId, [playerId])
      applyLiveStateVersion(checkinPayload?.live_state_version)
      settlePlayerRow(playerId, optimisticRow)
      void markSessionPlayersPresent(sessionId, [playerId]).catch((error) => {
        if (__DEV__) console.warn('[NextRoundSuggesterV2] late arrival session_players status update failed', error)
      })
    } catch (err: any) {
      clearPlayerRow(playerId)
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

  const buildSuggestedMatchPayloads = useCallback((count: number, options: BuildSuggestedMatchOptions = {}) => {
    const buildT0 = nowMs()
    let suggestMs = 0
    let projectMs = 0
    let suggestionState = options.stateOverride ?? state
    const liveMatchRows = options.liveMatchRowsOverride ?? rows.liveMatchRows
    const payloads: Array<Pick<SuggestedLiveMatchRow, 'court_idx' | 'team_a' | 'team_b' | 'resting' | 'round_no' | 'preview_live_state_version' | 'preview_countable_match_count' | 'warnings' | 'tradeoffs' | 'approval_required' | 'configured_pvna_tolerance' | 'effective_pvna_tolerance' | 'fairness_reasons' | 'fairness_reason_details' | 'tradeoff_choices' | 'recommended_tradeoff_choice'>> = []
    const baseBusyIds = new Set(
      liveMatchRows
        .filter(match =>
          match.status === 'live'
          || match.status === 'suggested'
          || completingLiveMatchIds.has(match.id),
        )
        .flatMap(match => [...match.team_a, ...match.team_b]),
    )
    const liveCourtIdxs = new Set(
      liveMatchRows
        .filter(match =>
          match.status === 'live'
          && !completingLiveMatchIds.has(match.id)
          && match.court_idx !== null
          && match.court_idx !== undefined,
        )
        .map(match => Number(match.court_idx)),
    )
    const courtCapacity = Math.max(1, Math.floor(suggestionState.config.courts || courtCount || 1))
    const roundCounts = new Map<number, number>()
    const courtIdxsByRound = new Map<number, Set<number>>()
    const countableMatches = liveMatchRows
      .filter(match => match.status !== 'cancelled')
      .sort((left, right) => left.sequence_no - right.sequence_no)
    const previewCountableMatchCount = countableMatches.length
    const logicalRoundByMatchId = new Map<string, number>()
    countableMatches.forEach((match, matchIndex) => {
      const roundNo = Math.floor(matchIndex / courtCapacity)
      logicalRoundByMatchId.set(match.id, match.round_no ?? roundNo)
      roundCounts.set(roundNo, (roundCounts.get(roundNo) ?? 0) + 1)
      if (match.court_idx !== null && match.court_idx !== undefined) {
        const courtIdxs = courtIdxsByRound.get(roundNo) ?? new Set<number>()
        courtIdxs.add(Number(match.court_idx))
        courtIdxsByRound.set(roundNo, courtIdxs)
      }
    })
    const playerIdsByRound = new Map<number, Set<string>>()
    countableMatches.forEach((match, matchIndex) => {
      const roundNo = Math.floor(matchIndex / courtCapacity)
      const playerIds = playerIdsByRound.get(roundNo) ?? new Set<string>()
      match.team_a.forEach(playerId => playerIds.add(playerId))
      match.team_b.forEach(playerId => playerIds.add(playerId))
      playerIdsByRound.set(roundNo, playerIds)
    })
    const hasCompletedRounds = suggestionState.rounds.some(round => round.status === 'completed')
    const getRoundRequiredIds = (roundNo: number, remainingCourts: number, busyIds: Set<string>) => {
      const remainingRoundSlots = Math.max(0, remainingCourts * 4)
      if (remainingRoundSlots <= 0) return new Set<string>()
      const required = [...suggestionState.players.values()]
        .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
        .filter(player => {
          const isLateArrival = hasCompletedRounds && player.matches_played === 0
          if (isLateArrival) return player.consecutive_rest >= 2
          return player.consecutive_rest >= 1
        })
        .sort((left, right) => {
          if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
          if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
          if (left.last_played_round !== right.last_played_round) return left.last_played_round - right.last_played_round
          return left.player_id.localeCompare(right.player_id)
        })
        .map(player => player.player_id)
      if (required.length > remainingRoundSlots) {
        if (__DEV__) {
          console.log('[NextRoundSuggesterV2] rolling round required over capacity', {
            sessionId,
            roundNo,
            required: required.length,
            remainingRoundSlots,
          })
        }
        return new Set<string>()
      }
      return new Set(required)
    }
    let roundRequiredIds = new Set<string>()
    const projectedExistingMatches = countableMatches.filter(match =>
      match.status === 'live'
      || match.status === 'suggested'
      || completingLiveMatchIds.has(match.id),
    )
    for (const match of projectedExistingMatches) {
      suggestionState = buildProjectedStateAfterLiveMatch(
        suggestionState,
        match,
        logicalRoundByMatchId.get(match.id) ?? match.round_no ?? match.sequence_no,
      )
    }
    const getInitialRoundCourtIdxs = (roundNo: number) => {
      const existingRoundCourtIdxs = courtIdxsByRound.get(roundNo)
      return new Set([
        ...liveCourtIdxs,
        ...(existingRoundCourtIdxs ?? []),
      ])
    }
    const queuedCourtIdxs = new Set(liveCourtIdxs)
    let projectedRoundNo = Math.floor(countableMatches.length / courtCapacity)
    let projectedRoundMatchCount = countableMatches.length % courtCapacity
    let roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
    let roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
    roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCapacity - projectedRoundMatchCount, roundBusyIds)
    for (let index = 0; index < count; index += 1) {
      if (projectedRoundMatchCount >= courtCapacity) {
        projectedRoundNo += 1
        projectedRoundMatchCount = 0
        roundCourtIdxs = getInitialRoundCourtIdxs(projectedRoundNo)
        roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
        roundRequiredIds = getRoundRequiredIds(projectedRoundNo, courtCapacity, roundBusyIds)
      }
      const nextCourtIdx = Array.from({ length: courtCapacity }, (_, idx) => idx)
        .find(idx => !queuedCourtIdxs.has(idx) && !roundCourtIdxs.has(idx))
      const courtIdx = options.courtIdx ?? nextCourtIdx
      if (courtIdx === undefined) break
      const suggestT0 = nowMs()
      const remainingCourtsInRound = Math.max(1, courtCapacity - projectedRoundMatchCount)
      const availableRequiredIds = [...roundRequiredIds]
        .filter(playerId => !roundBusyIds.has(playerId) && !baseBusyIds.has(playerId))
      const minRequiredForThisCourt = availableRequiredIds.length === 0
        ? 0
        : Math.min(4, Math.max(1, availableRequiredIds.length - ((remainingCourtsInRound - 1) * 4)))
      const requiredForThisCourt = availableRequiredIds.slice(0, minRequiredForThisCourt)
      const requiredForThisCourtIds = new Set(requiredForThisCourt)
      const deferredRequiredIds = availableRequiredIds
        .filter(playerId => !requiredForThisCourtIds.has(playerId))
      const busyIds = new Set([...baseBusyIds, ...roundBusyIds])
      const activePlayersForBias = [...suggestionState.players.values()]
        .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
      const avgMatchesForBias = activePlayersForBias.length === 0
        ? 0
        : activePlayersForBias.reduce((sum, player) => sum + player.matches_played, 0) / activePlayersForBias.length
      const softUnderplayedOverrides = Object.fromEntries(
        activePlayersForBias
          .filter(player => player.matches_played <= avgMatchesForBias - 0.25)
          .filter(player => !requiredForThisCourtIds.has(player.player_id))
          .filter(player => !deferredRequiredIds.includes(player.player_id))
          .filter(player => fairnessAdjustment.tier_overrides[player.player_id] === undefined)
          .map(player => [player.player_id, Tier.SHOULD_PLAY]),
      )
      const softOverplayedOverrides = Object.fromEntries(
        activePlayersForBias
          .filter(player => player.matches_played >= avgMatchesForBias + 0.75)
          .filter(player => !requiredForThisCourtIds.has(player.player_id))
          .filter(player => !deferredRequiredIds.includes(player.player_id))
          .filter(player => fairnessAdjustment.tier_overrides[player.player_id] === undefined)
          .map(player => [player.player_id, Tier.SHOULD_REST]),
      )
      const tierOverrides = {
        ...fairnessAdjustment.tier_overrides,
        ...softOverplayedOverrides,
        ...softUnderplayedOverrides,
        ...Object.fromEntries(deferredRequiredIds.map(playerId => [playerId, Tier.FLEXIBLE])),
        ...Object.fromEntries(requiredForThisCourt.map(playerId => [playerId, Tier.MUST_PLAY])),
      }
      const result = suggestNextMatch(suggestionState, {
        tier_overrides: tierOverrides,
        busy_player_ids: busyIds,
        court_idx: courtIdx,
        max_alternatives: __DEV__ ? 8 : LIVE_TRADEOFF_ALTERNATIVE_LIMIT,
      })
      suggestMs += nowMs() - suggestT0
      const configuredPvnaTolerance = pvnaTolerance
      const tradeoffChoices = buildLiveTradeoffChoices(result.alternatives, suggestionState, configuredPvnaTolerance)
      const recommendedChoice = tradeoffChoices?.choices.find(choice => choice.id === tradeoffChoices.recommended)
        ?? tradeoffChoices?.choices[0]
      const alternative = recommendedChoice?.alternative ?? result.alternatives[0]
      const match = alternative?.matches[0]
      if (!alternative || !match) break
      const effectivePvnaTolerance = suggestionState.config.pvna_tolerance
      const pvnaDiff = match.stats?.pvna_diff ?? 0
      const displayPvnaOverBy = Math.max(0, pvnaDiff - configuredPvnaTolerance)
      const hasEnginePvnaTradeoff = alternative.tradeoffs?.some(tradeoff => tradeoff.type === 'pvna_tolerance_relaxed') ?? false
      const shouldSurfaceAutoPvnaTradeoff = displayPvnaOverBy > 0 && effectivePvnaTolerance > configuredPvnaTolerance && !hasEnginePvnaTradeoff
      const visibleTradeoffs = shouldSurfaceAutoPvnaTradeoff
        ? [
            ...(alternative.tradeoffs ?? []),
            {
              type: 'pvna_tolerance_relaxed' as const,
              severity: displayPvnaOverBy,
              over_by: displayPvnaOverBy,
            },
          ]
        : alternative.tradeoffs
      const visibleWarnings = shouldSurfaceAutoPvnaTradeoff
        ? [...new Set([...alternative.warnings, 'PVNA_TOLERANCE_RELAXED'])]
        : alternative.warnings
      if (__DEV__ && match.stats && match.stats.pvna_diff > 0.5) {
        const labels = (team: [string, string]) => team.map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)).join('+')
        console.log('[NextRoundSuggesterV2] risky suggested match alternatives', {
          sessionId,
          courtIdx,
          projectedRoundNo,
          courtCapacity,
          liveRows: liveMatchRows.length,
          countableMatches: countableMatches.length,
          projectedExistingMatches: projectedExistingMatches.length,
          busyIds: [...busyIds].map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)),
          tierOverrides: Object.keys(fairnessAdjustment.tier_overrides).map(playerId => playersById.get(playerId)?.name ?? playerId.slice(0, 8)),
          selected: `${labels(match.team_a)} vs ${labels(match.team_b)}`,
          alternatives: result.alternatives.slice(0, 8).map((alt, rank) => {
            const altMatch = alt.matches[0]
            return {
              rank: rank + 1,
              match: altMatch ? `${labels(altMatch.team_a)} vs ${labels(altMatch.team_b)}` : null,
              pvnaDiff: altMatch?.stats?.pvna_diff,
              score: alt.score,
              warnings: alt.warnings,
              tradeoffs: alt.tradeoffs,
              approvalRequired: alt.approval_required,
            }
          }),
        })
      }
      payloads.push({
        court_idx: courtIdx,
        team_a: match.team_a,
        team_b: match.team_b,
        resting: alternative.resting,
        round_no: projectedRoundNo,
        preview_live_state_version: rows.liveStateVersion,
        preview_countable_match_count: previewCountableMatchCount,
        warnings: visibleWarnings,
        tradeoffs: visibleTradeoffs,
        approval_required: alternative.approval_required || shouldSurfaceAutoPvnaTradeoff,
        configured_pvna_tolerance: configuredPvnaTolerance,
        effective_pvna_tolerance: effectivePvnaTolerance,
        fairness_reasons: shouldSurfaceAutoPvnaTradeoff
          ? fairnessAdjustment.applied_for_warnings.map(warningTitle)
          : [],
        fairness_reason_details: shouldSurfaceAutoPvnaTradeoff
          ? autoPvnaReasonDetails(fairnessAdjustment.applied_for_warnings, fairnessWarnings, suggestionState, playersById)
          : [],
        tradeoff_choices: tradeoffChoices?.choices,
        recommended_tradeoff_choice: tradeoffChoices?.recommended,
      })
      match.team_a.forEach(playerId => busyIds.add(playerId))
      match.team_b.forEach(playerId => busyIds.add(playerId))
      match.team_a.forEach(playerId => roundBusyIds.add(playerId))
      match.team_b.forEach(playerId => roundBusyIds.add(playerId))
      match.team_a.forEach(playerId => roundRequiredIds.delete(playerId))
      match.team_b.forEach(playerId => roundRequiredIds.delete(playerId))
      roundCourtIdxs.add(courtIdx)
      queuedCourtIdxs.add(courtIdx)
      projectedRoundMatchCount += 1
      const projectT0 = nowMs()
      suggestionState = buildProjectedStateAfterLiveMatch(suggestionState, {
        id: `preview-projected-${index}`,
        session_id: sessionId,
        sequence_no: index,
        round_no: projectedRoundNo,
        court_idx: courtIdx,
        status: 'completed',
        team_a: match.team_a,
        team_b: match.team_b,
        resting: alternative.resting,
        score_a: 0,
        score_b: 0,
        suggested_at: new Date().toISOString(),
        started_at: null,
        ended_at: null,
      }, projectedRoundNo)
      projectMs += nowMs() - projectT0
    }
    if (count > 0) {
      console.log('[NextRoundSuggesterV2] build suggested matches timing', {
        requested: count,
        built: payloads.length,
        liveRows: liveMatchRows.length,
        projectedExistingMatches: projectedExistingMatches.length,
        courtCapacity,
        roundNo: projectedRoundNo,
        suggestMs: Math.round(suggestMs),
        projectMs: Math.round(projectMs),
        totalMs: Math.round(nowMs() - buildT0),
      })
    }
    return payloads
  }, [completingLiveMatchIds, courtCount, fairnessAdjustment.applied_for_warnings, fairnessAdjustment.tier_overrides, fairnessWarnings, playersById, pvnaTolerance, rows.liveMatchRows, rows.liveStateVersion, sessionId, state])

  const startLiveMatch = async (match: SuggestedLiveMatchRow) => {
    const startT0 = nowMs()
    if (startingPreviewIds.has(match.id) || startedPreviewIds.has(match.id)) return
    console.log('[NextRoundSuggesterV2] start live match press', {
      matchId: match.id,
      version: liveStateVersionRef.current,
      courtIdx: match.court_idx,
      roundNo: match.round_no,
      status: match.status,
    })
    const previewVersion = match.preview_live_state_version ?? null
    const previewCountableMatchCount = match.preview_countable_match_count ?? null
    if (previewVersion === null || previewCountableMatchCount === null) {
      setError(toUserSafeActionError(new Error('Preview version missing')))
      void loadLiveState()
      return
    }

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
      if (expectedVersion < previewVersion) {
        throw new Error('Preview is stale')
      }
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
      console.log('[NextRoundSuggesterV2] start live match timing', {
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
      setStartingPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setStartedPreviewIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      setOptimisticLiveMatches(current => current.filter(row => row.id !== match.id))
      const safeMessage = toUserSafeActionError(err)
      console.warn('[NextRoundSuggesterV2] start match failed', err)
      setError(safeMessage)
      await loadLiveState()
      Alert.alert('Lỗi', safeMessage)
    }
  }

  const completeLiveMatch = async (match: SessionLiveMatchRow) => {
    const completeT0 = nowMs()
    if (endingLiveMatchIds.has(match.id)) return
    const pressedVersion = liveStateVersionRef.current
    console.log('[NextRoundSuggesterV2] complete live match press', {
      matchId: match.id,
      version: pressedVersion,
      courtIdx: match.court_idx,
      status: match.status,
    })
    setEndingLiveMatchIds(current => new Set(current).add(match.id))
    setCompletingLiveMatchIds(current => new Set(current).add(match.id))
    const playerIds = [...match.team_a, ...match.team_b]
    const expectedPlayed = (state.players.get(match.team_a[0])?.matches_played ?? 0) + 1
    completingMatchExpectedPlayedRef.current.set(match.id, { playerIds, expectedPlayed })
    const score = liveScores[match.id] ?? { a: match.score_a ?? 0, b: match.score_b ?? 0 }
    await waitForUiFrame()

    const executeComplete = async () => {
      const actionT0 = nowMs()
      const expectedVersion = liveStateVersionRef.current
      if (expectedVersion === null) throw new Error('Session changed')
      const projectT0 = nowMs()
      const projectedState = buildProjectedStateAfterLiveMatch(state, match)
      const projectMs = nowMs() - projectT0
      const targetT0 = nowMs()
      const targetReachedAfterMatch = effectiveTargetRounds > 0
        && [...projectedState.players.values()]
          .filter(player => player.checked_out_at === null)
          .every(player => player.matches_played >= effectiveTargetRounds)
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
      console.log('[NextRoundSuggesterV2] complete live match committed', {
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
      if (payload.match) {
        applyCompletedLiveMatch(
          payload.match,
          payload.changed_player_state ?? [],
          payload.changed_pair_history ?? [],
          payload.live_state_version,
        )
      }
      const applyMs = nowMs() - applyT0
      suggestedPreviewBatchRef.current = null
      setStartedPreviewIds(new Set())
      const completedMatch = (payload.match ?? { ...match, status: 'completed', ended_at: new Date().toISOString() }) as SessionLiveMatchRow
      console.log('[NextRoundSuggesterV2] complete live match timing', {
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
      }
    }

    const queuedComplete = liveMatchMutationQueueRef.current
      .catch(() => undefined)
      .then(executeComplete)
    liveMatchMutationQueueRef.current = queuedComplete.then(() => undefined, () => undefined)

    try {
      const result = await queuedComplete
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
      const cleanupId = setTimeout(() => {
        setCompletingLiveMatchIds(current => {
          if (!current.has(match.id)) return current
          const next = new Set(current)
          next.delete(match.id)
          return next
        })
      }, 8000)
      completingCleanupTimeoutsRef.current.push(cleanupId)
    } catch (err: any) {
      setEndingLiveMatchIds(current => {
        if (!current.has(match.id)) return current
        const next = new Set(current)
        next.delete(match.id)
        return next
      })
      completingMatchExpectedPlayedRef.current.delete(match.id)
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
    setStartedPreviewIds(new Set())
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
      console.log('[NextRoundSuggesterV2] cancel live match timing', {
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

  const updateLiveMatchScore = async (matchId: string, side: 'a' | 'b', delta: number) => {
    const scoreT0 = nowMs()
    const currentScore = liveScores[matchId]?.[side] ?? 0
    const newScore = Math.max(0, currentScore + delta)
    const localT0 = nowMs()
    setLiveScores(previous => ({
      ...previous,
      [matchId]: {
        ...(previous[matchId] ?? { a: 0, b: 0 }),
        [side]: newScore,
      },
    }))
    const localMs = nowMs() - localT0

    const rpcT0 = nowMs()
    const { error: scoreError } = await supabase
      .from('session_live_matches')
      .update({
        [side === 'a' ? 'score_a' : 'score_b']: newScore,
      })
      .eq('id', matchId)
    const rpcMs = nowMs() - rpcT0

    if (scoreError) {
      setLiveScores(previous => ({
        ...previous,
        [matchId]: {
          ...(previous[matchId] ?? { a: 0, b: 0 }),
          [side]: currentScore,
        },
      }))
      Alert.alert('Lỗi', 'Không thể cập nhật điểm số')
    }
    console.log('[NextRoundSuggesterV2] score update timing', {
      matchId,
      side,
      delta,
      score: newScore,
      ok: !scoreError,
      localMs: Math.round(localMs),
      rpcMs: Math.round(rpcMs),
      totalMs: Math.round(nowMs() - scoreT0),
      error: scoreError?.message,
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
          expectedLiveStateVersion: Number(payload?.live_state_version),
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
          expectedLiveStateVersion: Number(payload?.live_state_version),
          expectedRoundNo: activeRound.round_no,
          expectedRoundStatus: 'completed',
        },
      }
    })
  }

  const openSwapForPlayer = useCallback((playerId: string) => {
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
    return [...byId.values()].sort((left, right) => left.sequence_no - right.sequence_no)
  }, [liveMatchDisplayKeys, optimisticLiveMatches, rows.liveMatchRows])
  const activeLiveMatches = useMemo(
    () => effectiveLiveMatchRows.filter(match => match.status === 'live' && !completingLiveMatchIds.has(match.id)),
    [completingLiveMatchIds, effectiveLiveMatchRows],
  )
  const capacityOccupyingLiveMatchCount = useMemo(
    () => effectiveLiveMatchRows.filter(match => match.status === 'live').length,
    [effectiveLiveMatchRows],
  )
  const completedLiveMatches = useMemo(
    () => effectiveLiveMatchRows.filter(match => match.status === 'completed'),
    [effectiveLiveMatchRows],
  )
  const busyLiveMatchPlayerIds = useMemo(() => new Set(
    effectiveLiveMatchRows
      .filter(match => match.status === 'live')
      .flatMap(match => [...match.team_a, ...match.team_b]),
  ), [effectiveLiveMatchRows])
  const nextMatchSuggestion = useMemo(
    () => suggestNextMatch(state, {
      tier_overrides: fairnessAdjustment.tier_overrides,
      busy_player_ids: busyLiveMatchPlayerIds,
    }),
    [busyLiveMatchPlayerIds, fairnessAdjustment.tier_overrides, state],
  )
  const queueCourtCount = Math.max(1, Math.floor(courtCount || 1))
  const suggestedQueueCount = Math.max(0, queueCourtCount - capacityOccupyingLiveMatchCount)
  const previewBatchKey = useMemo(
    () => buildPreviewBatchKey(sessionId, state, queueCourtCount, pvnaTolerance, fairnessAdjustment),
    [fairnessAdjustment, pvnaTolerance, queueCourtCount, sessionId, state],
  )
  React.useEffect(() => {
    if (previewBatchKeyRef.current === null) {
      previewBatchKeyRef.current = previewBatchKey
      return
    }
    if (previewBatchKeyRef.current === previewBatchKey) return
    previewBatchKeyRef.current = previewBatchKey
    setStartedPreviewIds(current => current.size === 0 ? current : new Set())
  }, [previewBatchKey])
  const suggestedLiveMatches = useMemo(() => {
    const cachedBatch = suggestedPreviewBatchRef.current
    if (startedPreviewIds.size > 0 && cachedBatch?.key === previewBatchKey) {
      return cachedBatch.matches
        .filter(match => !startedPreviewIds.has(match.id))
        .slice(0, suggestedQueueCount)
    }
    const payloads = buildSuggestedMatchPayloads(suggestedQueueCount, {
      liveMatchRowsOverride: effectiveLiveMatchRows,
      stateOverride: {
        ...state,
        config: {
          ...state.config,
          courts: queueCourtCount,
        },
      },
    })
    const matches = payloads.map((match, index): SuggestedLiveMatchRow => ({
      id: `preview-${match.court_idx ?? index}-${match.team_a.join('-')}-${match.team_b.join('-')}`,
      session_id: sessionId,
      sequence_no: index,
      round_no: match.round_no,
      court_idx: match.court_idx ?? index,
      status: 'suggested',
      team_a: match.team_a,
      team_b: match.team_b,
      resting: match.resting ?? [],
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      warnings: match.warnings,
      tradeoffs: match.tradeoffs,
      approval_required: match.approval_required,
      preview_live_state_version: match.preview_live_state_version,
      preview_countable_match_count: match.preview_countable_match_count,
      configured_pvna_tolerance: match.configured_pvna_tolerance,
      effective_pvna_tolerance: match.effective_pvna_tolerance,
      fairness_reasons: match.fairness_reasons,
      fairness_reason_details: match.fairness_reason_details,
      tradeoff_choices: match.tradeoff_choices,
      recommended_tradeoff_choice: match.recommended_tradeoff_choice,
    }))
    suggestedPreviewBatchRef.current = { key: previewBatchKey, matches }
    return matches
  }, [
    buildSuggestedMatchPayloads,
    effectiveLiveMatchRows,
    previewBatchKey,
    queueCourtCount,
    sessionId,
    startedPreviewIds,
    state,
    suggestedQueueCount,
  ])
  const liveLogicalRoundByMatchId = useMemo(
    () => buildLogicalRoundDisplayMap([...completedLiveMatches, ...activeLiveMatches], queueCourtCount),
    [activeLiveMatches, completedLiveMatches, queueCourtCount],
  )
  const heroRoundNo = useMemo(() => {
    if (activeRound) return activeRound.round_no
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
    if (countableLiveMatches === 0) return completedRoundCount
    return Math.floor(countableLiveMatches / queueCourtCount)
  }, [completedRoundCount, effectiveLiveMatchRows, queueCourtCount])
  const heroPlayerCount = phase === 'active' ? activePlayerCount : plannedPlayerCount
  const { rosterTotalCount, checkedOutCount, requestedRestCount } = useMemo(() => ({
    rosterTotalCount: rows.playerRows.length,
    checkedOutCount: rows.playerRows.filter(row => Boolean(row.checked_out_at)).length,
    requestedRestCount: rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length,
  }), [rows.playerRows])
  const planningInProgress = phase === 'plan' && (!settingsHydrated || !workingAlternative) && (
    !settingsHydrated
    || suggestionIsUpdating
    || busy === 'sync'
    || (rows.playerRows.length === 0 && checkedInPlayers.length > 0 && !autoSyncAttemptedRef.current)
  )
  const lateArrivalPlayers = useMemo(() => {
    const livePlayerIds = new Set(rows.playerRows.map(row => String(row.player_id)))
    return players.filter(player => {
      const playerId = String(player.id)
      if (player.status && player.status !== 'confirmed') return false
      const status = player.checkInStatus
      return (status === 'pending' || status === 'no_show') && (!livePlayerIds.has(playerId) || busy === `late-${playerId}`)
    })
  }, [busy, rows.playerRows, players])

  const navbarRightSlot = <NavbarRightActions sessionId={sessionId} onRefresh={loadLiveState} refreshing={refreshing} />

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View testID="nrv2-screen" style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="VÒNG KẾ TIẾP" rightSlot={navbarRightSlot} />
      {phase === 'recap' ? (
        <RecapViewModule
          summary={sessionSummary}
          state={reportState}
          matchCountConsistencyRows={matchCountConsistencyRows}
          groupSummaries={groupSummaries}
          playersById={playersById}
          onOpenHistory={() => setSheet('history')}
          onContinue={() => setShowSessionReport(false)}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 126 + insets.bottom }}
        >
          <SessionHeroCard
            phase={phase}
            roundNo={heroRoundNo}
            presentCount={heroPlayerCount}
            rosterTotalCount={rosterTotalCount}
            checkedOutCount={checkedOutCount}
            requestedRestCount={requestedRestCount}
            courtCount={courtCount}
            completedRounds={liveCompletedRoundCount}
            targetRounds={effectiveTargetRounds}
            onOpenRoster={openRoster}
          />

          <ManagePlayersButton
            rosterTotalCount={rosterTotalCount}
            checkedOutCount={checkedOutCount}
            requestedRestCount={requestedRestCount}
            onPress={openRoster}
          />

          <StatusChipRow
            fairnessScore={fairnessScore}
            courtCount={courtCount}
            courtPreset={courtPreset}
            onFairnessPress={() => setSheet('fairness')}
            onSettingsPress={() => setSheet('settings')}
          />

          {lateArrivalPlayers.length > 0 ? (
            <LateArrivalsCta count={lateArrivalPlayers.length} onPress={() => setSheet('late-arrivals')} />
          ) : null}

          {phase === 'plan' && (
            <>
              <LiveMatchBoard
                liveMatches={activeLiveMatches}
                suggestedMatches={suggestedLiveMatches}
                completedMatches={completedLiveMatches}
                roundSize={queueCourtCount}
                scores={liveScores}
                busy={busy}
                startingPreviewIds={startingPreviewIds}
                endingLiveMatchIds={endingLiveMatchIds}
                state={state}
                pvnaTolerance={pvnaTolerance}
                playersById={playersById}
                onScoreChange={updateLiveMatchScore}
                onStartMatch={startLiveMatch}
                onCompleteMatch={completeLiveMatch}
                onCancelMatch={cancelLiveMatch}
                onPlayerPress={openSwapForPlayer}
                onOpenSettings={() => setSheet('settings')}
              />
              {reportReady && !activeRound ? (
                <Card style={{ marginTop: 14, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.primary }}>
                    Đã đủ số trận mục tiêu
                  </Text>
                  <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
                    Có thể xem report hoặc tạo thêm trận nếu buổi chơi vẫn tiếp tục.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={() => setShowSessionReport(true)}
                      style={{ flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={ctaTextStyle(theme.onPrimary, 12)}>Xem report</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {}}
                      style={{ flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={ctaTextStyle(theme.primary, 12)}>Tạo thêm trận</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ) : null}
              {suggestedLiveMatches.length === 0 && activeLiveMatches.length === 0 ? (
                planningInProgress ? (
                  <PlanningRoundCard syncingRoster={busy === 'sync'} />
                ) : (
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
                )
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

      <NextRoundSheet visible={sheet === 'swap'} snap="88" onClose={() => setSheet(null)}>
        <SwapSheetView
          state={state}
          alternative={workingAlternative}
          playersById={playersById}
          swapFromPlayerId={swapFromPlayerId}
          setSwapFromPlayerId={setSwapFromPlayerId}
          onSwap={swapPlayersInWorkingAlternative}
        />
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

function SessionHeroCard({
  phase,
  roundNo,
  presentCount,
  rosterTotalCount,
  checkedOutCount,
  requestedRestCount,
  courtCount,
  completedRounds,
  targetRounds,
  onOpenRoster,
}: {
  phase: 'plan' | 'active'
  roundNo: number
  presentCount: number
  rosterTotalCount: number
  checkedOutCount: number
  requestedRestCount: number
  courtCount: number
  completedRounds: number
  targetRounds: number
  onOpenRoster: () => void
}) {
  const theme = useAppTheme()
  const remaining = Math.max(0, targetRounds - completedRounds)
  return (
    <LinearGradient
      colors={[theme.heroGradientStart, theme.primaryContainer]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: RADIUS.lg, padding: 16, minHeight: 134 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.heroLiveDot }} />
            <Text style={eyebrowStyle(theme.heroBodyMuted, 10)}>
              {phase === 'active' ? 'Đang diễn ra · Live' : 'Vòng kế tiếp · Đề xuất'}
            </Text>
          </View>
          <Text style={{ marginTop: 10, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 32, color: theme.surface }}>
            Vòng {roundNo}
          </Text>
          <Text style={{ marginTop: 7, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
            {presentCount} {phase === 'active' ? 'trong vòng' : 'trong danh sách'} · {courtCount} sân · {completedRounds}/{targetRounds} vòng
          </Text>
          <TouchableOpacity onPress={onOpenRoster} activeOpacity={0.7}>
            <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.heroBodyMuted }}>
              Roster {rosterTotalCount} · Check-out {checkedOutCount} · Xin nghỉ {requestedRestCount} →
            </Text>
          </TouchableOpacity>
        </View>
        <View
          style={{
            backgroundColor: theme.heroPillBg,
            borderRadius: RADIUS.full,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>
            {phase === 'active' ? 'LIVE' : `Còn ${remaining} vòng`}
          </Text>
        </View>
      </View>
    </LinearGradient>
  )
}

function LateArrivalsCta({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useAppTheme()
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        marginTop: 12,
        borderRadius: RADIUS.md,
        backgroundColor: theme.warningBg,
        borderWidth: BORDER.hairline,
        borderColor: theme.warningStrong,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: RADIUS.full, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.warningText }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.warningText }}>Có người đến muộn</Text>
        <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.warningText }}>
          Thêm vào roster trước khi gợi ý vòng tiếp theo.
        </Text>
      </View>
      <Text style={ctaTextStyle(theme.warningText, 11)}>Mở</Text>
    </TouchableOpacity>
  )
}

function ManagePlayersButton({
  rosterTotalCount,
  checkedOutCount,
  requestedRestCount,
  onPress,
}: {
  rosterTotalCount: number
  checkedOutCount: number
  requestedRestCount: number
  onPress: () => void
}) {
  const theme = useAppTheme()
  return (
    <TouchableOpacity
      testID="nrv2-manage-players"
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        marginTop: 12,
        minHeight: 48,
        borderRadius: RADIUS.md,
        backgroundColor: theme.surface,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        paddingHorizontal: 14,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        ...LAYOUT_SHADOW.xs,
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
        <Users size={17} color={theme.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 13, color: theme.onSurface, fontWeight: '900' }}>
          Quản lý người chơi
        </Text>
        <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
          Roster {rosterTotalCount} · Check-out {checkedOutCount} · Xin nghỉ {requestedRestCount}
        </Text>
      </View>
      <Text style={ctaTextStyle(theme.primary, 11)}>Mở</Text>
    </TouchableOpacity>
  )
}

function StatusChipRow({
  fairnessScore,
  fairnessPreview = null,
  courtCount,
  courtPreset,
  onFairnessPress,
  onPreviewPress,
  onSettingsPress,
}: {
  fairnessScore: SessionFairnessScore
  fairnessPreview?: FairnessPreview | null
  courtCount: number
  courtPreset: CourtPreset
  onFairnessPress: () => void
  onPreviewPress?: () => void
  onSettingsPress: () => void
}) {
  const theme = useAppTheme()
  const preset = PRESETS[courtPreset]
  const delta = fairnessPreview?.delta_total ?? null
  const deltaColor = delta == null ? theme.outline : delta >= 0 ? theme.successText : theme.warningText
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
      <View style={{ flex: 1, gap: 8 }}>
        <TouchableOpacity testID="nrv2-fairness-chip" onPress={onFairnessPress} activeOpacity={0.9}>
          <Card style={{ borderRadius: RADIUS.lg, padding: 12, minHeight: 72 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={18} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={eyebrowStyle(theme.outline)}>Fairness</Text>
                <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
                  {fairnessScore.total} {fairnessLabel(fairnessScore)}
                </Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
        {false ? <TouchableOpacity testID="nrv2-preview-chip" onPress={onPreviewPress} activeOpacity={0.9}>
          <Card style={{ borderRadius: RADIUS.lg, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TrendingUp size={18} color={deltaColor} />
              <View style={{ flex: 1 }}>
                <Text style={eyebrowStyle(theme.outline)}>Dự kiến vòng kế</Text>
                <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: deltaColor }}>
                  {delta == null
                    ? 'Chưa có gợi ý'
                    : `${fairnessScore.total} → ${fairnessPreview!.after_total} (${delta > 0 ? '+' : ''}${delta})`}
                </Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity> : null}
      </View>
      <TouchableOpacity testID="nrv2-settings-chip" onPress={onSettingsPress} activeOpacity={0.9} style={{ flex: 1 }}>
        <Card style={{ borderRadius: RADIUS.lg, padding: 12, minHeight: 72 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Settings size={18} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={eyebrowStyle(theme.outline)}>Cài đặt</Text>
              <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
                {courtCount} sân · {preset.label}
              </Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    </View>
  )
}

function auditDeltaLines(best: AlternativeAudit, current: AlternativeAudit): string[] {
  type DeltaEntry = { label: string; delta: number; worse: boolean }
  const entries: DeltaEntry[] = []

  const opponentBurdenDelta = current.max_opponent_burden - best.max_opponent_burden
  if (opponentBurdenDelta !== 0) {
    entries.push({ label: `Lặp đối thủ ${opponentBurdenDelta > 0 ? '+' : ''}${opponentBurdenDelta}`, delta: Math.abs(opponentBurdenDelta), worse: opponentBurdenDelta > 0 })
  }
  const opponentPairDelta = current.opponent_repeat_pairs - best.opponent_repeat_pairs
  if (opponentPairDelta !== 0) {
    entries.push({ label: `Cặp đối thủ lặp ${opponentPairDelta > 0 ? '+' : ''}${opponentPairDelta}`, delta: Math.abs(opponentPairDelta), worse: opponentPairDelta > 0 })
  }
  const partnerPairDelta = current.partner_repeat_pairs - best.partner_repeat_pairs
  if (partnerPairDelta !== 0) {
    entries.push({ label: `Cặp partner lặp ${partnerPairDelta > 0 ? '+' : ''}${partnerPairDelta}`, delta: Math.abs(partnerPairDelta), worse: partnerPairDelta > 0 })
  }
  const matchRangeDelta = current.match_range - best.match_range
  if (matchRangeDelta !== 0) {
    entries.push({ label: `Lệch số trận ${matchRangeDelta > 0 ? '+' : ''}${matchRangeDelta}`, delta: Math.abs(matchRangeDelta), worse: matchRangeDelta > 0 })
  }
  const pvnaDelta = current.pvna_diff - best.pvna_diff
  if (Math.abs(pvnaDelta) >= 0.3) {
    entries.push({ label: `PVNA ${pvnaDelta > 0 ? '+' : ''}${pvnaDelta.toFixed(1)}`, delta: Math.abs(pvnaDelta), worse: pvnaDelta > 0 })
  }

  // 1 stat xấu nhất + 1 stat tốt nhất nếu có cả 2 chiều, ngược lại 2 stat lớn nhất
  const worse = entries.filter(e => e.worse).sort((a, b) => b.delta - a.delta)
  const better = entries.filter(e => !e.worse).sort((a, b) => b.delta - a.delta)
  if (worse.length > 0 && better.length > 0) {
    return [worse[0].label, better[0].label]
  }
  return entries.sort((a, b) => b.delta - a.delta).slice(0, 2).map(e => e.label)
}

function AlternativeTabs({
  alternatives,
  audits,
  alternativeOrder,
  selectedIndex,
  onSelect,
  onOpenHistory,
  onOpenRoster,
  targetReachedLabel,
}: {
  alternatives: SuggestionAlternative[]
  audits: AlternativeAudit[]
  alternativeOrder: number[]
  selectedIndex: number
  onSelect: (index: number) => void
  onOpenHistory: () => void
  onOpenRoster: () => void
  targetReachedLabel: string
}) {
  const theme = useAppTheme()
  const bestOriginalIndex = alternativeOrder[0] ?? 0
  const bestAudit = audits[bestOriginalIndex]
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={eyebrowStyle(theme.outline)}>{alternatives.length} phương án · Đề xuất</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={onOpenHistory}>
            <Text style={eyebrowStyle(theme.primary)}>{targetReachedLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="nrv2-roster-link" onPress={onOpenRoster}>
            <Text style={eyebrowStyle(theme.primary)}>Người chơi</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {alternativeOrder.slice(0, 3).map((originalIndex, displayIndex) => {
          const alternative = alternatives[originalIndex]
          const audit = audits[originalIndex]
          if (!alternative || !audit) return null
          const active = selectedIndex === originalIndex
          const isBest = displayIndex === 0
          const deltaLines = !isBest && bestAudit ? auditDeltaLines(bestAudit, audit) : []
          const hasDelta = deltaLines.length > 0
          return (
            <TouchableOpacity
              key={`alt-${originalIndex}`}
              testID={`nrv2-alt-tab-${originalIndex}`}
              onPress={() => onSelect(originalIndex)}
              activeOpacity={0.9}
              style={{
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                backgroundColor: active ? theme.primary : 'transparent',
                paddingHorizontal: 12,
                paddingVertical: hasDelta ? 8 : 0,
                minHeight: 44,
                flexDirection: 'row',
                alignItems: hasDelta ? 'flex-start' : 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: hasDelta ? 2 : 0 }}>
                <Text style={ctaTextStyle(active ? theme.onPrimary : theme.onSurface, 13)}>
                  ALT {displayIndex + 1}
                </Text>
                {hasDelta ? (
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: active ? 'rgba(255,255,255,0.72)' : theme.outline, marginTop: 2, lineHeight: 14 }}>
                    {deltaLines.join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: hasDelta ? 2 : 0 }}>
                <View
                  style={{
                    borderRadius: RADIUS.full,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    backgroundColor: active ? 'rgba(255,255,255,0.16)' : theme.secondaryContainer,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.primary }}>
                    {audit.fairness_total}
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: active ? theme.onPrimary : theme.outline }}>
                  {isBest ? 'Tốt nhất' : `${(audit.fairness_total - (bestAudit?.fairness_total ?? 0)).toFixed(0)}`}
                </Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function FairnessPreviewCard({ preview, onPress }: { preview: FairnessPreview; onPress: () => void }) {
  const theme = useAppTheme()
  const beforeTotal = preview.before_total
  const afterTotal = preview.after_total
  const delta = preview.delta_total
  const tone = delta >= 0 ? theme.successText : theme.warningText
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={{ marginTop: 14 }}>
      <Card style={{ borderRadius: RADIUS.md, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: RADIUS.md,
              backgroundColor: delta >= 0 ? theme.successBg : theme.warningBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={18} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.outline)}>Dự kiến điểm vòng kế</Text>
            <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>
              {beforeTotal} → {afterTotal}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline, marginTop: 4 }}>
              Bấm để xem audit chi tiết: partner (đồng đội), đối thủ, nhịp nghỉ và áp lực lặp
            </Text>
          </View>
          <View style={{ borderRadius: RADIUS.full, backgroundColor: delta >= 0 ? theme.successBg : theme.warningBg, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: tone }}>{delta >= 0 ? `+${delta}` : delta}</Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

function FairnessPreviewSheet({ preview }: { preview: FairnessPreview | null }) {
  const theme = useAppTheme()
  if (!preview) {
    return <SheetTitle title="Dự kiến điểm vòng kế" subtitle="Chưa có phương án vòng kế để đánh giá." />
  }

  const tone = preview.delta_total >= 0 ? theme.successText : theme.warningText
  const summaryBg = preview.delta_total >= 0 ? theme.successBg : theme.warningBg
  const pressureText = preview.pressure_after.repeat_risk === 'low'
    ? 'Ít nguy cơ lặp partner (đồng đội) hoặc đối thủ.'
    : preview.pressure_after.repeat_risk === 'medium'
      ? 'Có thể bắt đầu lặp một vài partner (đồng đội) hoặc đối thủ.'
      : 'Áp lực lặp partner (đồng đội) hoặc đối thủ đang cao.'
  const availabilityText = preview.availability_after.churn_level === 'low'
    ? 'Danh sách người chơi ổn định.'
    : preview.availability_after.churn_level === 'medium'
      ? 'Có thay đổi người chơi, điểm độ cân bằng (fairness) đã tính nhẹ hơn.'
      : 'Người vào/ra nhiều, nên xem đây là kèo khó giữ đều tuyệt đối.'
  return (
    <View>
      <SheetTitle title="Nếu bắt đầu vòng này" subtitle="Ước tính độ cân bằng sau khi lưu phương án đang chọn." />
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 }}>
        <Text style={eyebrowStyle(theme.heroCountdownText)}>Điểm dự kiến</Text>
        <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 42, color: theme.surface }}>
          {preview.before_total} → {preview.after_total}
        </Text>
        <View style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: theme.heroPillBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>
            {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}
          </Text>
        </View>
      </LinearGradient>

      <Card style={{ borderRadius: RADIUS.md, padding: 12, marginBottom: 12, backgroundColor: summaryBg }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: tone }}>
          {preview.delta_total >= 0 ? 'Phương án này giữ độ cân bằng tốt' : 'Phương án này làm giảm độ cân bằng'}
        </Text>
        <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: tone }}>
          Điểm thay đổi {preview.delta_total > 0 ? '+' : ''}{preview.delta_total}. {pressureText} {availabilityText}
        </Text>
      </Card>

      <Card style={{ borderRadius: RADIUS.md, padding: 12, marginBottom: 12, backgroundColor: theme.secondaryContainer }}>
        <Text style={eyebrowStyle(theme.primary)}>Các chỉ số nền</Text>
        <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Áp lực lặp partner (đồng đội) hoặc đối thủ: {repeatRiskLabel(preview.pressure_before.repeat_risk)} → {repeatRiskLabel(preview.pressure_after.repeat_risk)}.
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Hệ số giảm phạt: {preview.pressure_before.penalty_multiplier.toFixed(2)} → {preview.pressure_after.penalty_multiplier.toFixed(2)}. Áp lực đối thủ: {preview.pressure_before.opponent_pressure.toFixed(2)} → {preview.pressure_after.opponent_pressure.toFixed(2)}.
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.onSurface }}>
          Biến động người chơi: {churnLevelLabel(preview.availability_before.churn_level)} → {churnLevelLabel(preview.availability_after.churn_level)}. Tỉ lệ người vào/ra: {(preview.availability_before.avg_churn_ratio * 100).toFixed(0)}% → {(preview.availability_after.avg_churn_ratio * 100).toFixed(0)}%.
        </Text>
      </Card>

      <View style={{ gap: 8 }}>
        {preview.rows.map(row => (
          <Card key={`preview-row-${row.key}`} style={{ borderRadius: RADIUS.md, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{row.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline }}>
                {row.before} → {row.after}
              </Text>
              <Text style={{ width: 36, textAlign: 'right', fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: row.delta >= 0 ? theme.primary : tone }}>
                {row.delta > 0 ? '+' : ''}{row.delta}
              </Text>
            </View>
            <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 16, color: theme.outline }}>
              {describePreviewRow(row)}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  )
}

function describePreviewRow(row: FairnessPreview['rows'][number]) {
  if (row.key === 'match_count') {
    return row.delta < 0
      ? 'Một số người sẽ lệch số trận sau vòng này. Nếu lệch chỉ 1 trận thì thường vẫn ổn.'
      : 'Số trận giữa người chơi vẫn cân bằng.'
  }
  if (row.key === 'partner_diversity') {
    return row.delta < 0
      ? 'Có thêm cặp đánh chung bị lặp.'
      : 'Không làm xấu độ đa dạng partner (đồng đội).'
  }
  if (row.key === 'opponent_diversity') {
    return row.delta < 0
      ? 'Có thêm đối thủ bị gặp lại.'
      : 'Không làm xấu độ đa dạng đối thủ.'
  }
  if (row.key === 'rest') {
    return row.delta < 0
      ? 'Có người nghỉ liên tiếp hoặc nhịp nghỉ xấu hơn.'
      : 'Nhịp nghỉ vẫn ổn.'
  }
  if (row.key === 'gender_prefs') {
    return row.delta < 0
      ? 'Một số sở thích giới tính không được đáp ứng trong vòng này.'
      : 'Sở thích giới tính vẫn được giữ tốt.'
  }
  return row.detail
}

function EngineExplainCard({
  alternative,
  actions,
  alternativeOrder,
  expanded,
  onToggle,
  onApplyAction,
  currentFairness,
}: {
  alternative: SuggestionAlternative
  actions: SuggestedRoundAction[]
  alternativeOrder: number[]
  expanded: boolean
  onToggle: () => void
  onApplyAction: (action: SuggestedRoundAction) => void
  currentFairness: number
}) {
  const theme = useAppTheme()
  const betterAltAction = actions.find((a): a is Extract<SuggestedRoundAction, { type: 'select_alternative' }> => a.type === 'select_alternative')
  const setupActions = actions.filter((a): a is Extract<SuggestedRoundAction, { type: 'set_pvna_tolerance' | 'set_courts' }> => a.type === 'set_pvna_tolerance' || a.type === 'set_courts')
  const comparisonReasons = betterAltAction?.after ? improvementReasons(betterAltAction.before, betterAltAction.after) : []
  const displayIndexOf = (originalIndex: number) => alternativeOrder.indexOf(originalIndex)

  return (
    <Card style={{ marginTop: 12, borderRadius: RADIUS.md, padding: 14, backgroundColor: theme.secondaryContainer }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Sparkles size={16} color={theme.primary} />
        <Text style={eyebrowStyle(theme.primary)}>Lý do gợi ý</Text>
      </View>

      {betterAltAction ? (
        <>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface }}>
            ALT {displayIndexOf(betterAltAction.alternative_index) + 1} tốt hơn phương án đang chọn
          </Text>
          {comparisonReasons.length > 0 ? (
            <View style={{ marginTop: 8, gap: 4 }}>
              {comparisonReasons.map((reason, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>·</Text>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface, lineHeight: 17 }}>
                    {reason}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 19, color: theme.onSurface }}>
          Đây là phương án tốt nhất cho vòng này: cân PVNA, hạn chế lặp partner/đối thủ, giữ nhịp nghỉ và tôn trọng group/sở thích.
        </Text>
      )}

      <TouchableOpacity onPress={onToggle} style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={ctaTextStyle(theme.outline, 11)}>Chi tiết điểm ghép</Text>
        <ChevronDown size={14} color={theme.outline} />
      </TouchableOpacity>
      {expanded ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {[
            ['Chênh PVNA', alternative.stats.pvna_diff.toFixed(2)],
            ['Lặp partner', String(alternative.stats.partner_repeats)],
            ['Lặp đối thủ', String(alternative.stats.opponent_repeats)],
            ['Điểm ưu tiên group', String(alternative.stats.group_bonus)],
            ['Sở thích giới tính', alternative.stats.gender_pref_penalty.toFixed(1)],
            ['Điểm ghép tổng', alternative.score.toFixed(1)],
          ].map(([label, value]) => (
            <View key={label} style={{ width: '48%', backgroundColor: theme.surface, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
              <Text style={eyebrowStyle(theme.outline, 9)}>{label}</Text>
              <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {betterAltAction ? (
        <TouchableOpacity
          onPress={() => onApplyAction(betterAltAction)}
          style={{
            marginTop: 12,
            minHeight: 42,
            borderRadius: RADIUS.md,
            backgroundColor: theme.primary,
            paddingHorizontal: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={ctaTextStyle(theme.surface, 13)}>
            Chuyển sang ALT {displayIndexOf(betterAltAction.alternative_index) + 1}
          </Text>
        </TouchableOpacity>
      ) : null}

      {setupActions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {setupActions.map(action => {
            const impactLines = setupActionImpactLines(action, currentFairness)
            return (
              <TouchableOpacity
                key={action.type}
                onPress={() => onApplyAction(action)}
                style={{
                  minHeight: 38,
                  borderRadius: RADIUS.md,
                  backgroundColor: theme.surface,
                  borderWidth: BORDER.hairline,
                  borderColor: theme.outlineVariant,
                  padding: 12,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, lineHeight: 16 }}>
                    {action.label}
                  </Text>
                  <Text style={ctaTextStyle(theme.primary, 11)}>Đánh đổi</Text>
                </View>
                <View style={{ gap: 3 }}>
                  {impactLines.map(line => (
                    <Text key={line} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline, lineHeight: 15 }}>
                      {line}
                    </Text>
                  ))}
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.primary, lineHeight: 14 }}>
                  Có thể hoàn tác sau khi áp dụng.
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}
    </Card>
  )
}

function setupActionImpactLines(
  action: Extract<SuggestedRoundAction, { type: 'set_pvna_tolerance' | 'set_courts' }>,
  currentFairness: number,
): string[] {
  const after = action.after
  if (!after) return [action.detail]

  const before = action.before
  const lines: string[] = []

  // Fairness: hiện tại → sau vòng (không áp) vs sau vòng (áp dụng)
  lines.push(`Fairness: ${currentFairness} → ${before.fairness_total} (không áp) / ${after.fairness_total} (áp dụng)`)

  // Chỉ hiện các stats thực sự thay đổi khi áp đánh đổi
  if (before.pvna_diff !== after.pvna_diff) {
    lines.push(`Chênh PVNA vòng này: ${before.pvna_diff.toFixed(2)} → ${after.pvna_diff.toFixed(2)}`)
  }
  if (before.match_range !== after.match_range) {
    lines.push(`Lệch số trận: ${before.match_range} → ${after.match_range}`)
  }
  if (before.max_opponent_burden !== after.max_opponent_burden) {
    lines.push(`Tải lặp đối thủ tối đa: ${before.max_opponent_burden} → ${after.max_opponent_burden}`)
  }
  const repeatBefore = before.opponent_repeat_pairs + before.partner_repeat_pairs
  const repeatAfter = after.opponent_repeat_pairs + after.partner_repeat_pairs
  if (repeatBefore !== repeatAfter) {
    lines.push(`Cặp lặp tổng: ${repeatBefore} → ${repeatAfter}`)
  }
  if (before.max_opponent_pair !== after.max_opponent_pair) {
    lines.push(`Lặp đối thủ nhiều nhất: ${before.max_opponent_pair} → ${after.max_opponent_pair}`)
  }
  if (before.max_partner_pair !== after.max_partner_pair) {
    lines.push(`Lặp partner nhiều nhất: ${before.max_partner_pair} → ${after.max_partner_pair}`)
  }

  return lines
}

function improvementReasons(before: AlternativeAudit, after: AlternativeAudit): string[] {
  const reasons: string[] = []
  if (after.match_range < before.match_range)
    reasons.push(`Số trận đều hơn: lệch ${before.match_range}→${after.match_range}`)
  if (after.max_opponent_burden < before.max_opponent_burden)
    reasons.push(`Gặp lại đối thủ: tối đa ${before.max_opponent_burden}→${after.max_opponent_burden}`)
  if (after.max_opponent_pair < before.max_opponent_pair)
    reasons.push(`Lặp đối thủ: ${before.max_opponent_pair}→${after.max_opponent_pair} lần`)
  if (after.max_partner_pair < before.max_partner_pair)
    reasons.push(`Lặp đồng đội: ${before.max_partner_pair}→${after.max_partner_pair} lần`)
  if (after.opponent_repeat_pairs < before.opponent_repeat_pairs)
    reasons.push(`Cặp đối thủ lặp: ${before.opponent_repeat_pairs}→${after.opponent_repeat_pairs}`)
  if (after.partner_repeat_pairs < before.partner_repeat_pairs)
    reasons.push(`Cặp đồng đội lặp: ${before.partner_repeat_pairs}→${after.partner_repeat_pairs}`)
  if (after.fairness_total > before.fairness_total + 2)
    reasons.push(`Điểm fairness: ${before.fairness_total}→${after.fairness_total}`)
  return reasons
}

function NextMatchSuggestionCard({
  alternative,
  state,
  playersById,
  onPlayerPress,
  onCreate,
  busy,
  initialCount,
}: {
  alternative: SuggestionAlternative
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
  onCreate: () => void
  busy: boolean
  initialCount: number
}) {
  const theme = useAppTheme()
  const match = alternative.matches[0]
  if (!match) return null
  return (
    <Card style={{ marginTop: 16, padding: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Gợi ý trận kế tiếp</Text>
      <MatchTile match={match} state={state} playersById={playersById} onPlayerPress={onPlayerPress} />
      {false ? <TouchableOpacity
        onPress={onCreate}
        disabled={busy}
        style={{ marginTop: 12, height: 46, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={theme.onPrimary} /> : (
          <Text style={ctaTextStyle(theme.onPrimary, 12)}>
            {initialCount > 1 ? `Tạo ${initialCount} trận đầu tiên` : 'Tạo trận gợi ý'}
          </Text>
        )}
      </TouchableOpacity> : null}
    </Card>
  )
}

function displayMatchKey(match: SessionLiveMatchRow) {
  return (match as LiveDisplayMatchRow).client_preview_id ?? match.id
}

function LiveMatchBoard({
  liveMatches,
  suggestedMatches,
  completedMatches,
  roundSize,
  scores,
  busy,
  startingPreviewIds,
  endingLiveMatchIds,
  state,
  pvnaTolerance,
  playersById,
  onScoreChange,
  onStartMatch,
  onCompleteMatch,
  onCancelMatch,
  onPlayerPress,
  onOpenSettings,
}: {
  liveMatches: SessionLiveMatchRow[]
  suggestedMatches: SuggestedLiveMatchRow[]
  completedMatches: SessionLiveMatchRow[]
  roundSize: number
  scores: Record<string, { a: number; b: number }>
  busy: string | null
  startingPreviewIds: Set<string>
  endingLiveMatchIds: Set<string>
  state: SessionState
  pvnaTolerance: number
  playersById: Map<string, ArrangementPlayer>
  onScoreChange: (matchId: string, side: 'a' | 'b', delta: number) => void
  onStartMatch: (match: SuggestedLiveMatchRow) => void
  onCompleteMatch: (match: SessionLiveMatchRow) => void
  onCancelMatch: (match: SessionLiveMatchRow) => void
  onPlayerPress: (playerId: string) => void
  onOpenSettings: () => void
}) {
  if (liveMatches.length === 0 && suggestedMatches.length === 0) return null
  const logicalRoundByMatchId = buildLogicalRoundDisplayMap([...completedMatches, ...liveMatches], roundSize)
  const liveGroups = groupMatchesByLogicalRound(liveMatches, logicalRoundByMatchId)
  const suggestedGroups = groupMatchesByLogicalRound(suggestedMatches, logicalRoundByMatchId)
  return (
    <View style={{ marginTop: 16, gap: 14 }}>
      {liveMatches.length > 0 ? (
        <View>
          <SectionEyebrow label="Trận đang đánh" />
          <View style={{ gap: 12 }}>
            {liveGroups.map(group => (
              <View key={`live-round-${group.roundNo}`} style={{ gap: 10 }}>
                <RoundDivider roundNo={group.roundNo} />
                {group.matches.map(match => (
                  <LiveMatchScoreBoard
                    key={displayMatchKey(match)}
                    match={match}
                    score={scores[match.id] ?? { a: match.score_a ?? 0, b: match.score_b ?? 0 }}
                    busy={busy === `complete-match-${match.id}` || endingLiveMatchIds.has(match.id)}
                    cancelBusy={busy === `cancel-match-${match.id}`}
                    state={state}
                    playersById={playersById}
                    onScoreChange={onScoreChange}
                    onComplete={onCompleteMatch}
                    onCancel={onCancelMatch}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {suggestedMatches.length > 0 ? (
        <View>
          <SectionEyebrow label="Gợi ý trận kế tiếp" />
          <View style={{ gap: 12 }}>
            {suggestedGroups.map(group => (
              <View key={`suggested-round-${group.roundNo}`} style={{ gap: 10 }}>
                <RoundDivider roundNo={group.roundNo} />
                {group.matches.map(match => (
                  <SuggestedLiveMatchCard
                    key={match.id}
                    match={match}
                    busy={busy === `start-match-${match.id}` || startingPreviewIds.has(match.id)}
                    state={state}
                    pvnaTolerance={pvnaTolerance}
                    playersById={playersById}
                    onStart={onStartMatch}
                    onPlayerPress={onPlayerPress}
                    onOpenSettings={onOpenSettings}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function groupMatchesByLogicalRound<TMatch extends SessionLiveMatchRow>(
  matches: TMatch[],
  logicalRoundByMatchId: Map<string, number>,
) {
  const groups = new Map<number, TMatch[]>()
  for (const match of [...matches].sort((left, right) => left.sequence_no - right.sequence_no)) {
    const key = logicalRoundByMatchId.get(match.id) ?? ((match.round_no ?? 0) + 1)
    groups.set(key, [...(groups.get(key) ?? []), match])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([roundNo, groupMatches]) => ({ roundNo, matches: groupMatches }))
}

function buildLogicalRoundDisplayMap(matches: SessionLiveMatchRow[], roundSize: number) {
  const safeRoundSize = Math.max(1, Math.floor(roundSize))
  const countableMatches = [...matches]
    .filter(match => match.status !== 'cancelled')
    .sort((left, right) => left.sequence_no - right.sequence_no)
  return new Map(countableMatches.map((match, index) => [
    match.id,
    Math.floor(index / safeRoundSize) + 1,
  ]))
}

function RoundDivider({ roundNo }: { roundNo: number }) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, height: BORDER.hairline, backgroundColor: theme.outlineVariant }} />
      <View style={{ borderRadius: RADIUS.full, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline, fontWeight: '800' }}>Vòng {roundNo}</Text>
      </View>
      <View style={{ flex: 1, height: BORDER.hairline, backgroundColor: theme.outlineVariant }} />
    </View>
  )
}

function SectionEyebrow({ label }: { label: string }) {
  const theme = useAppTheme()
  return <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>{label}</Text>
}

function toMatch(row: SessionLiveMatchRow): Match {
  return {
    court_idx: row.court_idx ?? 0,
    team_a: row.team_a,
    team_b: row.team_b,
  }
}

function getProjectedRepeatCapSummary(match: Match, state: SessionState) {
  const summary = getProjectedRepeatSummary(match.team_a, match.team_b, state)
  return {
    ...summary,
    maxPartner: summary.max_repeated_partners_per_player,
    maxOpponent: summary.max_repeated_opponents_per_player,
  }
}

function getRepeatDetailLines(
  match: Match,
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
) {
  type RepeatPairDetail = {
    playerA: string
    playerB: string
    currentCount: number
    projectedCount: number
  }
  const pairLines: string[] = []
  const sentenceLines: string[] = []
  const partnerPairs: RepeatPairDetail[] = []
  const opponentPairs: RepeatPairDetail[] = []
  const playerRepeatMap = new Map<string, { partners: string[]; opponents: string[] }>()
  const describePair = (playerA: string, playerB: string) =>
    `${playerName(playerA, playersById)} và ${playerName(playerB, playersById)}`
  const repeatSentence = (
    playerA: string,
    playerB: string,
    currentCount: number,
    projectedCount: number,
    relation: 'partner' | 'opponent',
  ) => {
    const pairText = describePair(playerA, playerB)
    const previousText = currentCount === 1 ? '1 trận' : `${currentCount} trận`
    const projectedText = projectedCount === 2 ? 'trận thứ 2' : `trận thứ ${projectedCount}`
    return relation === 'partner'
      ? `${pairText} đã làm đồng đội ${previousText}; đây là ${projectedText} cùng làm đồng đội.`
      : `${pairText} đã làm đối thủ ${previousText}; đây là ${projectedText} làm đối thủ.`
  }

  for (const team of [match.team_a, match.team_b]) {
    const currentCount = state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0
    const projectedCount = currentCount + 1
    if (projectedCount >= 2) {
      partnerPairs.push({ playerA: team[0], playerB: team[1], currentCount, projectedCount })
      sentenceLines.push(repeatSentence(team[0], team[1], currentCount, projectedCount, 'partner'))
      pairLines.push(`Partner: ${describePair(team[0], team[1])} (${projectedCount} lần)`)
    }
  }

  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      const currentCount = state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0
      const projectedCount = currentCount + 1
      if (projectedCount >= 2) {
        opponentPairs.push({ playerA, playerB, currentCount, projectedCount })
        sentenceLines.push(repeatSentence(playerA, playerB, currentCount, projectedCount, 'opponent'))
        pairLines.push(`Đối thủ: ${describePair(playerA, playerB)} (${projectedCount} lần)`)
      }
    }
  }

  const playerLines = [...playerRepeatMap.entries()]
    .map(([playerId, item]) => {
      const parts: string[] = []
      if (item.partners.length > 0) {
        parts.push(`partner ${item.partners.map(id => playerName(id, playersById)).join(', ')}`)
      }
      if (item.opponents.length > 0) {
        parts.push(`đối thủ ${item.opponents.map(id => playerName(id, playersById)).join(', ')}`)
      }
      return `${playerName(playerId, playersById)} lặp với ${parts.join('; ')}`
    })
    .slice(0, 4)

  return {
    pairLines: sentenceLines.slice(0, 4),
    playerLines: [],
    partnerPairs,
    opponentPairs,
    hiddenCount: Math.max(0, sentenceLines.length - 4),
  }
}

function SuggestedLiveMatchCard({
  match,
  busy,
  state,
  pvnaTolerance,
  playersById,
  onStart,
  onPlayerPress,
  onOpenSettings,
}: {
  match: SuggestedLiveMatchRow
  busy: boolean
  state: SessionState
  pvnaTolerance: number
  playersById: Map<string, ArrangementPlayer>
  onStart: (match: SuggestedLiveMatchRow) => void
  onPlayerPress: (playerId: string) => void
  onOpenSettings: () => void
}) {
  const theme = useAppTheme()
  const cancelBusy = false
  const tradeoffChoices = match.tradeoff_choices ?? []
  const [selectedChoiceId, setSelectedChoiceId] = useState<SuggestionTradeoffChoiceId>(
    match.recommended_tradeoff_choice ?? tradeoffChoices[0]?.id ?? 'balanced',
  )
  useEffect(() => {
    setSelectedChoiceId(match.recommended_tradeoff_choice ?? match.tradeoff_choices?.[0]?.id ?? 'balanced')
  }, [match.id, match.recommended_tradeoff_choice])
  const selectedChoice = tradeoffChoices.find(choice => choice.id === selectedChoiceId) ?? tradeoffChoices[0]
  const activeMatch = useMemo<SuggestedLiveMatchRow>(() => {
    if (!selectedChoice) return match
    const selected = selectedChoice.alternative
    const selectedMatch = selected.matches[0]
    if (!selectedMatch) return match
    return {
      ...match,
      team_a: selectedMatch.team_a,
      team_b: selectedMatch.team_b,
      resting: selected.resting,
      warnings: selected.warnings,
      tradeoffs: selected.tradeoffs,
      approval_required: selected.approval_required,
    }
  }, [match, selectedChoice])
  const pvnaDiff = useMemo(
    () => Math.abs(getTeamPvna(activeMatch.team_a, state) - getTeamPvna(activeMatch.team_b, state)),
    [activeMatch.team_a, activeMatch.team_b, state],
  )
  const pvnaOverBy = Math.max(0, pvnaDiff - pvnaTolerance)
  const pvnaCapExceeded = pvnaOverBy > 0
  const requiresRepeatApproval = activeMatch.approval_required || pvnaCapExceeded || activeMatch.warnings?.includes('REPEAT_CAP_RELAXED') || activeMatch.warnings?.includes('PVNA_TOLERANCE_RELAXED') || false
  const repeatTradeoff = activeMatch.tradeoffs?.find(tradeoff => tradeoff.type === 'repeat_cap_relaxed')
  const pvnaTradeoff = activeMatch.tradeoffs?.find(tradeoff => tradeoff.type === 'pvna_tolerance_relaxed')
  const effectivePvnaTolerance = activeMatch.effective_pvna_tolerance ?? state.config.pvna_tolerance
  const configuredPvnaTolerance = activeMatch.configured_pvna_tolerance ?? pvnaTolerance
  const autoPvnaRelaxed = effectivePvnaTolerance > configuredPvnaTolerance && Boolean(pvnaTradeoff)
  const fairnessReasonText = activeMatch.fairness_reasons?.length ? activeMatch.fairness_reasons.join(', ') : null
  const fairnessReasonDetails = activeMatch.fairness_reason_details ?? []
  const hasPvnaTradeoff = pvnaCapExceeded || Boolean(pvnaTradeoff)
  const hasRepeatTradeoff = Boolean(repeatTradeoff)
  const approvalSummary = hasPvnaTradeoff && hasRepeatTradeoff
    ? 'Trận này vượt cả cap PVNA và cap lặp. Duyệt nghĩa là host chấp nhận trận hiện tại dù chưa đạt hai giới hạn chính.'
    : hasPvnaTradeoff
      ? 'Trận này vượt cap PVNA. Duyệt nghĩa là host chấp nhận chênh trình lớn hơn giới hạn hiện tại.'
      : 'Trận này vượt cap lặp. Duyệt nghĩa là host chấp nhận một hoặc nhiều cặp/người chơi lặp quá giới hạn.'
  const bestEffortSummary = hasPvnaTradeoff && hasRepeatTradeoff
    ? 'Engine đã thử giữ cả PVNA và lặp trước; trong pool hiện tại không còn trận thỏa cả hai nên đây là phương án ít vi phạm nhất tìm được.'
    : hasPvnaTradeoff
      ? 'Engine đã ưu tiên giữ cap PVNA; trận này chỉ xuất hiện khi không còn phương án trong cap tốt hơn theo thứ tự ưu tiên hiện tại.'
      : 'Engine đã ưu tiên tránh lặp; trận này chỉ xuất hiện khi không còn phương án trong cap lặp tốt hơn theo thứ tự ưu tiên hiện tại.'
  const [repeatTradeoffApproved, setRepeatTradeoffApproved] = useState(false)
  useEffect(() => {
    setRepeatTradeoffApproved(false)
  }, [selectedChoiceId])
  const startDisabled = busy
  const tradeoffSummaryLines: string[] = []
  const visiblePvnaOverBy = pvnaTradeoff?.over_by ?? pvnaOverBy
  if (visiblePvnaOverBy > 0) {
    tradeoffSummaryLines.push(`PVNA +${formatNumber(visiblePvnaOverBy, 2)} so với cap ${formatNumber(configuredPvnaTolerance, 2)}`)
  }
  if (repeatTradeoff && (repeatTradeoff.over_by ?? 0) > 0) {
    tradeoffSummaryLines.push(`lặp +${repeatTradeoff.over_by}`)
  }
  return (
    <View style={{ borderRadius: RADIUS.lg, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, overflow: 'hidden', ...LAYOUT_SHADOW.sm }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}>
        <MatchTile match={toMatch(activeMatch)} state={state} pvnaTolerance={pvnaTolerance} playersById={playersById} onPlayerPress={onPlayerPress} embedded showSwapBadges />
      </View>
      {tradeoffSummaryLines.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: tradeoffChoices.length > 1 ? 8 : 12 }}>
          <View style={{ borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, paddingTop: 9 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
              Trade-off: {tradeoffSummaryLines.join(' · ')}
            </Text>
          </View>
        </View>
      ) : null}
      {tradeoffChoices.length > 1 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline, fontWeight: '900', textTransform: 'uppercase' }}>
            Chọn đánh đổi
          </Text>
          <View style={{ gap: 8 }}>
            {tradeoffChoices.map(choice => {
              const selected = choice.id === selectedChoice?.id
              const overPvna = choice.metrics.pvna_over_by > 0
              const overRepeat = choice.metrics.repeat_over_by > 0
              return (
                <Pressable
                  key={choice.id}
                  onPress={() => setSelectedChoiceId(choice.id)}
                  style={{
                    borderRadius: RADIUS.sm,
                    borderWidth: selected ? 1.5 : BORDER.hairline,
                    borderColor: selected ? theme.primary : theme.outlineVariant,
                    backgroundColor: selected ? theme.secondaryContainer : theme.surface,
                    padding: 10,
                    gap: 5,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 12, color: selected ? theme.primary : theme.onSurface, fontWeight: '900' }}>
                      {choice.label}{choice.id === match.recommended_tradeoff_choice ? ' · Đề xuất' : ''}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: selected ? theme.primary : theme.outline }}>
                      PVNA {formatNumber(choice.metrics.pvna_gap, 2)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: selected ? theme.onSurface : theme.outline }}>
                    {overPvna ? `Vượt PVNA +${formatNumber(choice.metrics.pvna_over_by, 2)}` : `Trong PVNA cap ${formatNumber(configuredPvnaTolerance, 2)}`} · {overRepeat ? `lặp vượt ${choice.metrics.repeat_over_by}` : 'không vượt cap lặp'}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: selected ? theme.onSurface : theme.outline }}>
                    Nặng nhất: partner {choice.metrics.max_partner_pair} lần, đối thủ {choice.metrics.max_opponent_pair} lần
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}
      {false ? (
        <View style={{ marginHorizontal: 14, marginBottom: 12, borderRadius: RADIUS.md, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, backgroundColor: theme.warningBg, padding: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={16} color={theme.warningText} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.warningText, fontWeight: '900' }}>
                Trận vượt giới hạn
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.warningText }}>
                {approvalSummary}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                {bestEffortSummary}
              </Text>
              <Text style={{ display: 'none', fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.warningText }}>
                {requiresRepeatApproval
                  ? 'Không còn phương án thỏa tất cả điều kiện. Host cần duyệt trade-off giữa chênh PVNA và lặp partner/đối thủ trước khi bắt đầu.'
                  : 'Trận này vẫn nằm trong cap, nhưng đã chạm giới hạn lặp partner/đối thủ. Trận sau cùng cặp này sẽ cần host duyệt.'}
              </Text>
              {pvnaTradeoff ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                  PVNA vượt tolerance {formatNumber(pvnaTradeoff.over_by ?? 0, 2)}
                </Text>
              ) : pvnaCapExceeded ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                  PVNA vượt tolerance {formatNumber(pvnaOverBy, 2)}
                </Text>
              ) : null}
              {autoPvnaRelaxed ? (
                <View style={{ gap: 3 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                    Engine đang nới PVNA lên {formatNumber(effectivePvnaTolerance, 2)}
                    {fairnessReasonText ? ` vì ${fairnessReasonText}` : ''}
                  </Text>
                  {fairnessReasonDetails.map((line, index) => (
                    <Text key={`${line}-${index}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}
              {repeatTradeoff ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                  Lặp vượt cap {repeatTradeoff.over_by ?? 0} điểm trên {repeatTradeoff.affected_pairs ?? 0} cặp
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pressable
              onPress={onOpenSettings}
              style={{ minHeight: 34, borderRadius: RADIUS.sm, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, backgroundColor: theme.surface, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }}
            >
              <Settings size={15} color={theme.warningStrong} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.warningStrong, fontWeight: '900' }}>
                Chỉnh PVNA
              </Text>
            </Pressable>
            <View style={{ minHeight: 34, borderRadius: RADIUS.sm, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, backgroundColor: theme.warningBg, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.warningText, fontWeight: '800' }}>
                Bấm avatar để đổi người
              </Text>
            </View>
          </View>
          {requiresRepeatApproval ? (
            <Pressable
              onPress={() => setRepeatTradeoffApproved(value => !value)}
              style={{ minHeight: 36, borderRadius: RADIUS.sm, borderWidth: BORDER.hairline, borderColor: repeatTradeoffApproved ? theme.warningStrong : theme.outlineVariant, backgroundColor: repeatTradeoffApproved ? theme.surface : theme.warningBg, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <ShieldCheck size={16} color={repeatTradeoffApproved ? theme.warningStrong : theme.warningText} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: repeatTradeoffApproved ? theme.warningStrong : theme.warningText, fontWeight: '900' }}>
                {repeatTradeoffApproved ? 'Đã chấp nhận trận này' : 'Chấp nhận trận này'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{ backgroundColor: theme.surfaceContainerLow, borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, padding: 14 }}>
        <TouchableOpacity
          onPress={() => onStart(activeMatch)}
          disabled={startDisabled}
          style={{ height: 44, borderRadius: RADIUS.md, backgroundColor: startDisabled ? theme.outlineVariant : theme.primary, alignItems: 'center', justifyContent: 'center', ...LAYOUT_SHADOW.xs }}
        >
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Bắt đầu trận</Text>}
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={() => {}}
        disabled
        style={{ display: 'none', marginTop: 8, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.dangerBg, alignItems: 'center', justifyContent: 'center' }}
      >
        {cancelBusy ? <ActivityIndicator color={theme.dangerText} /> : <Text style={ctaTextStyle(theme.dangerText, 12)}>Hủy trận</Text>}
      </TouchableOpacity>
    </View>
  )
}

function LiveMatchScoreBoard({
  match,
  score,
  busy,
  cancelBusy,
  state,
  playersById,
  onScoreChange,
  onComplete,
  onCancel,
}: {
  match: SessionLiveMatchRow
  score: { a: number; b: number }
  busy: boolean
  cancelBusy: boolean
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onScoreChange: (matchId: string, side: 'a' | 'b', delta: number) => void
  onComplete: (match: SessionLiveMatchRow) => void
  onCancel: (match: SessionLiveMatchRow) => void
}) {
  const theme = useAppTheme()
  const startedAt = match.started_at ?? match.suggested_at ?? match.created_at
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: RADIUS.xl, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, overflow: 'hidden', ...LAYOUT_SHADOW.sm }}>
      <View style={{ backgroundColor: theme.surfaceContainerLow, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: BORDER.hairline, borderBottomColor: theme.outlineVariant }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: theme.primary, fontWeight: '800' }}>TRẬN ĐẤU LIVE</Text>
          <View style={{ backgroundColor: theme.surface, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: theme.outline, fontWeight: '800' }}>Sân {(match.court_idx ?? 0) + 1}</Text>
          </View>
        </View>
        {startedAt ? (
          <View style={{ backgroundColor: theme.onSurface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.xs }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.surface, fontWeight: '700' }}>
              {new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <LiveScoreTeam
            score={score.a}
            opponentScore={score.b}
            team={match.team_a}
            state={state}
            playersById={playersById}
            onMinus={() => onScoreChange(match.id, 'a', -1)}
            onPlus={() => onScoreChange(match.id, 'a', 1)}
          />
          <View style={{ paddingHorizontal: 8, paddingTop: LIVE_SCORE_CARD_HEIGHT / 2 - 2, alignItems: 'center' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.outlineVariant, fontWeight: '900' }}>VS</Text>
          </View>
          <LiveScoreTeam
            score={score.b}
            opponentScore={score.a}
            team={match.team_b}
            state={state}
            playersById={playersById}
            onMinus={() => onScoreChange(match.id, 'b', -1)}
            onPlus={() => onScoreChange(match.id, 'b', 1)}
          />
        </View>
        <Pressable
          onPress={() => {
            if (__DEV__) console.log('[NextRoundSuggesterV2] complete button tapped', { matchId: match.id })
            onComplete(match)
          }}
          hitSlop={8}
          disabled={busy || cancelBusy}
          style={{ marginTop: 4, minHeight: 44, borderRadius: RADIUS.lg, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', ...LAYOUT_SHADOW.sm }}
        >
          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Kết thúc trận</Text>}
        </Pressable>
        <Pressable
          onPress={() => {
            if (__DEV__) console.log('[NextRoundSuggesterV2] cancel button tapped', { matchId: match.id })
            onCancel(match)
          }}
          hitSlop={8}
          disabled={busy || cancelBusy}
          style={{ marginTop: 8, minHeight: 42, borderRadius: RADIUS.lg, backgroundColor: theme.dangerBg, alignItems: 'center', justifyContent: 'center' }}
        >
          {cancelBusy ? <ActivityIndicator color={theme.dangerText} /> : <Text style={ctaTextStyle(theme.dangerText, 12)}>Hủy trận</Text>}
        </Pressable>
      </View>
    </View>
  )
}

function LiveScoreTeam({
  score,
  opponentScore,
  team,
  state,
  playersById,
  onMinus,
  onPlus,
}: {
  score: number
  opponentScore: number
  team: [string, string]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onMinus: () => void
  onPlus: () => void
}) {
  const theme = useAppTheme()
  const winning = score > opponentScore
  return (
    <View style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          onPress={onMinus}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.surfaceContainerLow,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: BORDER.hairline,
            borderColor: theme.outlineVariant,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Minus size={18} color={theme.outline} />
        </Pressable>
        <View style={{ width: LIVE_SCORE_CARD_WIDTH, height: LIVE_SCORE_CARD_HEIGHT, backgroundColor: theme.surfaceContainerLow, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: winning ? theme.primary : theme.outlineVariant, ...LAYOUT_SHADOW.sm }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: LIVE_SCORE_FONT_SIZE, color: winning ? theme.primary : theme.onSurface, fontWeight: '900' }}>{score}</Text>
        </View>
        <Pressable
          onPress={onPlus}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.82 : 1,
            ...LAYOUT_SHADOW.sm,
          })}
        >
          <Plus size={18} color={theme.onPrimary} />
        </Pressable>
      </View>
      <Text style={{ marginTop: 8, textAlign: 'center', fontFamily: SCREEN_FONTS.headline, fontSize: 12, lineHeight: 18, color: theme.onSurface, fontWeight: '700' }}>
        {team.map(playerId => playerName(playerId, playersById)).join(' · ')}
      </Text>
      <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 10, color: theme.outline }}>
        Tổng PVNA {getTeamPvna(team, state).toFixed(2)}
      </Text>
    </View>
  )
}

function LiveMatchScoreCard({
  match,
  score,
  busy,
  state,
  playersById,
  onScoreChange,
  onComplete,
}: {
  match: SessionLiveMatchRow
  score: { a: number; b: number }
  busy: boolean
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onScoreChange: (matchId: string, side: 'a' | 'b', delta: number) => void
  onComplete: (match: SessionLiveMatchRow) => void
}) {
  const theme = useAppTheme()
  return (
    <Card style={{ padding: 12, borderColor: theme.primary }}>
      <MatchTile match={toMatch(match)} state={state} playersById={playersById} onPlayerPress={() => {}} />
      <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ScoreStepper value={score.a} onMinus={() => onScoreChange(match.id, 'a', -1)} onPlus={() => onScoreChange(match.id, 'a', 1)} />
        <Text style={ctaTextStyle(theme.outline, 11)}>VS</Text>
        <ScoreStepper value={score.b} onMinus={() => onScoreChange(match.id, 'b', -1)} onPlus={() => onScoreChange(match.id, 'b', 1)} />
      </View>
      <TouchableOpacity
        onPress={() => onComplete(match)}
        disabled={busy}
        style={{ marginTop: 12, height: 42, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Kết thúc trận</Text>}
      </TouchableOpacity>
    </Card>
  )
}

function ScoreStepper({ value, onMinus, onPlus }: { value: number; onMinus: () => void; onPlus: () => void }) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TouchableOpacity onPress={onMinus} style={{ width: 32, height: 32, borderRadius: RADIUS.full, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={ctaTextStyle(theme.primary, 16)}>-</Text>
      </TouchableOpacity>
      <Text style={{ width: 34, textAlign: 'center', fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 30, color: theme.onSurface }}>{value}</Text>
      <TouchableOpacity onPress={onPlus} style={{ width: 32, height: 32, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={ctaTextStyle(theme.primary, 16)}>+</Text>
      </TouchableOpacity>
    </View>
  )
}

function MatchList({
  title,
  matches,
  state,
  playersById,
  onPlayerPress,
}: {
  title: string
  matches: Match[]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>{title}</Text>
      <View style={{ gap: 10 }}>
        {matches.map(match => (
          <MatchTile
            key={`match-${match.court_idx}-${match.team_a.join('-')}-${match.team_b.join('-')}`}
            match={match}
            state={state}
            playersById={playersById}
            onPlayerPress={onPlayerPress}
          />
        ))}
      </View>
    </View>
  )
}

function MatchTile({
  match,
  state,
  pvnaTolerance,
  playersById,
  onPlayerPress,
  embedded = false,
  showSwapBadges = false,
}: {
  match: Match
  state: SessionState
  pvnaTolerance?: number
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
  embedded?: boolean
  showSwapBadges?: boolean
}) {
  const theme = useAppTheme()
  const diff = useMemo(
    () => Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state)),
    [match.team_a, match.team_b, state],
  )
  const effectivePvnaTolerance = pvnaTolerance ?? state.config.pvna_tolerance
  const pvnaCapExceeded = diff > effectivePvnaTolerance
  const scored = useMemo(
    () => match.stats && match.score != null ? { score: match.score, stats: match.stats } : scoreMatch(match.team_a, match.team_b, state),
    [match, state],
  )
  const repeatCap = useMemo(
    () => getProjectedRepeatCapSummary(match, state),
    [match, state],
  )
  const repeatCapExceeded =
    repeatCap.max_partner_pair_count > MAX_PROJECTED_PARTNER_PAIR_COUNT ||
    repeatCap.max_opponent_pair_count > MAX_PROJECTED_OPPONENT_PAIR_COUNT ||
    repeatCap.max_repeated_partners_per_player > MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER ||
    repeatCap.max_repeated_opponents_per_player > MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER
  const repeatDetails = useMemo(
    () => getRepeatDetailLines(match, state, playersById),
    [match, playersById, state],
  )
  const [repeatExpanded, setRepeatExpanded] = useState(false)
  const maxRepeatPair = Math.max(
    repeatCap.max_partner_pair_count,
    repeatCap.max_opponent_pair_count,
  )
  const partnerRepeatOver = repeatCap.max_partner_pair_count > MAX_PROJECTED_PARTNER_PAIR_COUNT
  const opponentRepeatOver = repeatCap.max_opponent_pair_count > MAX_PROJECTED_OPPONENT_PAIR_COUNT
  const repeatVisualLevel = repeatCapExceeded ? 3 : maxRepeatPair >= 2 ? 2 : maxRepeatPair > 0 ? 1 : 0
  const repeatIndicatorColor = repeatCapExceeded ? theme.warningText : repeatVisualLevel >= 2 ? theme.primary : theme.outline
  const content = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ borderRadius: RADIUS.xs, backgroundColor: theme.secondaryContainer, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Text style={ctaTextStyle(theme.primary, 11)}>{match.court_idx + 1}</Text>
          </View>
          <Text style={eyebrowStyle(theme.outline)}>Sân {match.court_idx + 1}</Text>
        </View>
        <View style={{ borderRadius: RADIUS.full, backgroundColor: pvnaCapExceeded ? theme.warningBg : theme.secondaryContainer, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: pvnaCapExceeded ? theme.warningText : theme.primary }}>
            Chênh {diff.toFixed(2)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TeamBlock team={match.team_a} state={state} playersById={playersById} onPlayerPress={onPlayerPress} align="left" showSwapBadges={showSwapBadges} />
        <View style={{ width: 30, height: 26, borderRadius: RADIUS.xs, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={ctaTextStyle(theme.outline, 10)}>VS</Text>
        </View>
        <TeamBlock team={match.team_b} state={state} playersById={playersById} onPlayerPress={onPlayerPress} align="right" showSwapBadges={showSwapBadges} />
      </View>
      <Text style={{ display: 'none', marginTop: 10, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: repeatCapExceeded ? theme.warningText : theme.outline }}>
        Điểm ghép {Number.isFinite(scored.score) ? scored.score.toFixed(1) : '-'} · Partner lặp {scored.stats.partner_repeats} · Đối thủ lặp {scored.stats.opponent_repeats}
      </Text>
      <Text style={{ display: 'none', marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: repeatCapExceeded ? theme.warningText : theme.outline }}>
        Max sau trận: partner {repeatCap.maxPartner}/{MAX_PROJECTED_PARTNER_PAIR_COUNT} · đối thủ {repeatCap.maxOpponent}/{MAX_PROJECTED_OPPONENT_PAIR_COUNT}
      </Text>
      {repeatDetails.pairLines.length > 0 ? (
        <RepeatCompactSummary
          expanded={repeatExpanded}
          onToggle={() => setRepeatExpanded(value => !value)}
          partnerCount={repeatCap.max_partner_pair_count}
          opponentCount={repeatCap.max_opponent_pair_count}
          partnerPairs={repeatDetails.partnerPairs}
          opponentPairs={repeatDetails.opponentPairs}
          playersById={playersById}
          exceeded={repeatCapExceeded}
        />
      ) : null}
      {false && repeatDetails.pairLines.length > 0 ? (
        <Pressable
          onPress={() => setRepeatExpanded(value => !value)}
          style={{
            marginTop: 12,
            borderRadius: RADIUS.sm,
            borderWidth: BORDER.hairline,
            borderColor: repeatCapExceeded ? theme.warningStrong : theme.outlineVariant,
            backgroundColor: repeatCapExceeded ? theme.warningBg : theme.surfaceContainerLow,
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <View style={{ display: 'none', flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
                {[1, 2, 3].map(level => (
                  <View
                    key={level}
                    style={{
                      width: 5,
                      height: 5 + level * 4,
                      borderRadius: RADIUS.full,
                      backgroundColor: repeatVisualLevel >= level ? repeatIndicatorColor : theme.outlineVariant,
                    }}
                  />
                ))}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10.5, color: repeatCapExceeded ? theme.warningText : theme.outline, fontWeight: '900', textTransform: 'uppercase' }}>
                  Lặp cặp
                </Text>
                <Text numberOfLines={1} style={{ display: 'none', marginTop: 1, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: repeatCapExceeded ? theme.warningText : theme.outline }}>
                  Partner {repeatCap.max_partner_pair_count}/{MAX_PROJECTED_PARTNER_PAIR_COUNT} · Đối thủ {repeatCap.max_opponent_pair_count}/{MAX_PROJECTED_OPPONENT_PAIR_COUNT}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.surface, paddingHorizontal: 7, paddingVertical: 2, borderWidth: BORDER.hairline, borderColor: repeatCapExceeded ? theme.warningStrong : theme.outlineVariant }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9.5, color: repeatCapExceeded ? theme.warningText : theme.outline, fontWeight: '800' }}>
                  {repeatCapExceeded ? 'Vượt cap' : 'Trong cap'}
                </Text>
              </View>
              <ChevronDown
                size={15}
                color={repeatCapExceeded ? theme.warningText : theme.outline}
                style={{ transform: [{ rotate: repeatExpanded ? '180deg' : '0deg' }] }}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, borderRadius: RADIUS.sm, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: partnerRepeatOver ? theme.warningStrong : theme.outlineVariant, paddingHorizontal: 9, paddingVertical: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 22, height: 22, borderRadius: RADIUS.full, backgroundColor: partnerRepeatOver ? theme.warningBg : theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 12, lineHeight: 16 }}>🤝</Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, lineHeight: 16, color: partnerRepeatOver ? theme.warningText : theme.outline, textTransform: 'uppercase' }}>
                    Partner
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, lineHeight: 22, color: partnerRepeatOver ? theme.warningText : theme.onSurface }}>
                  {repeatCap.max_partner_pair_count}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, borderRadius: RADIUS.sm, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: opponentRepeatOver ? theme.warningStrong : theme.outlineVariant, paddingHorizontal: 9, paddingVertical: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 22, height: 22, borderRadius: RADIUS.full, backgroundColor: opponentRepeatOver ? theme.warningBg : theme.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 12, lineHeight: 16 }}>⚔️</Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, lineHeight: 16, color: opponentRepeatOver ? theme.warningText : theme.outline, textTransform: 'uppercase' }}>
                    Đối thủ
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, lineHeight: 22, color: opponentRepeatOver ? theme.warningText : theme.onSurface }}>
                  {repeatCap.max_opponent_pair_count}
                </Text>
              </View>
            </View>
          </View>
          {repeatExpanded ? (
            <RepeatExpandedConnectionVisual
              partnerPairs={repeatDetails.partnerPairs}
              opponentPairs={repeatDetails.opponentPairs}
              playersById={playersById}
            />
          ) : null}
        </Pressable>
      ) : null}
      {false && repeatDetails.pairLines.length > 0 ? (
        <View
          style={{
            marginTop: 12,
            borderRadius: RADIUS.sm,
            borderWidth: BORDER.hairline,
            borderColor: repeatCapExceeded ? theme.warningStrong : theme.outlineVariant,
            backgroundColor: repeatCapExceeded ? theme.warningBg : theme.surfaceContainerLow,
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 5,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} color={repeatCapExceeded ? theme.warningText : theme.outline} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10.5, color: repeatCapExceeded ? theme.warningText : theme.outline, fontWeight: '900', textTransform: 'uppercase' }}>
                Lặp cặp
              </Text>
            </View>
            <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.surface, paddingHorizontal: 7, paddingVertical: 2, borderWidth: BORDER.hairline, borderColor: repeatCapExceeded ? theme.warningStrong : theme.outlineVariant }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9.5, color: repeatCapExceeded ? theme.warningText : theme.outline, fontWeight: '800' }}>
                {repeatCapExceeded ? 'Vượt cap' : 'Trong cap'}
              </Text>
            </View>
          </View>
          {repeatDetails.pairLines.slice(0, 2).map(line => (
            <Text key={line} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, lineHeight: 14, color: repeatCapExceeded ? theme.warningText : theme.outline }}>
              {line}
            </Text>
          ))}
          {repeatDetails.hiddenCount > 0 ? (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10.5, lineHeight: 14, color: repeatCapExceeded ? theme.warningText : theme.outline, fontWeight: '800' }}>
              +{repeatDetails.hiddenCount} cặp khác
            </Text>
          ) : null}
        </View>
      ) : null}
      {repeatExpanded && repeatDetails.playerLines.length > 0 ? (
        <View style={{ marginTop: 5, gap: 2 }}>
          {repeatDetails.playerLines.map(line => (
            <Text key={line} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, lineHeight: 14, color: repeatCapExceeded ? theme.warningText : theme.outline }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  )
  if (embedded) {
    return <View>{content}</View>
  }
  return <Card style={{ padding: 12 }}>{content}</Card>
}

type RepeatVisualPair = {
  playerA: string
  playerB: string
  currentCount: number
  projectedCount: number
}

function RepeatCompactSummary({
  expanded,
  onToggle,
  partnerCount,
  opponentCount,
  partnerPairs,
  opponentPairs,
  playersById,
  exceeded,
}: {
  expanded: boolean
  onToggle: () => void
  partnerCount: number
  opponentCount: number
  partnerPairs: RepeatVisualPair[]
  opponentPairs: RepeatVisualPair[]
  playersById: Map<string, ArrangementPlayer>
  exceeded: boolean
}) {
  const theme = useAppTheme()
  const visiblePartnerPairs = partnerPairs.filter(pair => pair.currentCount > 0)
  const visibleOpponentPairs = opponentPairs.filter(pair => pair.currentCount > 0)
  const showPartnerChip = partnerCount > 1
  const showOpponentChip = opponentCount > 1
  const textColor = theme.warningText
  return (
    <View style={{ marginTop: 10 }}>
      <Pressable onPress={onToggle} style={{ minHeight: 34, borderRadius: RADIUS.sm, backgroundColor: theme.warningBg, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {showPartnerChip ? <RepeatSummaryChip icon="🤝" label="Lặp partner" count={partnerCount} strong={partnerCount > MAX_PROJECTED_PARTNER_PAIR_COUNT} /> : null}
        {showOpponentChip ? <RepeatSummaryChip icon="⚔️" label="Lặp đối thủ" count={opponentCount} strong={opponentCount > MAX_PROJECTED_OPPONENT_PAIR_COUNT} /> : null}
        <ChevronDown size={15} color={textColor} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: 10, paddingTop: 8, gap: 6 }}>
          {[...visiblePartnerPairs.map(pair => ({ icon: '🤝', pair })), ...visibleOpponentPairs.map(pair => ({ icon: '⚔️', pair }))].map((item, index) => (
            <React.Fragment key={`${item.icon}-${item.pair.playerA}-${item.pair.playerB}`}>
              {index > 0 ? <View style={{ height: BORDER.hairline, backgroundColor: theme.outlineVariant }} /> : null}
              <RepeatInlineDetail icon={item.icon} pair={item.pair} playersById={playersById} />
            </React.Fragment>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function RepeatSummaryChip({
  icon,
  label,
  count,
  strong,
}: {
  icon: string
  label: string
  count: number
  strong: boolean
}) {
  const theme = useAppTheme()
  const color = strong ? theme.warningStrong : theme.warningText
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 12, lineHeight: 16 }}>{icon}</Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 12, lineHeight: 15, color, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 17, lineHeight: 19, color }}>
        {count}
      </Text>
    </View>
  )
}

function RepeatInlineDetail({
  icon,
  pair,
  playersById,
}: {
  icon: string
  pair: RepeatVisualPair
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const over = pair.projectedCount > 2
  const color = over ? theme.warningText : theme.onSurface
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Text style={{ width: 18, fontSize: 12, lineHeight: 16 }}>{icon}</Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 16, color }}>
        {playerName(pair.playerA, playersById)} · {playerName(pair.playerB, playersById)}
      </Text>
      <Text style={{ minWidth: 24, textAlign: 'right', fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 12, lineHeight: 14, color: over ? theme.warningStrong : theme.warningText }}>
        ×{pair.projectedCount}
      </Text>
    </View>
  )
}

function RepeatExpandedVisual({
  partnerPairs,
  opponentPairs,
  playersById,
}: {
  partnerPairs: RepeatVisualPair[]
  opponentPairs: RepeatVisualPair[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const countTone = (count: number) => {
    if (count > 2) return { bg: theme.warningBg, fg: theme.warningText, border: theme.warningStrong }
    if (count === 2) return { bg: theme.rescueSoft, fg: theme.rescueAccent, border: theme.rescueAccent }
    return { bg: theme.successBg, fg: theme.successText, border: theme.secondaryContainer }
  }
  return (
    <View style={{ marginTop: 3, gap: 8 }}>
      {partnerPairs.length > 0 ? (
        <View style={{ gap: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, lineHeight: 15, color: theme.outline, textTransform: 'uppercase' }}>
            Partner
          </Text>
          <View style={{ borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
            {partnerPairs.map((pair, index) => {
              const tone = countTone(pair.projectedCount)
              return (
                <View
                  key={`partner-${pair.playerA}-${pair.playerB}`}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: tone.bg,
                    borderTopWidth: index === 0 ? 0 : BORDER.hairline,
                    borderTopColor: theme.outlineVariant,
                  }}
                >
                  <RepeatPlayerCell playerId={pair.playerA} playersById={playersById} align="left" />
                  <View style={{ width: 74, alignItems: 'center', justifyContent: 'center', borderLeftWidth: BORDER.hairline, borderRightWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 21, lineHeight: 23, color: tone.fg }}>
                      {pair.projectedCount}
                    </Text>
                    <Text style={{ marginTop: -1, fontFamily: SCREEN_FONTS.headline, fontSize: 10.5, lineHeight: 12, color: theme.outline, textTransform: 'uppercase' }}>
                      partner
                    </Text>
                  </View>
                  <RepeatPlayerCell playerId={pair.playerB} playersById={playersById} align="right" />
                </View>
              )
            })}
          </View>
        </View>
      ) : null}

      {opponentPairs.length > 0 ? (
        <View style={{ gap: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, lineHeight: 15, color: theme.outline, textTransform: 'uppercase' }}>
            Đối thủ
          </Text>
          <View style={{ gap: 6 }}>
            {opponentPairs.map(pair => {
              const tone = countTone(pair.projectedCount)
              return (
                <View
                  key={`opponent-${pair.playerA}-${pair.playerB}`}
                  style={{
                    minHeight: 42,
                    borderRadius: RADIUS.sm,
                    backgroundColor: tone.bg,
                    borderWidth: BORDER.hairline,
                    borderColor: tone.border,
                    paddingHorizontal: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <RepeatInlinePlayer playerId={pair.playerA} playersById={playersById} />
                  <Text style={{ flex: 1, textAlign: 'center', fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: theme.outline, textTransform: 'uppercase' }}>
                    vs
                  </Text>
                  <RepeatInlinePlayer playerId={pair.playerB} playersById={playersById} reverse />
                  <Text style={{ minWidth: 24, textAlign: 'right', fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 15, color: tone.fg }}>
                    ×{pair.projectedCount}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function RepeatPlayerCell({
  playerId,
  playersById,
  align,
}: {
  playerId: string
  playersById: Map<string, ArrangementPlayer>
  align: 'left' | 'right'
}) {
  const theme = useAppTheme()
  const name = playerName(playerId, playersById)
  return (
    <View style={{ flex: 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start', paddingHorizontal: 10, gap: 3 }}>
      <PlayerAvatar name={name} size={30} />
      <Text numberOfLines={1} style={{ maxWidth: '100%', fontFamily: SCREEN_FONTS.headline, fontSize: 12, lineHeight: 14, color: theme.onSurface }}>
        {name}
      </Text>
    </View>
  )
}

function RepeatInlinePlayer({
  playerId,
  playersById,
  reverse = false,
}: {
  playerId: string
  playersById: Map<string, ArrangementPlayer>
  reverse?: boolean
}) {
  const theme = useAppTheme()
  const name = playerName(playerId, playersById)
  return (
    <View style={{ minWidth: 78, flexDirection: reverse ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
      <PlayerAvatar name={name} size={28} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 13, lineHeight: 15, color: theme.onSurface }}>
        {name}
      </Text>
    </View>
  )
}

function RepeatExpandedConnectionVisual({
  partnerPairs,
  opponentPairs,
  playersById,
}: {
  partnerPairs: RepeatVisualPair[]
  opponentPairs: RepeatVisualPair[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const visiblePartnerPairs = partnerPairs.filter(pair => pair.currentCount > 0)
  const visibleOpponentPairs = opponentPairs.filter(pair => pair.currentCount > 0)
  return (
    <View style={{ marginTop: 3, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 8, gap: 8 }}>
      {visiblePartnerPairs.length > 0 ? (
        <RepeatConnectionSection
          title="PARTNER"
          pairs={visiblePartnerPairs}
          playersById={playersById}
        />
      ) : null}
      {visibleOpponentPairs.length > 0 ? (
        <>
          {visiblePartnerPairs.length > 0 ? <View style={{ height: BORDER.hairline, backgroundColor: theme.outlineVariant }} /> : null}
          <RepeatConnectionSection
            title={"\u0110\u1ed0I TH\u1ee6"}
            pairs={visibleOpponentPairs}
            playersById={playersById}
          />
        </>
      ) : null}
    </View>
  )
}

function RepeatConnectionSection({
  title,
  pairs,
  playersById,
}: {
  title: string
  pairs: RepeatVisualPair[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, lineHeight: 13, color: theme.outline, textTransform: 'uppercase' }}>
        {title}
      </Text>
      <View style={{ gap: 5 }}>
        {pairs.map(pair => (
          <RepeatConnectionRow
            key={`${title}-${pair.playerA}-${pair.playerB}`}
            pair={pair}
            playersById={playersById}
          />
        ))}
      </View>
    </View>
  )
}

function RepeatConnectionRow({
  pair,
  playersById,
}: {
  pair: RepeatVisualPair
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const leftName = playerName(pair.playerA, playersById)
  const rightName = playerName(pair.playerB, playersById)
  const over = pair.projectedCount > 2
  const tone = over
    ? { bg: theme.dangerBg, fg: theme.dangerText, line: theme.dangerText, badgeBg: theme.dangerBg }
    : { bg: theme.surfaceContainerLow, fg: theme.rescueAccent, line: theme.rescueAccent, badgeBg: theme.warningBg }
  return (
    <View style={{ minHeight: 50, borderRadius: RADIUS.sm, backgroundColor: tone.bg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 8 }}>
      <RepeatConnectionPlayer name={leftName} />
      <View style={{ flex: 1, minWidth: 0, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, height: BORDER.hairline, backgroundColor: tone.line }} />
        <View style={{ borderRadius: RADIUS.full, backgroundColor: tone.badgeBg, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 11, lineHeight: 13, color: tone.fg }}>
            *{pair.projectedCount}
          </Text>
        </View>
      </View>
      <RepeatConnectionPlayer name={rightName} />
    </View>
  )
}

function RepeatConnectionPlayer({ name }: { name: string }) {
  const theme = useAppTheme()
  return (
    <View style={{ width: 36, alignItems: 'center', gap: 2 }}>
      <PlayerAvatar name={name} size={26} />
      <Text numberOfLines={1} style={{ maxWidth: 44, fontFamily: SCREEN_FONTS.headline, fontSize: 10, lineHeight: 12, color: theme.outline }}>
        {name}
      </Text>
    </View>
  )
}

function TeamBlock({
  team,
  state,
  playersById,
  onPlayerPress,
  align,
  showSwapBadges = false,
}: {
  team: [string, string]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
  align: 'left' | 'right'
  showSwapBadges?: boolean
}) {
  const theme = useAppTheme()
  const names = team.map(id => playerName(id, playersById))
  return (
    <View style={{ flex: 1, alignItems: showSwapBadges ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
      <View style={{ flexDirection: showSwapBadges ? 'row' : align === 'right' ? 'row-reverse' : 'row', marginBottom: 8, gap: showSwapBadges ? 10 : 0, justifyContent: showSwapBadges ? 'center' : 'flex-start' }}>
        {team.map((id, index) => (
          <TouchableOpacity
            key={id}
            onPress={() => onPlayerPress(id)}
            activeOpacity={0.76}
            style={{
              marginLeft: showSwapBadges || align === 'right' ? 0 : index === 0 ? 0 : -8,
              marginRight: showSwapBadges ? 0 : align === 'right' && index > 0 ? -8 : 0,
              position: 'relative',
            }}
          >
            <PlayerAvatar name={playerName(id, playersById)} size={showSwapBadges ? 44 : 30} />
            {showSwapBadges ? (
              <View style={{ position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.primary, borderWidth: 2, borderColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Repeat2 size={10} color={theme.onPrimary} strokeWidth={3} />
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: theme.onSurface, textAlign: showSwapBadges ? 'center' : align }}>
        {names.join(' · ')}
      </Text>
      <View style={{ marginTop: 5, borderRadius: RADIUS.full, backgroundColor: theme.secondaryContainer, paddingHorizontal: 8, paddingVertical: 3, alignSelf: showSwapBadges ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10.5, color: theme.primary, fontWeight: '900' }}>
          PVNA {getTeamPvna(team, state).toFixed(2)}
        </Text>
      </View>
      <Text style={{ display: 'none', marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
        Tổng PVNA {getTeamPvna(team, state).toFixed(2)}
      </Text>
    </View>
  )
}

function RestingRow({ resting, playersById }: { resting: string[]; playersById: Map<string, ArrangementPlayer> }) {
  const theme = useAppTheme()
  const hasRest = resting.length > 0
  return (
    <View style={{ marginTop: 12, borderRadius: RADIUS.md, backgroundColor: hasRest ? theme.rescueSoft : theme.successBg, padding: 12, borderWidth: BORDER.hairline, borderColor: hasRest ? theme.rescueAccent : theme.secondaryContainer }}>
      <Text style={eyebrowStyle(hasRest ? theme.rescueAccent : theme.successText)}>
        {hasRest ? 'Nghỉ vòng này' : 'Không có người nghỉ'}
      </Text>
      {hasRest ? (
        <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface }}>
          {resting.map(id => playerName(id, playersById)).join(', ')}
        </Text>
      ) : null}
    </View>
  )
}

const EMPTY_PLAN_TEXT = {
  defaultTitle: 'Ch\u01b0a c\u00f3 g\u1ee3i \u00fd v\u00f2ng',
  blockedTitle: 'Ch\u01b0a x\u1ebfp \u0111\u01b0\u1ee3c v\u00f2ng',
  defaultBody: 'C\u1eadp nh\u1eadt danh s\u00e1ch ng\u01b0\u1eddi ch\u01a1i tr\u01b0\u1edbc, sau \u0111\u00f3 h\u1ec7 th\u1ed1ng s\u1ebd t\u1ea1o ph\u01b0\u01a1ng \u00e1n cho v\u00f2ng k\u1ebf.',
  capacityBody: (mustPlay: number, slots: number, courts: number) =>
    `${mustPlay} ng\u01b0\u1eddi \u0111ang c\u1ea7n \u01b0u ti\u00ean ch\u01a1i, nh\u01b0ng ${courts} s\u00e2n ch\u1ec9 c\u00f3 ${slots} slot. N\u1ebfu b\u1eaft t\u1ea5t c\u1ea3 nh\u00f3m n\u00e0y c\u00f9ng ch\u01a1i th\u00ec ch\u01b0a c\u00f3 c\u00e1ch x\u1ebfp h\u1ee3p l\u1ec7.`,
  noMatchBody: 'Ch\u01b0a t\u00ecm \u0111\u01b0\u1ee3c ph\u01b0\u01a1ng \u00e1n ph\u00f9 h\u1ee3p v\u1edbi danh s\u00e1ch ng\u01b0\u1eddi ch\u01a1i v\u00e0 c\u00e0i \u0111\u1eb7t hi\u1ec7n t\u1ea1i.',
  notEnoughBody: (eligible: number) =>
    `Ch\u1ec9 c\u00f3 ${eligible} ng\u01b0\u1eddi c\u00f3 th\u1ec3 x\u1ebfp ch\u01a1i. C\u1ea7n t\u1ed1i thi\u1ec3u 4 ng\u01b0\u1eddi \u0111\u1ec3 t\u1ea1o 1 tr\u1eadn.`,
  sectionTitle: 'G\u1ee3i \u00fd x\u1eed l\u00fd',
  increaseCourt: (courts: number) => `T\u0103ng l\u00ean ${courts} s\u00e2n n\u1ebfu mu\u1ed1n \u0111\u1ea3m b\u1ea3o nh\u00f3m \u01b0u ti\u00ean \u0111\u01b0\u1ee3c ch\u01a1i.`,
  acceptRest: (resting: number) => `Gi\u1eef s\u1ed1 s\u00e2n hi\u1ec7n t\u1ea1i v\u00e0 ch\u1ea5p nh\u1eadn kho\u1ea3ng ${resting} ng\u01b0\u1eddi ngh\u1ec9 v\u00f2ng n\u00e0y.`,
  openSettingsHint: 'M\u1edf c\u00e0i \u0111\u1eb7t \u0111\u1ec3 \u0111\u1ed5i s\u1ed1 s\u00e2n ho\u1eb7c n\u1edbi m\u1ee9c c\u00e2n PVNA.',
  sync: 'C\u1eadp nh\u1eadt danh s\u00e1ch ng\u01b0\u1eddi ch\u01a1i',
  settings: 'M\u1edf c\u00e0i \u0111\u1eb7t',
  applyCourts: (courts: number) => `D\u00f9ng ${courts} s\u00e2n`,
}

function getEngineConstraintDiagnostic(
  state: SessionState,
  suggestion: SuggestionResult,
  courtCount: number,
  tierOverrides: Record<string, number>,
) {
  const eligiblePlayers = [...state.players.values()].filter(player => !player.checked_out_at && !player.opted_rest)
  const eligibleCount = eligiblePlayers.length
  const slots = Math.min(Math.max(1, courtCount) * 4, Math.floor(eligibleCount / 4) * 4)
  const mustPlayIds = new Set(eligiblePlayers.filter(player => player.consecutive_rest >= 1).map(player => player.player_id))
  for (const [playerId, tier] of Object.entries(tierOverrides)) {
    if (tier === 0 && eligiblePlayers.some(player => player.player_id === playerId)) mustPlayIds.add(playerId)
  }
  const mustPlayCount = mustPlayIds.size
  const hasCapacityWarning = suggestion.warnings.includes('MUST_PLAY_OVER_CAPACITY')
  const hasNoMatchWarning = suggestion.warnings.includes('NO_VALID_MATCH')
  const hasNotEnoughWarning = suggestion.warnings.includes('NOT_ENOUGH_PRESENT') || slots < 4
  const requiredCourts = Math.max(courtCount + 1, Math.ceil(Math.max(4, mustPlayCount) / 4))
  const restingCount = Math.max(0, eligibleCount - slots)
  const isBlocked = hasCapacityWarning || hasNoMatchWarning || hasNotEnoughWarning
  const body = hasCapacityWarning
    ? EMPTY_PLAN_TEXT.capacityBody(mustPlayCount, slots, courtCount)
    : hasNotEnoughWarning
      ? EMPTY_PLAN_TEXT.notEnoughBody(eligibleCount)
      : hasNoMatchWarning
        ? EMPTY_PLAN_TEXT.noMatchBody
        : EMPTY_PLAN_TEXT.defaultBody
  const suggestions = hasCapacityWarning
    ? [
        EMPTY_PLAN_TEXT.increaseCourt(requiredCourts),
        EMPTY_PLAN_TEXT.acceptRest(restingCount),
        EMPTY_PLAN_TEXT.openSettingsHint,
      ]
    : hasNoMatchWarning
      ? [EMPTY_PLAN_TEXT.openSettingsHint, EMPTY_PLAN_TEXT.acceptRest(restingCount)]
      : []

  return {
    body,
    hasCapacityWarning,
    hasNoMatchWarning,
    hasNotEnoughWarning,
    isBlocked,
    requiredCourts,
    suggestions,
  }
}

function EngineConstraintNotice({
  state,
  suggestion,
  courtCount,
  tierOverrides,
  onSetCourtCount,
  onOpenSettings,
}: {
  state: SessionState
  suggestion: SuggestionResult
  courtCount: number
  tierOverrides: Record<string, number>
  onSetCourtCount: (courts: number) => void
  onOpenSettings: () => void
}) {
  const theme = useAppTheme()
  const diagnostic = getEngineConstraintDiagnostic(state, suggestion, courtCount, tierOverrides)
  if (!diagnostic.isBlocked) return null

  return (
    <Card style={{ marginTop: 12, padding: 12, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderColor: theme.warningStrong }}>
      <Text style={eyebrowStyle(theme.warningText)}>{EMPTY_PLAN_TEXT.blockedTitle}</Text>
      <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>
        {diagnostic.body}
      </Text>
      {diagnostic.suggestions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          {diagnostic.suggestions.map((item, index) => (
            <Text key={`engine-constraint-${index}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
              {`\u2022 ${item}`}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {diagnostic.hasCapacityWarning && diagnostic.requiredCourts > courtCount ? (
          <TouchableOpacity
            onPress={() => onSetCourtCount(diagnostic.requiredCourts)}
            style={{ flex: 1, minHeight: 38, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={ctaTextStyle(theme.primary, 11)}>{EMPTY_PLAN_TEXT.applyCourts(diagnostic.requiredCourts)}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onOpenSettings}
          style={{ flex: 1, minHeight: 38, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={ctaTextStyle(theme.primary, 11)}>{EMPTY_PLAN_TEXT.settings}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  )
}

function PlanningRoundCard({ syncingRoster }: { syncingRoster: boolean }) {
  const theme = useAppTheme()
  return (
    <Card style={{ marginTop: 16, padding: 18, alignItems: 'center', borderColor: theme.outlineVariant }}>
      <ActivityIndicator color={theme.primary} />
      <Text style={{ marginTop: 12, fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface, textAlign: 'center' }}>
        Đang sắp xếp lịch trận đấu
      </Text>
      <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: theme.outline, textAlign: 'center' }}>
        {syncingRoster
          ? 'Đang cập nhật danh sách người chơi vừa điểm danh, sau đó sẽ tạo vòng đầu tiên.'
          : 'Đang tính phương án phù hợp với danh sách người chơi và số sân hiện tại.'}
      </Text>
    </Card>
  )
}

function EmptyPlanCard({
  state,
  suggestion,
  courtCount,
  tierOverrides,
  onSetCourtCount,
  onOpenSettings,
  onSyncRoster,
  busy,
}: {
  state: SessionState
  suggestion: SuggestionResult
  courtCount: number
  tierOverrides: Record<string, number>
  onSetCourtCount: (courts: number) => void
  onOpenSettings: () => void
  onSyncRoster: () => void
  busy: boolean
}) {
  const theme = useAppTheme()
  const diagnostic = getEngineConstraintDiagnostic(state, suggestion, courtCount, tierOverrides)

  return (
    <Card style={{ marginTop: 16, padding: 18, alignItems: 'stretch', borderColor: diagnostic.isBlocked ? theme.warningStrong : theme.outlineVariant }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: diagnostic.isBlocked ? theme.warningText : theme.onSurface, textAlign: 'center' }}>
        {diagnostic.isBlocked ? EMPTY_PLAN_TEXT.blockedTitle : EMPTY_PLAN_TEXT.defaultTitle}
      </Text>
      <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: diagnostic.isBlocked ? theme.warningText : theme.outline, textAlign: 'center' }}>
        {diagnostic.body}
      </Text>

      {diagnostic.suggestions.length > 0 ? (
        <View style={{ marginTop: 14, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, padding: 12 }}>
          <Text style={eyebrowStyle(theme.warningText)}>{EMPTY_PLAN_TEXT.sectionTitle}</Text>
          <View style={{ marginTop: 8, gap: 5 }}>
            {diagnostic.suggestions.map((item, index) => (
              <Text key={`empty-plan-suggestion-${index}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>
                {`\u2022 ${item}`}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        {diagnostic.hasCapacityWarning && diagnostic.requiredCourts > courtCount ? (
          <TouchableOpacity
            onPress={() => onSetCourtCount(diagnostic.requiredCourts)}
            style={{ flex: 1, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={ctaTextStyle(theme.primary, 12)}>{EMPTY_PLAN_TEXT.applyCourts(diagnostic.requiredCourts)}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onOpenSettings}
          style={{ flex: 1, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={ctaTextStyle(theme.primary, 12)}>{EMPTY_PLAN_TEXT.settings}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        testID="nrv2-sync-btn"
        onPress={onSyncRoster}
        disabled={busy}
        style={{ marginTop: 10, minHeight: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 13)}>{EMPTY_PLAN_TEXT.sync}</Text>}
      </TouchableOpacity>
    </Card>
  )
}

type SettingsSnapshot = {
  courtCount: number
  courtPreset: CourtPreset
  pvnaTolerance: number
  courtDurationMin: number
  targetRounds: number
}

function SettingsSheet({
  playerCount,
  initial,
  onApply,
}: {
  playerCount: number
  initial: SettingsSnapshot
  onApply: (s: SettingsSnapshot) => void
}) {
  const theme = useAppTheme()
  const [courtCount, setCourtCount] = useState(initial.courtCount)
  const [courtPreset, setCourtPreset] = useState(initial.courtPreset)
  const [pvnaTolerance, setPvnaTolerance] = useState(initial.pvnaTolerance)
  const [courtDurationMin, setCourtDurationMin] = useState(initial.courtDurationMin)
  const [targetRounds, setTargetRounds] = useState(initial.targetRounds)

  const calculator = useMemo(() => calculateOptimalCourts({
    n_players: playerCount,
    session_duration_min: courtDurationMin,
    match_duration_min: 15,
    preset: courtPreset,
  }), [playerCount, courtDurationMin, courtPreset])

  const recommended = calculator.recommended
  const warning = calculator.setup_warnings[0]

  const applyCourtWarningAlternative = (alternative: CourtWarningAlternative) => {
    if (alternative.action === 'set_duration' && alternative.duration_min) {
      setCourtDurationMin(alternative.duration_min)
      setTargetRounds(alternative.preview.rounds)
      return
    }
    if (alternative.action === 'set_preset' && alternative.preset) {
      setCourtPreset(alternative.preset)
      setTargetRounds(alternative.preview.rounds)
      return
    }
    if (alternative.action === 'set_courts' && alternative.courts) {
      setCourtCount(alternative.courts)
      setTargetRounds(alternative.preview.rounds)
    }
  }

  return (
    <View>
      <SheetTitle title="Cài đặt vòng" subtitle="Điều chỉnh setup trước khi start vòng kế." />
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 14, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Zap size={18} color={theme.heroCountdownText} />
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.heroCountdownText)}>Gợi ý setup</Text>
            <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
              Giữ setup gần gợi ý sân, chỉ mở dung sai PVNA khi áp lực lặp partner/đối thủ tăng.
            </Text>
          </View>
        </View>
      </LinearGradient>
      <View style={{ marginBottom: 14, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>
          Gợi ý: {recommended.courts} sân
        </Text>
        <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.onSurface }}>
          {calculator.reasoning}
        </Text>
      </View>
      {warning ? (
        <View style={{ marginBottom: 14, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.warningText }}>{warning.message}</Text>
          <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>{warning.why}</Text>
          {warning.alternatives.length > 0 ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {warning.alternatives.map((alternative, index) => (
                <TouchableOpacity
                  key={`${warning.type}-${alternative.action}-${index}`}
                  onPress={() => applyCourtWarningAlternative(alternative)}
                  style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 10 }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface }}>{alternative.label}</Text>
                  <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>
                    {alternative.expected_effect} · {alternative.tradeoff}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <CourtSuggestionOptions
        options={calculator.alternatives}
        selectedCourts={courtCount}
        recommendedCourts={recommended.courts}
        onSelect={setCourtCount}
      />
      <ChoiceRow label="Sân" options={[1, 2, 3, 4, 5, 6].map(value => ({ label: String(value), value }))} value={courtCount} onChange={setCourtCount} />
      <ChoiceRow
        label="Chế độ"
        options={COURT_PRESET_OPTIONS.map(value => ({ label: PRESETS[value].label, value }))}
        value={courtPreset}
        onChange={setCourtPreset}
      />
      <ChoiceRow label="Dung sai PVNA" options={PVNA_TOLERANCE_OPTIONS.map(value => ({ label: `±${value}`, value }))} value={pvnaTolerance} onChange={setPvnaTolerance} />
      <ChoiceRow label="Thời lượng" options={COURT_DURATION_OPTIONS.map(value => ({ label: `${value}p`, value }))} value={courtDurationMin} onChange={setCourtDurationMin} />
      <ChoiceRow
        label="Mục tiêu vòng"
        options={[6, 8, 10, recommended.total_rounds].filter((v, i, arr) => arr.indexOf(v) === i).map(value => ({ label: `${value}`, value }))}
        value={targetRounds}
        onChange={setTargetRounds}
      />
      <TouchableOpacity
        testID="nrv2-settings-apply"
        onPress={() => onApply({ courtCount, courtPreset, pvnaTolerance, courtDurationMin, targetRounds })}
        style={{ height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}
      >
        <Text style={ctaTextStyle(theme.onPrimary)}>Áp dụng</Text>
      </TouchableOpacity>
    </View>
  )
}

function CourtSuggestionOptions({
  options,
  selectedCourts,
  recommendedCourts,
  onSelect,
}: {
  options: CourtOption[]
  selectedCourts: number
  recommendedCourts: number
  onSelect: (courts: number) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Gợi ý số sân</Text>
      <View style={{ gap: 8 }}>
        {options.map(option => {
          const selected = option.courts === selectedCourts
          const recommended = option.courts === recommendedCourts
          const disabled = option.feasibility === 'infeasible'
          const toneColor = option.feasibility === 'optimal'
            ? theme.primary
            : option.feasibility === 'tight'
              ? theme.warningText
              : theme.outline
          return (
            <TouchableOpacity
              key={`court-option-${option.courts}`}
              disabled={disabled}
              onPress={() => onSelect(option.courts)}
              style={{
                borderRadius: RADIUS.md,
                borderWidth: BORDER.hairline,
                borderColor: selected ? theme.primary : theme.outlineVariant,
                backgroundColor: selected ? theme.secondaryContainer : theme.surface,
                padding: 12,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>
                    {option.courts} sân · {option.avg_matches_per_player.toFixed(1)} trận/người
                  </Text>
                  <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    {option.total_rounds} vòng · nghỉ {option.resting_per_round}/vòng · lặp {repeatRiskLabel(option.repeat_pressure.risk)}
                  </Text>
                  {option.warnings[0] ? (
                    <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.warningText }}>
                      {option.warnings[0]}
                    </Text>
                  ) : null}
                </View>
                <View style={{ borderRadius: RADIUS.full, backgroundColor: recommended ? theme.heroCountdownText : theme.surfaceContainerLow, paddingHorizontal: 9, paddingVertical: 5 }}>
                  <Text style={ctaTextStyle(recommended ? theme.primaryContainer : toneColor, 10)}>
                    {recommended ? 'Đề xuất' : feasibilityLabel(option.feasibility)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function FairnessSheet({
  score,
  state,
  warnings,
  latestAudit,
  groupSummaries,
  playersById,
}: {
  score: SessionFairnessScore
  state: SessionState
  warnings: FairnessWarning[]
  latestAudit: FairnessAudit | null
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const metrics = useMemo(() => ({
    match: computeMatchCountMetrics(state),
    partner: computePartnerDiversity(state),
    opponent: computeOpponentDiversity(state),
    rest: computeRestFairness(state),
    gender: computeGenderPrefSatisfaction(state),
    pressure: computeRepeatPressure(state),
    burden: computeOpponentRepeatBurden(state),
  }), [state])
  const { match, partner, opponent, rest, gender, pressure, burden } = metrics
  const rows = [
    ['Số trận', score.breakdown.match_count, 25, `Chênh số trận ${match.range} · Trung bình ${match.avg.toFixed(1)} trận/người`],
    ['Partner (đồng đội)', score.breakdown.partner_diversity, 20, `${partner.repeat_pairs.length} cặp lặp`],
    ['Đối thủ', score.breakdown.opponent_diversity, 15, `${opponent.repeat_pairs.length} cặp lặp · Một người bị lặp nhiều nhất ${burden.max_repeated_opponents} đối thủ`],
    ['Nghỉ', score.breakdown.rest, 20, `${rest.violations.length} vi phạm`],
    ['Sở thích giới tính', score.breakdown.gender_prefs, 20, `${gender.satisfied_count}/${gender.total_pref_opportunities || 0} sở thích được đáp ứng`],
  ] as const
  return (
    <View>
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 16, marginBottom: 14 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 54, color: theme.surface }}>
          {score.total}<Text style={{ fontSize: 20 }}>/100</Text>
        </Text>
        <View style={{ alignSelf: 'flex-start', backgroundColor: theme.heroPillBg, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={ctaTextStyle(theme.heroCountdownText, 12)}>{fairnessLabel(score)}</Text>
        </View>
        <Text style={{ marginTop: 9, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
          Áp lực lặp {repeatRiskLabel(pressure.repeat_risk)} · Trung bình {match.avg.toFixed(1)} trận/người · Áp lực đối thủ {pressure.opponent_pressure.toFixed(2)}
        </Text>
      </LinearGradient>
      {rows.map(([label, value, max, detail]) => (
        <BreakdownRow key={label} label={label} value={value} max={max} detail={detail} />
      ))}
      <PlayerMatchDistributionBlock match={match} rest={rest} playersById={playersById} />
      <FairnessEvolutionBlock state={state} />
      <LatestFairnessAuditCard audit={latestAudit} />
      <RepeatDetailsBlock
        partnerPairs={partner.repeat_pairs}
        opponentPairs={opponent.repeat_pairs}
        playersById={playersById}
      />
      {warnings.length > 0 ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {warnings.map((warning, index) => {
            const tone = warningTone(theme, warning.severity)
            return (
              <View key={`${warning.type}-${index}`} style={{ backgroundColor: tone.bg, borderRadius: RADIUS.md, padding: 10, borderWidth: BORDER.hairline, borderColor: tone.border }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: tone.text }}>{warningTitle(warning.type)}</Text>
                <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: tone.text }}>{warning.message}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
      <GroupAuditBlock state={state} groupSummaries={groupSummaries} playersById={playersById} />
    </View>
  )
}

function PlayerMatchDistributionBlock({
  match,
  rest,
  playersById,
}: {
  match: ReturnType<typeof computeMatchCountMetrics>
  rest: ReturnType<typeof computeRestFairness>
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  if (match.per_player.length === 0) return null
  const maxMatches = match.max
  const violationSet = new Set(rest.violations.map(v => v.player_id))
  const restByPlayer = new Map(rest.per_player.map(p => [p.player_id, p]))
  const sorted = [...match.per_player].sort((a, b) => a.matches_played - b.matches_played)
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface, marginBottom: 8 }}>
        Số trận mỗi người ({match.min}–{match.max})
      </Text>
      <View style={{ gap: 5 }}>
        {sorted.map(({ player_id, matches_played }) => {
          const player = playersById.get(player_id)
          const name = player?.name ?? player_id.slice(0, 6)
          const hasViolation = violationSet.has(player_id)
          const playerRest = restByPlayer.get(player_id)
          const barWidth = maxMatches === 0 ? 0 : (matches_played / maxMatches) * 100
          const isMin = matches_played === match.min && match.range > 0
          const isMax = matches_played === match.max && match.range > 0
          return (
            <View key={player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{ width: 80, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: hasViolation ? theme.warningText : theme.onSurface }}
              >
                {name}
              </Text>
              <View style={{ flex: 1, height: 8, backgroundColor: theme.outlineVariant, borderRadius: RADIUS.full, overflow: 'hidden' }}>
                <View style={{ width: `${barWidth}%`, height: '100%', backgroundColor: isMin ? theme.warningStrong : isMax ? theme.primary : theme.primaryContainer, borderRadius: RADIUS.full }} />
              </View>
              <Text style={{ width: 18, textAlign: 'right', fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: isMin ? theme.warningText : theme.onSurface }}>
                {matches_played}
              </Text>
              {hasViolation ? (
                <Text style={{ width: 40, fontFamily: SCREEN_FONTS.body, fontSize: 10, color: theme.warningText }}>
                  {`nghỉ ${playerRest?.max_consecutive_rest ?? 0}`}
                </Text>
              ) : <View style={{ width: 40 }} />}
            </View>
          )
        })}
      </View>
    </View>
  )
}

function FairnessEvolutionBlock({ state }: { state: SessionState }) {
  const theme = useAppTheme()
  const evolution = useMemo(() => computeFairnessEvolution(state), [state])
  if (evolution.length < 2) return null
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface, marginBottom: 8 }}>
        Lịch sử fairness
      </Text>
      <View style={{ gap: 4 }}>
        {evolution.map((entry: { round: number; score: number }, index: number) => {
          const prev = index > 0 ? evolution[index - 1].score : entry.score
          const delta = entry.score - prev
          const deltaColor = delta > 0 ? theme.successText : delta < 0 ? theme.warningText : theme.outline
          return (
            <View key={`evolution-${entry.round}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
              <Text style={{ width: 52, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                Vòng {entry.round + 1}
              </Text>
              <Text style={{ width: 30, fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurface }}>
                {entry.score}
              </Text>
              {index > 0 ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: deltaColor }}>
                  {delta > 0 ? '+' : ''}{delta}
                </Text>
              ) : null}
            </View>
          )
        })}
      </View>
    </View>
  )
}

function LatestFairnessAuditCard({ audit }: { audit: FairnessAudit | null }) {
  const theme = useAppTheme()
  if (!audit) return null
  const tone = audit.delta_total >= 0 ? theme.successText : theme.warningText
  return (
    <View style={{ marginTop: 12, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>Audit điểm fairness</Text>
          <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>
            Sau vòng {audit.round_no}: {audit.before_total} → {audit.after_total}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: tone }}>
          {audit.delta_total > 0 ? '+' : ''}{audit.delta_total}
        </Text>
      </View>
      <View style={{ marginTop: 10, gap: 6 }}>
        {audit.rows.map(row => (
          <View key={row.key} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surfaceContainerLow, padding: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 11.5, color: theme.onSurface }}>{row.label}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: row.delta < 0 ? theme.warningText : theme.primary }}>
                {row.before} → {row.after} ({row.delta > 0 ? '+' : ''}{row.delta})
              </Text>
            </View>
            <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>{describePreviewRow(row)}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
