import { LinearGradient } from 'expo-linear-gradient'
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
  Zap
} from 'lucide-react-native'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Dimensions, Pressable, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '@/constants/colors'
import { BORDER, SHADOW as LAYOUT_SHADOW, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { PRESETS, PRESET_ROTATION_TARGETS, calculateOptimalCourts, getCourtPresetTargetMatches, type CourtOption, type CourtPreset, type CourtWarningAlternative } from '@/lib/court-calculator'
import type { AlternativeAudit, SuggestedRoundAction } from '@/lib/next-round-suggester/alternatives'
import {
  buildFairnessAudits,
  type FairnessAudit,
  type FairnessPreview
} from '@/lib/next-round-suggester/fairness/audit'
import type { FairnessWarning } from '@/lib/next-round-suggester/fairness/detector'
import type { GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import {
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
  type SessionFairnessScore
} from '@/lib/next-round-suggester/fairness/metrics'
import { computeRepeatPressure } from '@/lib/next-round-suggester/fairness/pressure'
import { computeFairnessEvolution } from '@/lib/next-round-suggester/fairness/summary'
import {
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
  MAX_PROJECTED_REPEATED_OPPONENTS_PER_PLAYER,
  MAX_PROJECTED_REPEATED_PARTNERS_PER_PLAYER,
  PREFERRED_INTRA_TEAM_PVNA_GAP_LIMIT,
  getProjectedRepeatSummary,
  scoreMatch
} from '@/lib/next-round-suggester/score'
import type {
  Match,
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionState,
  SuggestionAlternative,
  SuggestionResult,
  SuggestionTradeoff,
  SuggestionTradeoffChoice,
  SuggestionTradeoffChoiceId
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'
import { Card, PlayerAvatar, SheetTitle } from '../components'
import { COURT_DURATION_OPTIONS, COURT_PRESET_OPTIONS, PVNA_TOLERANCE_OPTIONS } from '../constants'
import { ChoiceRow } from '../controls'
import { buildCourtLaneModels } from '../court-lanes'
import {
  BreakdownRow,
  GroupAuditBlock,
  RepeatDetailsBlock
} from '../flow-sheets'
import {
  ctaTextStyle,
  eyebrowStyle,
  formatNumber,
  getTeamPvna,
  playerName,
  repeatRiskLabel
} from '../helpers'

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
  if (type === 'missing_pvna') return 'Thiếu PVNA'
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

const WARNING_LABELS: Record<string, { severity: 'info' | 'warning'; text: string }> = {
  NOT_ENOUGH_PRESENT:                  { severity: 'warning', text: 'Không đủ người để lên sân.' },
  MUST_PLAY_OVER_CAPACITY:             { severity: 'warning', text: 'Số người bắt buộc chơi vượt chỗ trên sân — một số sẽ phải nghỉ vòng này.' },
  NO_VALID_MATCH:                      { severity: 'warning', text: 'Không tìm được trận hợp lệ với điều kiện hiện tại.' },
  PVNA_TOLERANCE_RELAXED:              { severity: 'info',    text: 'Engine đã nới nhẹ giới hạn chênh PVNA để tìm đủ người.' },
  PVNA_TOLERANCE_OPEN:                 { severity: 'warning', text: 'Engine phải bỏ giới hạn PVNA hoàn toàn — không đủ người cùng trình độ.' },
  REPEAT_CAP_RELAXED:                  { severity: 'info',    text: 'Engine vượt cap lặp — có cặp hoặc đối thủ đã từng đấu gần đây.' },
  INTRA_TEAM_GAP_RELAXED:              { severity: 'info',    text: 'Hai người cùng đội chênh trình độ hơn mức lý tưởng.' },
  REPEAT_CAP_REACHED:                  { severity: 'info',    text: 'Tất cả phương án đều chạm giới hạn lặp — trận này là tốt nhất có thể.' },
  PARTIAL_COURTS:                      { severity: 'info',    text: 'Không đủ người lấp đầy tất cả sân — một số sân trống vòng này.' },
  EXHAUSTIVE_FALLBACK:                 { severity: 'info',    text: 'Engine dùng tìm kiếm toàn diện vì các phương án thông thường không khả thi.' },
  REST_REQUIREMENT_RELAXED:            { severity: 'warning', text: 'Engine buộc đưa người cần nghỉ vào sân do không đủ người.' },
  MUST_REST_FORCED_PLAY:               { severity: 'warning', text: 'Có người đang bắt buộc nghỉ nhưng phải thi đấu vì thiếu người thay.' },
  LIVE_REPLACEMENT_QUOTA_RELAXED:      { severity: 'info',    text: 'Dùng người từ vùng chờ quá định mức — một số chưa được nghỉ đủ.' },
  LIVE_REPLACEMENT_RECYCLE_RELAXED:    { severity: 'info',    text: 'Engine tái sử dụng người vừa chơi xong để lấp đầy sân thay thế.' },
  LIVE_REPLACEMENT_RECYCLE_HARD_RELAXED: { severity: 'warning', text: 'Engine phải dùng người vừa kết thúc trận ngay lập tức — không còn lựa chọn nào khác.' },
}

function toUserSafeActionError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''

  if (code === '22P02') return `Lỗi kiểu dữ liệu khi gọi DB [${code}]: ${message}`

  if (message.includes('Not authenticated')) return 'Vui lòng đăng nhập lại.'
  if (message.includes('Could not read login session')) return 'Không thể đọc phiên đăng nhập. Vui lòng mở bằng Safari/Chrome hoặc đăng nhập lại.'
  if (message.includes('Session not found')) return 'Không tìm thấy buổi chơi. Vui lòng làm mới trang.'
  if (message.includes('Session changed')) return 'Buổi chơi đã thay đổi. Vui lòng làm mới và kiểm tra vòng đấu đã đổi trước khi bắt đầu.'
  if (message.includes('Live match not found')) return 'Không tìm thấy trận live. Vui lòng làm mới.'
  if (message.includes('Only live matches can be completed')) return 'Trận này không còn ở trạng thái live. Vui lòng làm mới.'
  if (message.includes('Only suggested/live matches can be cancelled')) return 'Trận không thể hủy ở trạng thái hiện tại.'
  if (message.includes('Only the host can complete live match')
    || message.includes('Only the host can cancel live match')
    || message.includes('Only the host can start live match')
    || message.includes('Only the host can manage live session')) return 'Chỉ host mới có thể thực hiện thao tác này.'
  if (message.includes('A player is already in a live match') || message.includes('Player is in a live match')) return 'Người này đang trong trận live. Hãy kết thúc hoặc hủy trận trước.'
  if (message.includes('Court already has a live match')) return 'Sân này đã có trận live đang diễn ra.'
  if (message.includes('Live match must use available checked-in players')
    || message.includes('Suggested match must use available checked-in players')) return 'Trận phải dùng người chơi đã check-in và còn trong buổi.'
  if (message.includes('Missing expected round match count')) return 'Thiếu thông tin số sân vòng hiện tại. Vui lòng làm mới trang.'
  if (message.includes('Match payload is required') || message.includes('Court is required')) return 'Dữ liệu trận không hợp lệ. Vui lòng thử lại.'
  if (message.includes('A round is already active')) return 'Đang có vòng đấu đang diễn ra.'
  if (message.includes('A player can only be assigned once per round')) return 'Mỗi người chơi chỉ có thể xếp lịch 1 lần trong mỗi vòng.'
  if (message.includes('Invalid manual matches')) return 'Các trận đấu tự chọn không hợp lệ.'
  if (message.includes('Manual match has invalid court index')) return 'Trận đấu tự chọn có số sân không hợp lệ.'
  if (message.includes('Manual matches cannot reuse the same court')) return 'Các trận đấu tự chọn không thể trùng sân.'
  if (message.includes('Manual matches exceed court count')) return 'Số trận đấu tự chọn vượt quá số lượng sân.'
  if (message.includes('Manual matches must use checked-in players')) return 'Trận đấu tự chọn phải sử dụng người chơi đã check-in.'
  if (message.includes('Round commit audit failed')) return 'Đánh giá lưu vòng thất bại. Vui lòng làm mới trước khi tiếp tục.'
  if (message.includes('Preview is stale') || message.includes('Preview version')) return 'Gợi ý trên màn hình đã cũ. Vui lòng làm mới gợi ý rồi bắt đầu lại.'
  if (message.includes('Request timed out')) return 'Yêu cầu quá hạn. Vui lòng kiểm tra kết nối mạng và thử lại.'
  if (message.includes('Temporary network issue')) return 'Lỗi kết nối mạng tạm thời. Vui lòng thử lại.'

  if (message.startsWith('Could not ')) return 'Không thể thực hiện thao tác: ' + message
  return `Thao tác thất bại${code ? ` [${code}]` : ''}: ${message}`
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
  live_availability_context?: {
    locked_player_count: number
    live_court_count: number
    locked_beam_quality?: number
    available_pool_quality?: number
  }
  locked_player_ids?: string[]
  available_pool_only?: boolean
}

type LiveDisplayMatchRow = SessionLiveMatchRow & {
  client_preview_id?: string
}

type SuggestedPreviewBatch = {
  key: string
  matches: SuggestedLiveMatchRow[]
}











export function SessionDashboardCard({
  roundNo,
  presentCount,
  checkedOutCount,
  requestedRestCount,
  lateCount,
  groupSummaries,
  courtCount,
  roundPace,
  pvnaTolerance,
  sessionDuration,
  fairnessScore,
  completedRounds,
  targetRounds,
  onOpenRoster,
  onFairnessPress,
  onSettingsPress,
  onLatePress,
}: {
  phase: 'plan' | 'active'
  roundNo: number
  presentCount: number
  rosterTotalCount: number
  checkedOutCount: number
  requestedRestCount: number
  lateCount: number
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
  courtCount: number
  roundPace: number
  pvnaTolerance: number
  sessionDuration: number
  fairnessScore: SessionFairnessScore
  completedRounds: number
  targetRounds: number
  onOpenRoster: () => void
  onFairnessPress: () => void
  onSettingsPress: () => void
  onLatePress: () => void
}) {
  const progressPct = targetRounds > 0 ? Math.min(100, Math.max(0, (completedRounds / targetRounds) * 100)) : 0
  const configItems = [
    `${courtCount} sân`,
    `${roundPace}p`,
    `±${pvnaTolerance}`,
    `${sessionDuration}p`,
    `${targetRounds} vòng`,
  ]
  return (
    <>
      <View style={dashboardStyles.card}>
        <View style={dashboardStyles.body}>
          <View style={dashboardStyles.leftCol}>
            <View>
              <Text style={dashboardStyles.miniLabel}>VÒNG</Text>
              <Text style={dashboardStyles.roundNum}>{roundNo}</Text>
              <View style={dashboardStyles.progressTrack}>
                <View style={[dashboardStyles.progressFill, { width: `${progressPct}%` }]} />
              </View>
              <Text style={dashboardStyles.progressTxt}>{completedRounds}/{targetRounds} vòng</Text>
            </View>

            <TouchableOpacity testID="nrv2-fairness-chip" onPress={onFairnessPress} activeOpacity={0.85} style={dashboardStyles.fairBlock}>
              <Text style={dashboardStyles.miniLabel}>FAIRNESS</Text>
              <Text style={dashboardStyles.fairScore}>{fairnessScore.total}</Text>
              <View style={dashboardStyles.fairBadge}>
                <Text style={dashboardStyles.fairBadgeTxt}>{fairnessLabel(fairnessScore)}</Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={dashboardStyles.divider} />

          <View style={dashboardStyles.rightCol}>
            <View style={dashboardStyles.manageLabelRow}>
              <Text style={dashboardStyles.manageLabel}>NGƯỜI CHƠI</Text>
              <TouchableOpacity testID="nrv2-roster-link" onPress={onOpenRoster} activeOpacity={0.7}>
                <Text style={dashboardStyles.manageHint}>Bấm để quản lý ›</Text>
              </TouchableOpacity>
            </View>

            <View style={dashboardStyles.rowTop}>
              <PlayerCell
                num={presentCount}
                label="Đang chơi"
                size="big"
                bgColor={colors.primaryLight}
                borderColor="transparent"
                numColor={colors.primary}
                labelColor={colors.primary}
                onPress={onOpenRoster}
              />
              <PlayerCell
                num={groupSummaries.length}
                label="Nhóm ưu tiên"
                size="big"
                bgColor={colors.surface}
                borderColor={colors.primary}
                numColor={colors.primary}
                labelColor={colors.primary}
                onPress={onOpenRoster}
              />
            </View>

            <View style={dashboardStyles.statusRow}>
              <StatusInlineItem count={lateCount} label="đến muộn" tone="warn" onPress={onLatePress} />
              <View style={dashboardStyles.statusDivider} />
              <StatusInlineItem count={requestedRestCount} label="nghỉ vòng" onPress={onOpenRoster} />
              <View style={dashboardStyles.statusDivider} />
              <StatusInlineItem count={checkedOutCount} label="check-out" onPress={onOpenRoster} />
            </View>
          </View>
        </View>
      </View>

      {lateCount > 0 && (
        <View style={dashboardStyles.alertBanner}>
          <View style={dashboardStyles.alertDot} />
          <Text style={dashboardStyles.alertText}>
            {lateCount} người chưa check-in - có thể đến muộn
          </Text>
          <TouchableOpacity onPress={onLatePress} activeOpacity={0.75}>
            <Text style={dashboardStyles.alertAction}>Xử lý →</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity testID="nrv2-settings-chip" style={dashboardStyles.configFooter} onPress={onSettingsPress} activeOpacity={0.88}>
        <Text style={dashboardStyles.cfgIcon}>☷</Text>
        <View style={dashboardStyles.cfgGrid}>
          {configItems.map((item, index) => (
            <React.Fragment key={`${item}-${index}`}>
              {index > 0 ? <View style={dashboardStyles.cfgDivider} /> : null}
              <Text style={dashboardStyles.cfgVal} numberOfLines={1}>{item}</Text>
            </React.Fragment>
          ))}
        </View>
        <Text style={dashboardStyles.cfgEditText}>ĐỔI ›</Text>
      </TouchableOpacity>
    </>
  )
}

export function StatusInlineItem({
  count,
  label,
  tone = 'neutral',
  onPress,
}: {
  count: number
  label: string
  tone?: 'neutral' | 'warn'
  onPress: () => void
}) {
  const color = tone === 'warn' ? colors.warningDark : colors.textSecondary
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={dashboardStyles.statusItem}>
      <Text style={[dashboardStyles.statusCount, { color }]}>{count}</Text>
      <Text style={[dashboardStyles.statusLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  )
}

export function PlayerCell({
  num,
  label,
  size,
  numColor,
  bgColor,
  borderColor,
  labelColor,
  subText,
  isAlert,
  onPress,
}: {
  num: number
  label: string
  size: 'big' | 'sm'
  numColor?: string
  bgColor?: string
  borderColor?: string
  labelColor?: string
  subText?: string
  isAlert?: boolean
  onPress?: () => void
}) {
  const isBig = size === 'big'
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.84}
      style={[
        dashboardStyles.cell,
        isBig && dashboardStyles.cellBig,
        { backgroundColor: bgColor ?? colors.surfaceAlt, borderColor: borderColor ?? 'transparent' },
        isAlert && dashboardStyles.cellAlert,
      ]}
    >
      <Text
        style={[
          dashboardStyles.cellNum,
          isBig ? dashboardStyles.cellNumBig : dashboardStyles.cellNumSm,
          { color: isAlert ? colors.warningDark : numColor ?? colors.textSecondary },
        ]}
      >
        {num}
      </Text>
      <Text style={[dashboardStyles.cellLbl, { color: labelColor ?? colors.textSecondary }, isAlert && dashboardStyles.cellLblAlert]}>
        {label}
      </Text>
      {subText ? (
        <Text style={dashboardStyles.cellSub} numberOfLines={1}>{subText}</Text>
      ) : null}
      <Text style={[dashboardStyles.cellChev, isAlert && { color: colors.warning }]}>›</Text>
    </TouchableOpacity>
  )
}

const dashboardStyles = {
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.border,
    overflow: 'hidden' as const,
  },
  strip: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  stripLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  stripDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.surface },
  stripLabel: {
    fontFamily: SCREEN_FONTS.bold,
    fontSize: 10,
    color: colors.surface,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  remainingPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 999,
  },
  remainingText: { fontFamily: SCREEN_FONTS.bold, fontSize: 10, color: colors.surface, fontWeight: '700' as const },
  body: {
    paddingHorizontal: 14,
    paddingVertical: 15,
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
    gap: 12,
  },
  divider: { width: 0.5, backgroundColor: colors.border },
  leftCol: { width: 84, flexDirection: 'column' as const, gap: 8, flexShrink: 0 },
  miniLabel: {
    fontFamily: SCREEN_FONTS.bold,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  roundNum: {
    fontFamily: SCREEN_FONTS.headlineBlack,
    fontSize: 40,
    color: colors.text,
    lineHeight: 40,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden' as const,
    width: 78,
    marginTop: 4,
  },
  progressFill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: 999 },
  progressTxt: { fontFamily: SCREEN_FONTS.label, fontSize: 11, color: colors.textSecondary, fontWeight: '600' as const, marginTop: 3 },
  fairBlock: { marginTop: 9 },
  fairScore: {
    fontFamily: SCREEN_FONTS.headlineBlack,
    fontSize: 36,
    color: colors.primary,
    lineHeight: 36,
  },
  fairBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'flex-start' as const,
    marginTop: 2,
  },
  fairBadgeTxt: { fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: colors.primary, fontWeight: '800' as const },
  rightCol: { flex: 1, flexDirection: 'column' as const, gap: 8 },
  manageLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 0 },
  manageLabel: { fontFamily: SCREEN_FONTS.bold, fontSize: 10, color: colors.textMuted, fontWeight: '600' as const, letterSpacing: 0.5 },
  manageHint: { fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: colors.primary, fontWeight: '800' as const },
  rowTop: { flexDirection: 'row' as const, gap: 8 },
  rowBottom: { flexDirection: 'row' as const, gap: 5 },
  cell: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: 'transparent',
    position: 'relative' as const,
    minHeight: 58,
  },
  cellBig: { minHeight: 94, justifyContent: 'center' as const },
  cellAlert: { backgroundColor: colors.warningLight, borderColor: '#F0D5A8' },
  cellNum: { fontFamily: SCREEN_FONTS.headlineBlack },
  cellNumBig: { fontSize: 40, marginBottom: 5 },
  cellNumSm: { fontSize: 24, marginBottom: 1 },
  cellLbl: { fontFamily: SCREEN_FONTS.label, fontSize: 13, color: colors.textSecondary, fontWeight: '700' as const },
  cellLblAlert: { color: colors.warningDark },
  cellSub: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    paddingRight: 10,
  },
  cellChev: {
    position: 'absolute' as const,
    bottom: 5,
    right: 7,
    fontSize: 10,
    color: 'transparent',
    fontFamily: SCREEN_FONTS.label,
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 1,
  },
  statusItem: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 3 },
  statusCount: { fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 17, lineHeight: 18 },
  statusLabel: { fontFamily: SCREEN_FONTS.label, fontSize: 12, fontWeight: '700' as const },
  statusDivider: { width: 1, height: 12, backgroundColor: colors.border },
  alertBanner: {
    marginTop: 12,
    backgroundColor: colors.warningLight,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1,
    borderColor: '#F0D5A8',
  },
  alertDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.warning },
  alertText: { flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 13, color: colors.warningDark, fontWeight: '700' as const },
  alertAction: { fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: colors.warningDark, fontWeight: '700' as const },
  configFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  cfgHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  cfgLabel: { fontFamily: SCREEN_FONTS.bold, fontSize: 10, color: colors.textMuted, fontWeight: '700' as const, letterSpacing: 0.5 },
  cfgEditPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  cfgIcon: { fontFamily: SCREEN_FONTS.bold, fontSize: 14, color: colors.textSecondary, fontWeight: '800' as const },
  cfgEditText: { fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: colors.primary, fontWeight: '800' as const },
  cfgGrid: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    minWidth: 0,
  },
  cfgDivider: { width: 1, height: 12, backgroundColor: colors.border },
  cfgItem: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: 4,
    alignItems: 'center' as const,
    gap: 2,
    minWidth: 0,
  },
  cfgItemHi: { backgroundColor: colors.primaryLight, borderColor: '#C5DDD3' },
  cfgVal: { fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: colors.text, lineHeight: 14 },
  cfgLbl: { fontFamily: SCREEN_FONTS.label, fontSize: 11, color: colors.textMuted, fontWeight: '600' as const, textAlign: 'center' as const },
}

export function LateArrivalsCta({ count, onPress }: { count: number; onPress: () => void }) {
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

export function ManagePlayersButton({
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

export function StatusChipRow({
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
  const delta = fairnessPreview?.delta_total ?? 0
  const hasDelta = fairnessPreview?.delta_total != null
  const deltaColor = !hasDelta ? theme.outline : delta >= 0 ? theme.successText : theme.warningText
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
                  {!hasDelta
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

export function AlternativeTabs({
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

export function FairnessPreviewCard({ preview, onPress }: { preview: FairnessPreview; onPress: () => void }) {
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

export function FairnessPreviewSheet({ preview }: { preview: FairnessPreview | null }) {
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
  const max = FAIRNESS_BREAKDOWN_MAX[row.key]
  const loss = Math.max(0, max - row.after)
  const movement = row.delta > 0
    ? `Mục này tốt hơn, tăng ${row.delta} điểm (${row.before} → ${row.after}/${max}).`
    : row.delta < 0
      ? `Mục này kém hơn, giảm ${Math.abs(row.delta)} điểm (${row.before} → ${row.after}/${max}).`
      : `Mục này giữ nguyên ở ${row.after}/${max}.`
  const deduction = loss > 0 ? `Còn thiếu ${loss} điểm để đạt mức tốt nhất.` : 'Đang đạt mức tốt nhất.'
  return `${movement} ${deduction}${row.detail ? ` ${row.detail}` : ''}`
}

export function EngineExplainCard({
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

export function NextMatchSuggestionCard({
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
  onPlayerPress: (playerId: string, match?: SuggestedLiveMatchRow) => void
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

function displayCourtIdxFor(match: Pick<SessionLiveMatchRow, 'court_idx' | 'sequence_no'>) {
  const courtIdx = Number(match.court_idx ?? match.sequence_no)
  return Number.isFinite(courtIdx) ? Math.max(0, courtIdx) : 0
}

type LiveMatchBoardProps = {
  liveMatches: SessionLiveMatchRow[]
  suggestedMatches: SuggestedLiveMatchRow[]
  completedMatches: SessionLiveMatchRow[]
  roundSize: number
  targetRounds: number
  roundPace: number
  busy: string | null
  startingPreviewIds: Set<string>
  endingLiveMatchIds: Set<string>
  completingMatchIds: Set<string>
  creatingNextMatchIds: Set<string>
  isSuggestingPreview: boolean
  state: SessionState
  pvnaTolerance: number
  playersById: Map<string, ArrangementPlayer>
  onStartMatch: (match: SuggestedLiveMatchRow) => void
  onFetchAvailablePool: (match: SuggestedLiveMatchRow) => void
  onConfirmStartNow: (match: SuggestedLiveMatchRow) => void
  onCancelAvailablePool: (courtIdx: number) => void
  availablePoolPreviews: Map<number, SuggestedLiveMatchRow | 'loading'>
  onCompleteMatch: (match: SessionLiveMatchRow, score: { a: number; b: number }) => void
  onCancelMatch: (match: SessionLiveMatchRow) => void
  onPlayerPress: (playerId: string, match?: SuggestedLiveMatchRow) => void
  onOpenSettings: () => void
  onOpenSwap: (match: SuggestedLiveMatchRow) => void
  courtShortageBreakdown?: { temp: number; real: number } | null
}

export const LiveMatchBoard = React.memo(function LiveMatchBoard({
  liveMatches,
  suggestedMatches,
  completedMatches,
  roundSize,
  targetRounds,
  roundPace,
  busy,
  startingPreviewIds,
  endingLiveMatchIds,
  completingMatchIds,
  creatingNextMatchIds,
  isSuggestingPreview,
  state,
  pvnaTolerance,
  playersById,
  onStartMatch,
  onFetchAvailablePool,
  onConfirmStartNow,
  onCancelAvailablePool,
  availablePoolPreviews,
  onCompleteMatch,
  onCancelMatch,
  onPlayerPress,
  onOpenSettings,
  onOpenSwap,
}: LiveMatchBoardProps) {
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
                    busy={busy === `complete-match-${match.id}` || endingLiveMatchIds.has(match.id)}
                    cancelBusy={busy === `cancel-match-${match.id}`}
                    searchingNext={creatingNextMatchIds.has(match.id) && !endingLiveMatchIds.has(match.id)}
                    state={state}
                    playersById={playersById}
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
          <View style={{ gap: 12 }}>
            {suggestedGroups.map(group => (
              <View key={`suggested-round-${group.roundNo}`} style={{ gap: 10 }}>
                <SuggestedRoundHeader roundNo={group.roundNo} targetRounds={targetRounds} />
                {group.matches.map(match => (
                  <SuggestedLiveMatchCard
                    key={match.id}
                    match={match}
                    busy={busy === `start-match-${match.id}` || startingPreviewIds.has(match.id)}
                    state={state}
                    pvnaTolerance={pvnaTolerance}
                    roundPace={roundPace}
                    playersById={playersById}
                    onStart={onStartMatch}
                    onFetchAvailablePool={onFetchAvailablePool}
                    onConfirmStartNow={onConfirmStartNow}
                    onCancelAvailablePool={onCancelAvailablePool}
                    availablePoolPreview={availablePoolPreviews.get(Number(match.court_idx ?? match.sequence_no))}
                    onPlayerPress={onPlayerPress}
                    onOpenSettings={onOpenSettings}
                    onOpenSwap={() => onOpenSwap(match)}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
})

export const CourtLaneLiveMatchBoard = React.memo(function CourtLaneLiveMatchBoard({
  liveMatches,
  suggestedMatches,
  completedMatches,
  roundSize,
  targetRounds,
  roundPace,
  busy,
  startingPreviewIds,
  endingLiveMatchIds,
  completingMatchIds,
  creatingNextMatchIds,
  isSuggestingPreview,
  state,
  pvnaTolerance,
  playersById,
  onStartMatch,
  onFetchAvailablePool,
  onConfirmStartNow,
  onCancelAvailablePool,
  availablePoolPreviews,
  onCompleteMatch,
  onCancelMatch,
  onPlayerPress,
  onOpenSettings,
  onOpenSwap,
  courtShortageBreakdown,
}: LiveMatchBoardProps) {
  const theme = useAppTheme()

  const courtCount = Math.max(1, Math.floor(roundSize))
  const logicalRoundByMatchId = buildLogicalRoundDisplayMap([...completedMatches, ...liveMatches], courtCount)
  const countableMatchIdsByCourt = new Map<number, Set<string>>()
  for (const match of [...completedMatches, ...liveMatches]) {
    if (match.status === 'cancelled') continue
    const courtIdx = displayCourtIdxFor(match)
    const matchIds = countableMatchIdsByCourt.get(courtIdx) ?? new Set<string>()
    matchIds.add(match.id)
    countableMatchIdsByCourt.set(courtIdx, matchIds)
  }
  const livePlayerCourtMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of liveMatches) {
      if (m.status !== 'live') continue
      if (endingLiveMatchIds.has(m.id) || completingMatchIds.has(m.id)) continue
      if (m.court_idx == null) continue
      for (const id of [...m.team_a, ...m.team_b]) map.set(id, Number(m.court_idx))
    }
    return map
  }, [liveMatches, endingLiveMatchIds, completingMatchIds])

  const courtLanes = buildCourtLaneModels({
    courtCount,
    liveMatches,
    suggestedMatches,
    liveYieldsToSuggested: (liveMatch) => creatingNextMatchIds.has(liveMatch.id) || completingMatchIds.has(liveMatch.id),
  })
  const firstEmptyCourtIdx = courtLanes.find(({ liveMatch, suggestedMatch }) => !liveMatch && !suggestedMatch)?.courtIdx ?? null
  // Map each empty lane to its shortage type, distributing TẠM slots first
  const emptyLaneStatus = useMemo(() => {
    const result = new Map<number, 'recovering' | 'temp' | 'real' | 'waiting'>()
    let tempRemaining = courtShortageBreakdown?.temp ?? 0
    let realRemaining = courtShortageBreakdown?.real ?? 0
    for (const { courtIdx, liveMatch, suggestedMatch } of courtLanes) {
      if (liveMatch || suggestedMatch) continue
      if (courtIdx === firstEmptyCourtIdx && isSuggestingPreview) {
        result.set(courtIdx, 'recovering')
      } else if (tempRemaining > 0) {
        result.set(courtIdx, 'temp')
        tempRemaining--
      } else if (realRemaining > 0) {
        result.set(courtIdx, 'real')
        realRemaining--
      } else {
        result.set(courtIdx, 'waiting')
      }
    }
    return result
  }, [courtLanes, courtShortageBreakdown, firstEmptyCourtIdx, isSuggestingPreview])

  return (
    <View style={{ marginTop: 16, gap: 12 }}>
      <SectionEyebrow label="Court lanes" />
      {courtLanes.map(({ courtIdx, liveMatch, suggestedMatch }) => {
        const laneCreatingNext = Boolean(
          liveMatch
            && creatingNextMatchIds.has(liveMatch.id)
            && !endingLiveMatchIds.has(liveMatch.id),
        )
        const courtMatchCount = countableMatchIdsByCourt.get(courtIdx)?.size ?? 0
        const liveRoundNo = liveMatch
          ? (logicalRoundByMatchId.get(liveMatch.id) ?? ((liveMatch.round_no ?? 0) + 1))
          : null
        const suggestedRoundNo = suggestedMatch
          ? ((suggestedMatch.round_no ?? courtMatchCount) + 1)
          : null
        const roundNo = laneCreatingNext
          ? liveRoundNo
          : liveMatch
            ? Math.max(1, liveRoundNo ?? 1)
            : suggestedMatch
              ? Math.max(1, suggestedRoundNo ?? 1)
              : null
        const laneBusy = liveMatch
          ? busy === `complete-match-${liveMatch.id}` || endingLiveMatchIds.has(liveMatch.id)
          : suggestedMatch
            ? busy === `start-match-${suggestedMatch.id}` || startingPreviewIds.has(suggestedMatch.id)
            : false
        const emptyLaneStatus_ = emptyLaneStatus.get(courtIdx)
        const emptyLaneIsRecovering = emptyLaneStatus_ === 'recovering'
        return (
          <View
            key={`court-lane-${courtIdx}`}
            style={{
              gap: 8,
              paddingTop: 10,
              borderTopWidth: courtIdx === 0 ? 0 : BORDER.hairline,
              borderTopColor: theme.outlineVariant,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurface }}>
                Court {courtIdx + 1}
              </Text>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline, fontWeight: '800' }}>
                {roundNo ? `Round ${roundNo} / ${targetRounds}` : 'Empty'}
              </Text>
            </View>
            {liveMatch && laneCreatingNext ? (
              <View
                style={{
                  minHeight: 118,
                  borderRadius: RADIUS.xl,
                  borderWidth: BORDER.hairline,
                  borderColor: theme.outlineVariant,
                  backgroundColor: theme.surfaceContainerLow,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 16,
                  gap: 10,
                }}
              >
                <ActivityIndicator color={theme.primary} />
                <Text style={ctaTextStyle(theme.primary, 12)}>Tạo trận tiếp theo...</Text>
              </View>
            ) : liveMatch ? (
              <LiveMatchScoreBoard
                key={displayMatchKey(liveMatch)}
                match={liveMatch}
                busy={laneBusy}
                cancelBusy={busy === `cancel-match-${liveMatch.id}`}
                searchingNext={creatingNextMatchIds.has(liveMatch.id) && !endingLiveMatchIds.has(liveMatch.id)}
                state={state}
                playersById={playersById}
                onComplete={onCompleteMatch}
                onCancel={onCancelMatch}
              />
            ) : suggestedMatch ? (
              <SuggestedLiveMatchCard
                key={suggestedMatch.id}
                match={suggestedMatch}
                busy={laneBusy}
                state={state}
                pvnaTolerance={pvnaTolerance}
                roundPace={roundPace}
                playersById={playersById}
                onStart={onStartMatch}
                onFetchAvailablePool={onFetchAvailablePool}
                onConfirmStartNow={onConfirmStartNow}
                onCancelAvailablePool={onCancelAvailablePool}
                availablePoolPreview={availablePoolPreviews.get(courtIdx)}
                onPlayerPress={onPlayerPress}
                onOpenSettings={onOpenSettings}
                onOpenSwap={() => onOpenSwap(suggestedMatch)}
                livePlayerCourtMap={livePlayerCourtMap}
              />
            ) : (
              <View
                style={{
                  minHeight: 96,
                  borderRadius: RADIUS.xl,
                  borderWidth: BORDER.hairline,
                  borderColor: theme.outlineVariant,
                  backgroundColor: theme.surfaceContainerLow,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 16,
                  gap: 10,
                }}
              >
                {emptyLaneIsRecovering ? <ActivityIndicator color={theme.primary} /> : null}
                <Text style={ctaTextStyle(theme.outline, 12)}>
                  {emptyLaneIsRecovering
                    ? 'Đang tạo trận tiếp theo...'
                    : emptyLaneStatus_ === 'real'
                      ? 'Chưa đủ người'
                      : 'Chờ sân khác xong'}
                </Text>
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
})

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

export function buildLogicalRoundDisplayMap(matches: SessionLiveMatchRow[], roundSize: number) {
  const safeRoundSize = Math.max(1, Math.floor(roundSize))
  const uniqueMatchesById = new Map<string, SessionLiveMatchRow>()
  for (const match of matches) {
    if (match.status === 'cancelled') continue
    const existing = uniqueMatchesById.get(match.id)
    if (!existing || existing.status !== 'completed') {
      uniqueMatchesById.set(match.id, match)
    }
  }
  const countableMatches = [...uniqueMatchesById.values()]
    .sort((left, right) => left.sequence_no - right.sequence_no)
  return new Map(countableMatches.map((match, index) => [
    match.id,
    Math.floor(index / safeRoundSize) + 1,
  ]))
}

export function RoundDivider({ roundNo }: { roundNo: number }) {
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

export function SuggestedRoundHeader({ roundNo, targetRounds }: { roundNo: number; targetRounds: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2, marginBottom: 2 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: colors.primary, letterSpacing: 0.8 }}>
        GỢI Ý TRẬN KẾ TIẾP
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: colors.primary, fontWeight: '800', letterSpacing: 0.4 }}>
        VÒNG {roundNo} / {targetRounds}
      </Text>
    </View>
  )
}

export function SectionEyebrow({ label }: { label: string }) {
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

export const SuggestedLiveMatchCard = React.memo(function SuggestedLiveMatchCard({
  match,
  busy,
  state,
  pvnaTolerance,
  roundPace,
  playersById,
  onStart,
  onFetchAvailablePool,
  onConfirmStartNow,
  onCancelAvailablePool,
  availablePoolPreview,
  onPlayerPress,
  onOpenSettings,
  onOpenSwap,
  livePlayerCourtMap,
}: {
  match: SuggestedLiveMatchRow
  busy: boolean
  state: SessionState
  pvnaTolerance: number
  roundPace: number
  playersById: Map<string, ArrangementPlayer>
  onStart: (match: SuggestedLiveMatchRow) => void
  onFetchAvailablePool: (match: SuggestedLiveMatchRow) => void
  onConfirmStartNow: (match: SuggestedLiveMatchRow) => void
  onCancelAvailablePool: (courtIdx: number) => void
  availablePoolPreview?: SuggestedLiveMatchRow | 'loading'
  onPlayerPress: (playerId: string, match?: SuggestedLiveMatchRow) => void
  onOpenSettings: () => void
  onOpenSwap: (match: SuggestedLiveMatchRow) => void
  livePlayerCourtMap?: Map<string, number>
}) {
  const theme = useAppTheme()
  const cancelBusy = false
  const rawTradeoffChoices = match.tradeoff_choices ?? []
  const hasCapTradeoffChoices = rawTradeoffChoices.some(choice =>
    choice.metrics.pvna_over_by > 0 ||
    choice.metrics.repeat_over_by > 0 ||
    (choice.metrics.match_count_over_by ?? 0) > 0 ||
    choice.alternative.warnings.includes('INTRA_TEAM_GAP_RELAXED')
  )
  const tradeoffChoices = hasCapTradeoffChoices ? rawTradeoffChoices : []
  const [selectedChoiceId, setSelectedChoiceId] = useState<SuggestionTradeoffChoiceId>(
    match.recommended_tradeoff_choice ?? tradeoffChoices[0]?.id ?? 'balanced',
  )
  useEffect(() => {
    setSelectedChoiceId(match.recommended_tradeoff_choice ?? (hasCapTradeoffChoices ? rawTradeoffChoices[0]?.id : undefined) ?? 'balanced')
  }, [hasCapTradeoffChoices, match.id, match.recommended_tradeoff_choice, rawTradeoffChoices])
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
  const liveAvailabilityContext = activeMatch.live_availability_context
  const pvnaDiff = useMemo(
    () => Math.abs(getTeamPvna(activeMatch.team_a, state) - getTeamPvna(activeMatch.team_b, state)),
    [activeMatch.team_a, activeMatch.team_b, state],
  )
  const pvnaOverBy = Math.max(0, pvnaDiff - pvnaTolerance)
  const pvnaCapExceeded = pvnaOverBy > 0
  const hasPvnaOpenWarning = activeMatch.warnings?.includes('PVNA_TOLERANCE_OPEN') ?? false
  const requiresRepeatApproval = activeMatch.approval_required || pvnaCapExceeded || activeMatch.warnings?.includes('REPEAT_CAP_RELAXED') || activeMatch.warnings?.includes('PVNA_TOLERANCE_RELAXED') || hasPvnaOpenWarning || false
  const repeatTradeoff = activeMatch.tradeoffs?.find(tradeoff => tradeoff.type === 'repeat_cap_relaxed')
  const pvnaTradeoff = activeMatch.tradeoffs?.find(tradeoff => tradeoff.type === 'pvna_tolerance_relaxed')
  const pvnaOpenRelaxed = hasPvnaOpenWarning || pvnaTradeoff?.relaxation_level === 'open'
  const effectivePvnaTolerance = activeMatch.effective_pvna_tolerance ?? state.config.pvna_tolerance
  const configuredPvnaTolerance = activeMatch.configured_pvna_tolerance ?? pvnaTolerance
  const autoPvnaRelaxed = effectivePvnaTolerance > configuredPvnaTolerance && Boolean(pvnaTradeoff)
  const intraTeamRelaxed = activeMatch.warnings?.includes('INTRA_TEAM_GAP_RELAXED') ?? false
  const maxIntraTeamGap = useMemo(() => Math.max(
    Math.abs((state.players.get(activeMatch.team_a[0])?.pvna ?? 0) - (state.players.get(activeMatch.team_a[1])?.pvna ?? 0)),
    Math.abs((state.players.get(activeMatch.team_b[0])?.pvna ?? 0) - (state.players.get(activeMatch.team_b[1])?.pvna ?? 0)),
  ), [activeMatch.team_a, activeMatch.team_b, state])
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
  const lockedPlayerIds = useMemo(() => {
    const teamPlayerIds = [...(activeMatch.team_a ?? []), ...(activeMatch.team_b ?? [])]
    return livePlayerCourtMap ? teamPlayerIds.filter(id => livePlayerCourtMap.has(id)) : (activeMatch.locked_player_ids ?? [])
  }, [activeMatch.team_a, activeMatch.team_b, activeMatch.locked_player_ids, livePlayerCourtMap])
  const hasLockedPlayers = lockedPlayerIds.length > 0
  const lockedBeamQuality = activeMatch.live_availability_context?.locked_beam_quality
  const availablePoolQuality = activeMatch.live_availability_context?.available_pool_quality
  const qualityGap = lockedBeamQuality != null && availablePoolQuality != null
    ? availablePoolQuality - lockedBeamQuality
    : null
  const showWaitUI = hasLockedPlayers && (
    availablePoolQuality === undefined ||
    qualityGap === null ||
    qualityGap >= 0.2
  )
  const startDisabled = busy || hasLockedPlayers
  const lockedPlayerCourtMap = useMemo(() => {
    if (!livePlayerCourtMap || lockedPlayerIds.length === 0) return undefined
    const map = new Map<string, number>()
    for (const id of lockedPlayerIds) {
      const courtIdx = livePlayerCourtMap.get(id)
      if (courtIdx !== undefined) map.set(id, courtIdx)
    }
    return map.size > 0 ? map : undefined
  }, [lockedPlayerIds, livePlayerCourtMap])
  const lockedWaitLabel = useMemo(() => {
    if (lockedPlayerIds.length === 0) return '⏳ Chờ sân khác xong'
    const parts = lockedPlayerIds.slice(0, 2).map(id => {
      const name = playerName(id, playersById)
      const courtIdx = livePlayerCourtMap?.get(id)
      return courtIdx != null ? `${name} (Sân ${courtIdx + 1})` : name
    })
    const extra = lockedPlayerIds.length > 2 ? ` +${lockedPlayerIds.length - 2}` : ''
    return `⏳ Chờ ${parts.join(', ')}${extra} xong`
  }, [lockedPlayerIds, livePlayerCourtMap, playersById])
  const recommendedChoice = tradeoffChoices.find(choice => choice.id === match.recommended_tradeoff_choice) ?? tradeoffChoices[0]
  const describeChoice = (choice: SuggestionTradeoffChoice) => {
    const reference = recommendedChoice?.metrics
    const pvnaGain = reference ? reference.pvna_gap - choice.metrics.pvna_gap : 0
    const intraGain = reference ? reference.intra_team_gap - choice.metrics.intra_team_gap : 0
    const repeatGain = reference ? reference.repeat_over_by - choice.metrics.repeat_over_by : 0
    const overPvna = choice.metrics.pvna_over_by > 0
    const overIntraTeam = choice.metrics.intra_team_over_by > 0
    const overRepeat = choice.metrics.repeat_over_by > 0
    const costParts: string[] = []
    if (overPvna) costParts.push(`PVNA vượt +${formatNumber(choice.metrics.pvna_over_by, 2)}`)
    if (overIntraTeam) costParts.push(`intra +${formatNumber(choice.metrics.intra_team_over_by, 2)}`)
    if (overRepeat) costParts.push(`lặp +${choice.metrics.repeat_over_by}`)
    if ((choice.metrics.match_count_over_by ?? 0) > 0) costParts.push(`fairness quota +${choice.metrics.match_count_over_by}`)
    if ((choice.metrics.opponent_repeat_over_by ?? 0) > 0) costParts.push(`lặp đối thủ +${choice.metrics.opponent_repeat_over_by}`)
    if ((choice.metrics.consecutive_play_over_by ?? 0) > 0) costParts.push(`chuỗi đánh +${choice.metrics.consecutive_play_over_by}`)
    const costText = costParts.length > 0 ? `, đổi lại ${costParts.join(', ')}` : ''

    if (choice.id === match.recommended_tradeoff_choice) {
      return {
        title: 'Đề xuất',
        summary: `Tốt nhất tổng thể: PVNA ${formatNumber(choice.metrics.pvna_gap, 2)}, intra ${formatNumber(choice.metrics.intra_team_gap, 2)}, lặp +${choice.metrics.repeat_over_by}`,
      }
    }
    if (repeatGain > 0) {
      return {
        title: 'Ít lặp hơn',
        summary: `Giảm lặp +${formatNumber(repeatGain, 0)}${costText}`,
      }
    }
    if (pvnaGain > 0.01) {
      return {
        title: 'Ít lệch đội hơn',
        summary: `Giảm PVNA ${formatNumber(reference?.pvna_gap ?? 0, 2)} → ${formatNumber(choice.metrics.pvna_gap, 2)}${costText}`,
      }
    }
    if (intraGain > 0.01) {
      return {
        title: 'Cặp trong đội đều hơn',
        summary: `Giảm intra-team ${formatNumber(reference?.intra_team_gap ?? 0, 2)} → ${formatNumber(choice.metrics.intra_team_gap, 2)}${costText}`,
      }
    }
    return {
      title: choice.label,
      summary: `PVNA ${formatNumber(choice.metrics.pvna_gap, 2)}, intra ${formatNumber(choice.metrics.intra_team_gap, 2)}, lặp +${choice.metrics.repeat_over_by}`,
    }
  }
  const visiblePvnaOverBy = pvnaTradeoff?.over_by ?? pvnaOverBy
  const totalActivePlayers = [...state.players.values()].filter(
    p => p.checked_out_at === null && !p.opted_rest,
  ).length
  const availableCount = liveAvailabilityContext
    ? totalActivePlayers - liveAvailabilityContext.locked_player_count
    : totalActivePlayers
  const capacityInfoLines: string[] = []
  if (liveAvailabilityContext) {
    const qualityOk = visiblePvnaOverBy === 0 && !intraTeamRelaxed && (!repeatTradeoff || (repeatTradeoff.over_by ?? 0) === 0)
    if (!qualityOk) {
      capacityInfoLines.push(`Tốt nhất từ ${availableCount}/${totalActivePlayers} người đang rảnh`)
    }
    if (intraTeamRelaxed) {
      capacityInfoLines.push(`Hai người cùng đội chênh trình độ (${formatNumber(maxIntraTeamGap, 2)})`)
    }
    if (visiblePvnaOverBy > 0) {
      capacityInfoLines.push(`Hai đội chênh nhau hơn bình thường`)
    }
    if (repeatTradeoff && (repeatTradeoff.over_by ?? 0) > 0) {
      capacityInfoLines.push(`Đã từng đấu với nhau gần đây`)
    }
    capacityInfoLines.push(`Tự cập nhật khi có sân khác hoàn thành`)
  }
  const engineWarnings = useMemo(() =>
    (activeMatch.warnings ?? []).map(code => {
      const label = WARNING_LABELS[code]
      if (!label) {
        console.warn('[SuggestedLiveMatchCard] unknown warning code:', code)
        return { code, severity: 'warning' as const, text: code }
      }
      return { code, ...label }
    }),
    [activeMatch.warnings],
  )
  const replacementWarnings = useMemo(() => {
    if (!availablePoolPreview || availablePoolPreview === 'loading') return []
    return (availablePoolPreview.warnings ?? []).map(code => {
      const label = WARNING_LABELS[code]
      if (!label) {
        console.warn('[SuggestedLiveMatchCard] unknown replacement warning code:', code)
        return { code, severity: 'warning' as const, text: code }
      }
      return { code, ...label }
    })
  }, [availablePoolPreview])
  return (
    <View style={{ borderRadius: 16, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}>
        {availablePoolPreview && availablePoolPreview !== 'loading' ? (
          <>
            <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant ?? colors.textSecondary, fontWeight: '700', letterSpacing: 0.5 }}>LINEUP THAY THẾ (POOL HIỆN TẠI)</Text>
            </View>
            <SuggestedMatchTile
              match={toMatch(availablePoolPreview)}
              state={state}
              pvnaTolerance={pvnaTolerance}
              roundPace={roundPace}
              playersById={playersById}
              onPlayerPress={(playerId) => onPlayerPress(playerId, availablePoolPreview)}
            />
            {replacementWarnings.length > 0 ? (
              <View style={{ marginTop: 6, gap: 4 }}>
                {replacementWarnings.map(({ code, severity, text }) => {
                  const tone = warningTone(theme, severity)
                  return (
                    <View key={code} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: RADIUS.sm, borderWidth: BORDER.hairline, borderColor: tone.border, backgroundColor: tone.bg, paddingHorizontal: 9, paddingVertical: 6 }}>
                      <AlertTriangle size={12} color={tone.text} style={{ marginTop: 1 }} />
                      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: tone.text }}>{text}</Text>
                    </View>
                  )
                })}
              </View>
            ) : null}
          </>
        ) : (
          <SuggestedMatchTile
            match={toMatch(activeMatch)}
            state={state}
            pvnaTolerance={pvnaTolerance}
            roundPace={roundPace}
            playersById={playersById}
            onPlayerPress={(playerId) => onPlayerPress(playerId, activeMatch)}
            lockedPlayerCourtMap={lockedPlayerCourtMap}
          />
        )}
      </View>
      {capacityInfoLines.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: tradeoffChoices.length > 1 ? 8 : 12 }}>
          <View style={{ borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, paddingTop: 9, gap: 2 }}>
            {capacityInfoLines.map((line, i) => (
              <Text key={i} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.outline }}>
                {i === 0 ? `ℹ ${line}` : `  ${line}`}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {engineWarnings.length > 0 ? (
        <View style={{ marginHorizontal: 14, marginBottom: 10, gap: 4 }}>
          {engineWarnings.map(({ code, severity, text }) => {
            const tone = warningTone(theme, severity)
            return (
              <View key={code} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: RADIUS.sm, borderWidth: BORDER.hairline, borderColor: tone.border, backgroundColor: tone.bg, paddingHorizontal: 9, paddingVertical: 6 }}>
                <AlertTriangle size={12} color={tone.text} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: tone.text }}>{text}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
      {tradeoffChoices.length > 1 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline, fontWeight: '900', textTransform: 'uppercase' }}>
            Chọn phương án
          </Text>
          <View style={{ gap: 8 }}>
            {tradeoffChoices.map(choice => {
              const selected = choice.id === selectedChoice?.id
              const overIntraTeam = choice.metrics.intra_team_over_by > 0
              const overRepeat = choice.metrics.repeat_over_by > 0
              const choiceCopy = describeChoice(choice)
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
                      {choiceCopy.title}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: selected ? theme.primary : theme.outline }}>
                      PVNA {formatNumber(choice.metrics.pvna_gap, 2)}{overIntraTeam ? ` / intra +${formatNumber(choice.metrics.intra_team_over_by, 2)}` : ''}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: selected ? theme.onSurface : theme.outline }}>
                    {choiceCopy.summary}
                  </Text>
                  {overRepeat ? (
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: selected ? theme.onSurface : theme.outline }}>
                      Lặp vượt {choice.metrics.repeat_over_by}
                    </Text>
                  ) : null}
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
                  PVNA vượt tolerance {formatNumber(pvnaTradeoff?.over_by ?? 0, 2)}
                </Text>
              ) : pvnaCapExceeded ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                  PVNA vượt tolerance {formatNumber(pvnaOverBy, 2)}
                </Text>
              ) : null}
              {pvnaOpenRelaxed ? (
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, lineHeight: 15, color: theme.warningText }}>
                  Khong con phuong an trong gioi han PVNA; engine phai mo gioi han de du nguoi choi.
                </Text>
              ) : autoPvnaRelaxed ? (
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
                  Lặp vượt cap {repeatTradeoff?.over_by ?? 0} điểm trên {repeatTradeoff?.affected_pairs ?? 0} cặp
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
      <View style={{ backgroundColor: colors.surface, paddingHorizontal: 14, paddingTop: 0, paddingBottom: 14, flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          onPress={() => onOpenSwap(activeMatch)}
          activeOpacity={0.82}
          style={{ paddingHorizontal: 16, height: 46, borderRadius: RADIUS.lg, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: colors.textSecondary }}>ĐỔI NGƯỜI</Text>
        </TouchableOpacity>
        {availablePoolPreview ? (
          <View style={{ flex: 1, gap: 6 }}>
            <TouchableOpacity
              onPress={() => onCancelAvailablePool(Number(activeMatch.court_idx))}
              style={{ height: 38, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: colors.textSecondary, fontWeight: '700' }}>← Quay lại chờ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => availablePoolPreview !== 'loading' && onConfirmStartNow(availablePoolPreview)}
              disabled={busy || availablePoolPreview === 'loading'}
              style={{ height: 46, borderRadius: RADIUS.lg, backgroundColor: availablePoolPreview === 'loading' ? theme.outlineVariant : colors.primary, alignItems: 'center', justifyContent: 'center' }}
            >
              {busy || availablePoolPreview === 'loading' ? (
                <ActivityIndicator size="small" color={availablePoolPreview === 'loading' ? colors.textSecondary : theme.onPrimary} />
              ) : (
                <Text style={ctaTextStyle(theme.onPrimary, 13)}>Xác nhận bắt đầu</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : hasLockedPlayers ? (
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ minHeight: 46, borderRadius: RADIUS.lg, backgroundColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text numberOfLines={2} style={ctaTextStyle(theme.onSurfaceVariant ?? colors.textSecondary, 12)}>{lockedWaitLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={() => onFetchAvailablePool(activeMatch)}
              disabled={busy}
              style={{ height: 38, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: colors.textSecondary, fontWeight: '700' }}>Xem lineup thay thế</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => onStart(activeMatch)}
            disabled={startDisabled}
            style={{ flex: 1, height: 46, borderRadius: RADIUS.lg, backgroundColor: startDisabled ? theme.outlineVariant : colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            {busy ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.onPrimary} />
                <Text style={ctaTextStyle(theme.onPrimary, 13)}>Đang bắt đầu trận</Text>
              </View>
            ) : <Text style={ctaTextStyle(theme.onPrimary, 13)}>Bắt đầu trận</Text>}
          </TouchableOpacity>
        )}
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
}, (prev, next) =>
  prev.busy === next.busy &&
  prev.match.id === next.match.id &&
  prev.match.team_a === next.match.team_a &&
  prev.match.team_b === next.match.team_b &&
  prev.match.court_idx === next.match.court_idx &&
  prev.match.round_no === next.match.round_no &&
  prev.match.locked_player_ids === next.match.locked_player_ids &&
  prev.pvnaTolerance === next.pvnaTolerance &&
  prev.roundPace === next.roundPace &&
  prev.state === next.state &&
  prev.playersById === next.playersById &&
  prev.availablePoolPreview === next.availablePoolPreview &&
  prev.onFetchAvailablePool === next.onFetchAvailablePool &&
  prev.livePlayerCourtMap === next.livePlayerCourtMap
)

export const LiveMatchScoreBoard = React.memo(function LiveMatchScoreBoard({
  match,
  busy,
  cancelBusy,
  searchingNext,
  state,
  playersById,
  onComplete,
  onCancel,
}: {
  match: SessionLiveMatchRow
  busy: boolean
  cancelBusy: boolean
  searchingNext: boolean
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onComplete: (match: SessionLiveMatchRow, score: { a: number; b: number }) => void
  onCancel: (match: SessionLiveMatchRow) => void
}) {
  const theme = useAppTheme()
  const [score, setScore] = useState({ a: match.score_a ?? 0, b: match.score_b ?? 0 })

  const handleScoreChange = useCallback((side: 'a' | 'b', delta: number) => {
    setScore(prev => ({ ...prev, [side]: Math.max(0, prev[side] + delta) }))
  }, [])

  const startedAt = match.started_at ?? match.suggested_at ?? match.created_at
  const isPersistingStart = String(match.id).startsWith('preview-')
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const update = () => setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const elapsedLabel = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`

  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: RADIUS.xl, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, overflow: 'hidden', ...LAYOUT_SHADOW.sm }}>
      <View style={{ backgroundColor: theme.surfaceContainerLow, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: BORDER.hairline, borderBottomColor: theme.outlineVariant }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: theme.primary, fontWeight: '800' }}>TRẬN ĐẤU LIVE</Text>
          <View style={{ backgroundColor: colors.primaryDark, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: colors.surface, textTransform: 'uppercase' }}>Sân {(match.court_idx ?? 0) + 1}</Text>
          </View>
        </View>
        {startedAt ? (
          <View style={{ backgroundColor: theme.onSurface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.sm }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.surface, fontWeight: '700' }}>
              {elapsedLabel}
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
            onMinus={() => handleScoreChange('a', -1)}
            onPlus={() => handleScoreChange('a', 1)}
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
            onMinus={() => handleScoreChange('b', -1)}
            onPlus={() => handleScoreChange('b', 1)}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Pressable
            onPress={() => {
              if (__DEV__) console.log('[NextRoundSuggesterV2] cancel button tapped', { matchId: match.id })
              onCancel(match)
            }}
            hitSlop={8}
            disabled={busy || cancelBusy || isPersistingStart}
            style={{ flex: 1, minHeight: 44, borderRadius: RADIUS.lg, backgroundColor: theme.dangerBg, alignItems: 'center', justifyContent: 'center' }}
          >
            {cancelBusy ? <ActivityIndicator color={theme.dangerText} /> : <Text style={ctaTextStyle(theme.dangerText, 12)}>Hủy trận</Text>}
          </Pressable>
          {isPersistingStart ? (
            <View style={{ flex: 2, minHeight: 44, borderRadius: RADIUS.lg, backgroundColor: theme.surfaceVariant, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={ctaTextStyle(theme.primary, 12)}>Dang bat dau...</Text>
            </View>
          ) : searchingNext ? (
            <View style={{ flex: 2, minHeight: 44, borderRadius: RADIUS.lg, backgroundColor: theme.surfaceVariant, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={ctaTextStyle(theme.primary, 12)}>Tạo trận tiếp theo...</Text>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                if (__DEV__) console.log('[NextRoundSuggesterV2] complete button tapped', { matchId: match.id })
                onComplete(match, score)
              }}
              hitSlop={8}
              disabled={busy || cancelBusy || searchingNext || isPersistingStart}
              style={{ flex: 2, minHeight: 44, borderRadius: RADIUS.lg, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', ...LAYOUT_SHADOW.sm }}
            >
              {busy ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                  <Text style={ctaTextStyle(theme.onPrimary, 12)}>Đang kết thúc...</Text>
                </View>
              ) : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Kết thúc trận</Text>}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}, (prev, next) =>
  prev.busy === next.busy &&
  prev.cancelBusy === next.cancelBusy &&
  prev.searchingNext === next.searchingNext &&
  prev.match.id === next.match.id &&
  prev.match.status === next.match.status &&
  prev.match.court_idx === next.match.court_idx &&
  prev.match.team_a === next.match.team_a &&
  prev.match.team_b === next.match.team_b,
)

export function SuggestedMatchTile({
  match,
  state,
  pvnaTolerance,
  roundPace,
  playersById,
  onPlayerPress,
  lockedPlayerCourtMap,
}: {
  match: Match
  state: SessionState
  pvnaTolerance?: number
  roundPace: number
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string, match?: SuggestedLiveMatchRow) => void
  lockedPlayerCourtMap?: Map<string, number>
}) {
  const theme = useAppTheme()
  const diff = useMemo(
    () => Math.abs(getTeamPvna(match.team_a, state) - getTeamPvna(match.team_b, state)),
    [match.team_a, match.team_b, state],
  )
  const effectivePvnaTolerance = pvnaTolerance ?? state.config.pvna_tolerance
  const pvnaCapExceeded = diff > effectivePvnaTolerance
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

  return (
    <View style={{ position: 'relative' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ backgroundColor: colors.primaryDark, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: colors.surface, textTransform: 'uppercase' }}>SÂN {match.court_idx + 1}</Text>
          </View>
        </View>
        <View style={{ borderRadius: 6, backgroundColor: pvnaCapExceeded ? colors.warningLight : colors.primaryLight, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: pvnaCapExceeded ? colors.warningDark : colors.primary, textTransform: 'uppercase' }}>
            CHÊNH {diff.toFixed(2)}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 12 }}>
        <SuggestedTeamBlock
          label="ĐỘI A"
          tone="green"
          side="left"
          team={match.team_a}
          state={state}
          playersById={playersById}
          onPlayerPress={onPlayerPress}
          lockedPlayerCourtMap={lockedPlayerCourtMap}
        />
        <SuggestedTeamBlock
          label="ĐỘI B"
          tone="sand"
          side="right"
          team={match.team_b}
          state={state}
          playersById={playersById}
          onPlayerPress={onPlayerPress}
          lockedPlayerCourtMap={lockedPlayerCourtMap}
        />
      </View>

      <View style={{ position: 'absolute', left: '50%', top: 100, marginLeft: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 14, lineHeight: 16, color: colors.text }}>VS</Text>
        </View>
      </View>

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
    </View>
  )
}

export function SuggestedTeamBlock({
  label,
  tone,
  side,
  team,
  state,
  playersById,
  onPlayerPress,
  lockedPlayerCourtMap,
}: {
  label: string
  tone: 'green' | 'sand'
  side: 'left' | 'right'
  team: [string, string]
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  onPlayerPress: (playerId: string) => void
  lockedPlayerCourtMap?: Map<string, number>
}) {
  const theme = useAppTheme()
  const teamTotal = getTeamPvna(team, state)
  const panelStyle = tone === 'green'
    ? { backgroundColor: 'rgba(225,245,238,0.42)', borderColor: '#D0E7DD' }
    : { backgroundColor: colors.surfaceAlt, borderColor: '#DDD8C9' }
  const accentColor = tone === 'green' ? colors.primary : colors.text
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 150, borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, paddingTop: 15, paddingRight: side === 'left' ? 28 : 14, paddingLeft: side === 'right' ? 28 : 14, ...panelStyle }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: accentColor, letterSpacing: 0.6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 5, marginBottom: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 34, lineHeight: 35, color: accentColor }}>
          {teamTotal.toFixed(1)}
        </Text>
        <View style={{ width: 74, flexDirection: 'row', justifyContent: side === 'left' ? 'flex-start' : 'flex-end' }}>
          {team.map((id, index) => (
            <TouchableOpacity
              key={id}
              onPress={() => onPlayerPress(id)}
              activeOpacity={0.76}
              style={{ position: 'relative', marginLeft: index === 0 ? 0 : -8 }}
            >
              <PlayerAvatar name={playerName(id, playersById)} size={40} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={{ gap: 5 }}>
        {team.map(id => {
          const lockCourtIdx = lockedPlayerCourtMap?.get(id)
          const isLocked = lockCourtIdx !== undefined
          return (
            <View key={`row-${id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 15, lineHeight: 18, color: isLocked ? theme.warningText : accentColor }}>
                {playerName(id, playersById).toUpperCase()}
              </Text>
              {isLocked ? (
                <View style={{ borderRadius: 4, backgroundColor: theme.warningBg, paddingHorizontal: 5, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.warningText, fontWeight: '800' }}>
                    SÂN {lockCourtIdx + 1}
                  </Text>
                </View>
              ) : (
                <Text style={{ width: 36, textAlign: side === 'left' ? 'left' : 'right', fontFamily: SCREEN_FONTS.label, fontSize: 13, color: accentColor, fontWeight: '700' }}>
                  {(state.players.get(id)?.pvna ?? 3.0).toFixed(1)}
                </Text>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

export function LiveScoreTeam({
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
      <Text style={{ marginTop: 8, textAlign: 'center', fontFamily: SCREEN_FONTS.headline, fontSize: 14, lineHeight: 20, color: theme.onSurface, fontWeight: '700' }}>
        {team.map(playerId => playerName(playerId, playersById)).join(' · ')}
      </Text>
      <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>
        Tổng PVNA {getTeamPvna(team, state).toFixed(2)}
      </Text>
    </View>
  )
}

export function LiveMatchScoreCard({
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

export function ScoreStepper({ value, onMinus, onPlus }: { value: number; onMinus: () => void; onPlus: () => void }) {
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

export function MatchList({
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

export function MatchTile({
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
              <View style={{ transform: [{ rotate: repeatExpanded ? '180deg' : '0deg' }] }}>
                <ChevronDown
                  size={15}
                  color={repeatCapExceeded ? theme.warningText : theme.outline}
                />
              </View>
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

export function RepeatCompactSummary({
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
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <ChevronDown size={15} color={textColor} />
        </View>
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

export function RepeatSummaryChip({
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

export function RepeatInlineDetail({
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

export function RepeatExpandedVisual({
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

export function RepeatPlayerCell({
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

export function RepeatInlinePlayer({
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

export function RepeatExpandedConnectionVisual({
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

export function RepeatConnectionSection({
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

export function RepeatConnectionRow({
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

export function RepeatConnectionPlayer({ name }: { name: string }) {
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

export function TeamBlock({
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

export function RestingRow({ resting, playersById }: { resting: string[]; playersById: Map<string, ArrangementPlayer> }) {
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

export function EngineConstraintNotice({
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

export function RestRiskBanner({
  state,
  suggestedMatches,
  playersById,
}: {
  state: SessionState
  suggestedMatches: SuggestedLiveMatchRow[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const { riskPlayers, unavoidable } = useMemo(() => {
    const scheduledIds = new Set(suggestedMatches.flatMap(m => [...(m.team_a ?? []), ...(m.team_b ?? [])]))
    const engineUnavoidable = suggestedMatches.some(m =>
      m.warnings?.includes('REST_REQUIREMENT_RELAXED') ||
      m.warnings?.includes('MUST_PLAY_OVER_CAPACITY'),
    )
    const riskPlayers = [...state.players.values()].filter(p => {
      if (p.checked_out_at !== null) return false
      if (p.opted_rest) return false
      if (scheduledIds.has(p.player_id)) return false
      const threshold = p.matches_played === 0 ? 2 : 1
      return p.consecutive_rest >= threshold
    })
    return { riskPlayers, unavoidable: engineUnavoidable }
  }, [state.players, suggestedMatches])

  if (riskPlayers.length === 0) return null

  const names = riskPlayers.map(p => playerName(p.player_id, playersById))
  const nameStr = names.join(', ')
  const message = unavoidable
    ? `${nameStr} phải nghỉ thêm 1 lượt — không đủ người/sân lúc này.`
    : riskPlayers.length === 1
      ? `${nameStr} sẽ nghỉ 2 lượt liên tiếp nếu không xếp vào trận tới.`
      : `${nameStr} sẽ nghỉ 2 lượt liên tiếp nếu không xếp vào.`
  const tone = warningTone(theme, unavoidable ? 'info' : 'warning')

  return (
    <View style={{ marginTop: 12, borderRadius: RADIUS.md, borderWidth: BORDER.hairline, borderColor: tone.border, backgroundColor: tone.bg, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <AlertTriangle size={15} color={tone.text} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 17, color: tone.text }}>{message}</Text>
    </View>
  )
}

export function PlanningRoundCard({ syncingRoster }: { syncingRoster: boolean }) {
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

export function EmptyPlanCard({
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

export function SettingsSheet({
  playerCount,
  initial,
  onApply,
}: {
  playerCount: number
  initial: SettingsSnapshot
  onApply: (s: SettingsSnapshot) => void
}) {
  const theme = useAppTheme()
  const appliedCourtCount = initial.courtCount
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
  const courtPresetTargetMatches = getCourtPresetTargetMatches(courtPreset, recommended.total_rounds)
  const courtPresetIdealPercent = Math.round(PRESET_ROTATION_TARGETS[courtPreset].ideal * 100)
  const recommendedSlotsPerRound = recommended.courts * 4
  const recommendedPlayRatioPercent = Math.round(recommended.play_ratio * 100)
  const warning = calculator.setup_warnings[0]
  const visibleWarningAlternatives = warning?.alternatives.filter(
    alternative => alternative.action !== 'set_courts' || !alternative.courts || alternative.courts >= recommended.courts || alternative.courts === appliedCourtCount,
  ) ?? []
  const courtChoiceOptions = calculator.alternatives
    .filter(option => option.courts >= recommended.courts || option.courts === appliedCourtCount)
    .map(option => ({ label: String(option.courts), value: option.courts }))

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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Zap size={18} color={theme.heroCountdownText} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={eyebrowStyle(theme.heroCountdownText)}>Gợi ý setup</Text>
            <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
              Giữ setup gần gợi ý sân, chỉ mở dung sai PVNA khi áp lực lặp partner/đối thủ tăng.
            </Text>
            <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.surface }}>
              Gợi ý: {recommended.courts} sân
            </Text>
            <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted, lineHeight: 17 }}>
              {PRESETS[courtPreset].label} nhắm khoảng {courtPresetIdealPercent}% người vào sân mỗi vòng: {recommended.total_rounds} vòng x {courtPresetIdealPercent}% = ~{courtPresetTargetMatches.toFixed(1)} trận/người.
            </Text>
            <Text style={{ marginTop: 5, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted, lineHeight: 17 }}>
              {recommended.courts} sân có {recommendedSlotsPerRound} slot/vòng cho {playerCount} người ({recommendedPlayRatioPercent}% vào sân), dự kiến {recommended.avg_matches_per_player.toFixed(1)} trận/người nên gần target nhất.
            </Text>
          </View>
        </View>
      </LinearGradient>
      {warning ? (
        <View style={{ marginBottom: 14, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, borderWidth: BORDER.hairline, borderColor: theme.warningStrong, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.warningText }}>{warning.message}</Text>
          <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>{warning.why}</Text>
          {visibleWarningAlternatives.length > 0 ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {visibleWarningAlternatives.map((alternative, index) => (
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
        appliedCourts={appliedCourtCount}
        recommendedCourts={recommended.courts}
        onSelect={setCourtCount}
      />
      <ChoiceRow label="Sân" options={courtChoiceOptions} value={courtCount} onChange={setCourtCount} />
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

export function CourtSuggestionOptions({
  options,
  selectedCourts,
  appliedCourts,
  recommendedCourts,
  onSelect,
}: {
  options: CourtOption[]
  selectedCourts: number
  appliedCourts: number
  recommendedCourts: number
  onSelect: (courts: number) => void
}) {
  const theme = useAppTheme()
  const visibleOptions = options.filter(option => option.courts >= recommendedCourts - 1 || option.courts === appliedCourts)
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Gợi ý số sân</Text>
      <View style={{ gap: 8 }}>
        {visibleOptions.map(option => {
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

export function FairnessSheet({
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
      <PlayerMatchDistributionBlock match={match} rest={rest} state={state} playersById={playersById} />
      <FairnessHistoryAuditSection state={state} latestAudit={latestAudit} />
      <RepeatDetailsBlock
        partnerPairs={partner.repeat_pairs}
        opponentPairs={opponent.repeat_pairs}
        playersById={playersById}
      />
      <GroupAuditBlock state={state} groupSummaries={groupSummaries} playersById={playersById} />
    </View>
  )
}

export function PlayerMatchDistributionBlock({
  match,
  rest,
  state,
  playersById,
}: {
  match: ReturnType<typeof computeMatchCountMetrics>
  rest: ReturnType<typeof computeRestFairness>
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const completedRounds = useMemo(
    () => [...state.rounds].filter(round => round.status === 'completed').sort((a, b) => a.round_no - b.round_no),
    [state.rounds],
  )
  const rows = useMemo(
    () => [...state.players.values()]
      .sort((a, b) => {
        if (a.checked_out_at && !b.checked_out_at) return 1
        if (!a.checked_out_at && b.checked_out_at) return -1
        if (a.opted_rest !== b.opted_rest) return a.opted_rest ? 1 : -1
        if (a.matches_played !== b.matches_played) return a.matches_played - b.matches_played
        return playerName(a.player_id, playersById).localeCompare(playerName(b.player_id, playersById))
      }),
    [playersById, state.players],
  )
  if (rows.length === 0) return null
  const violationSet = new Set(rest.violations.map(v => v.player_id))
  const restByPlayer = new Map(rest.per_player.map(p => [p.player_id, p]))
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurface, marginBottom: 8 }}>
        Số trận mỗi người ({match.min}–{match.max})
      </Text>
      <View style={{ gap: 7 }}>
        {rows.map(row => {
          const name = playerName(row.player_id, playersById)
          const hasViolation = violationSet.has(row.player_id)
          const playerRest = restByPlayer.get(row.player_id)
          const isMin = row.matches_played === match.min && match.range > 0 && !row.checked_out_at && !row.opted_rest
          const activities = buildPlayerRoundTimeline(row, completedRounds)
          const checkedOutRound = activities.find(activity => activity.status === 'checked_out')?.round_no
          const checkedOutLabel = checkedOutRound != null ? `R\u1eddi t\u1eeb V${checkedOutRound + 1}` : null
          const statusLabel = checkedOutLabel ?? (row.opted_rest ? '\u0110ang xin ngh\u1ec9' : hasViolation ? `T\u1eebng ngh\u1ec9 ${playerRest?.max_consecutive_rest ?? 0}` : null)
          return (
            <View
              key={row.player_id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                borderRadius: RADIUS.sm,
                borderWidth: BORDER.hairline,
                borderColor: hasViolation ? theme.warningStrong : theme.outlineVariant,
                backgroundColor: row.checked_out_at ? theme.surfaceContainerLow : theme.surface,
                padding: 8,
                opacity: row.checked_out_at ? 0.78 : 1,
              }}
            >
              <View style={{ width: 92, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: hasViolation || isMin ? theme.warningText : theme.onSurface }}
              >
                {name}
              </Text>
              <Text
                numberOfLines={1}
                style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 9.5, color: row.checked_out_at ? theme.outline : statusLabel ? theme.warningText : theme.outline }}
              >
                {statusLabel ?? '\u0110ang ch\u01a1i'}
              </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <RoundTimelineBar activities={activities} />
              </View>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: RADIUS.sm,
                  backgroundColor: isMin ? theme.warningBg : theme.secondaryContainer,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: BORDER.hairline,
                  borderColor: theme.outlineVariant,
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: isMin ? theme.warningText : theme.onSurface }}>
                  {row.matches_played}
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 8.5, color: theme.outline }}>
                  trận
                </Text>
              </View>
            </View>
          )
        })}
      </View>
      <RoundTimelineLegend />
    </View>
  )
}

type RoundTimelineStatus = 'played' | 'rested' | 'absent' | 'checked_out'

function buildPlayerRoundTimeline(
  player: PlayerSessionState,
  rounds: SessionState['rounds'],
): { round_no: number; status: RoundTimelineStatus }[] {
  const checkedOutMs = player.checked_out_at?.getTime() ?? null
  const checkedInMs = player.checked_in_at.getTime()
  return rounds.map(round => {
    const played = round.matches.some(match => match.team_a.includes(player.player_id) || match.team_b.includes(player.player_id))
    if (played) return { round_no: round.round_no, status: 'played' }
    if (round.resting.includes(player.player_id)) return { round_no: round.round_no, status: 'rested' }

    const roundStartMs = round.started_at?.getTime() ?? null
    const roundEndMs = round.ended_at?.getTime() ?? roundStartMs
    if (checkedOutMs !== null) {
      if (roundStartMs !== null && checkedOutMs <= roundStartMs) return { round_no: round.round_no, status: 'checked_out' }
      if (roundEndMs !== null && checkedInMs <= roundEndMs && checkedOutMs <= roundEndMs) return { round_no: round.round_no, status: 'checked_out' }
      if (roundStartMs === null && round.round_no > player.last_played_round) return { round_no: round.round_no, status: 'checked_out' }
    }

    return { round_no: round.round_no, status: 'absent' }
  })
}

function RoundTimelineBar({ activities }: { activities: { round_no: number; status: RoundTimelineStatus }[] }) {
  const theme = useAppTheme()
  if (activities.length === 0) return null
  return (
    <View
      style={{
        minHeight: 34,
        borderRadius: RADIUS.sm,
        backgroundColor: theme.surfaceContainerLow,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        padding: 5,
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {activities.map(activity => {
          const tone = roundTimelineTone(activity.status, theme)
          return (
            <View key={activity.round_no} style={{ flex: 1, alignItems: 'center', minWidth: 0 }}>
              <View
                style={{
                  width: 21,
                  height: 21,
                  borderRadius: RADIUS.full,
                  backgroundColor: tone.bg,
                  borderWidth: 1.5,
                  borderColor: tone.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 8.5, color: tone.text }}>
                  {activity.round_no + 1}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function RoundTimelineLegend() {
  const theme = useAppTheme()
  const items: { label: string; status: RoundTimelineStatus }[] = [
    { label: '\u0110\u00e1nh', status: 'played' },
    { label: 'Ngh\u1ec9', status: 'rested' },
    { label: 'V\u1eafng', status: 'absent' },
    { label: 'R\u1eddi', status: 'checked_out' },
  ]
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 }}>
      {items.map(item => {
        const tone = roundTimelineTone(item.status, theme)
        return (
          <View key={item.status} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone.bg, borderWidth: 1.5, borderColor: tone.border }} />
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9.5, color: theme.outline }}>{item.label}</Text>
          </View>
        )
      })}
    </View>
  )
}

function roundTimelineTone(status: RoundTimelineStatus, theme: ReturnType<typeof useAppTheme>) {
  if (status === 'played') return { bg: theme.primary, border: theme.primary, text: theme.onPrimary }
  if (status === 'rested') return { bg: theme.surface, border: theme.outline, text: theme.outline }
  if (status === 'checked_out') return { bg: theme.surfaceContainerLow, border: theme.outline, text: theme.outline }
  return { bg: theme.dangerBg, border: theme.dangerText, text: theme.dangerText }
}

const FAIRNESS_BREAKDOWN_MAX: Record<keyof SessionFairnessScore['breakdown'], number> = {
  match_count: 25,
  partner_diversity: 20,
  opponent_diversity: 15,
  rest: 20,
  gender_prefs: 20,
}

export function FairnessHistoryAuditSection({
  state,
  latestAudit,
}: {
  state: SessionState
  latestAudit?: FairnessAudit | null
}) {
  const theme = useAppTheme()
  const audits = useMemo(() => buildFairnessAudits(state), [state])
  const visibleAudits = audits.length > 0 ? audits : latestAudit ? [latestAudit] : []
  if (visibleAudits.length === 0) return null
  return (
    <View style={{ marginTop: 14, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.onSurface }}>
        Lịch sử & audit fairness
      </Text>
      <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline, lineHeight: 15 }}>
        Mỗi vòng hiển thị điểm sau vòng đó, thay đổi so với trước vòng và các mục đang bị trừ điểm.
      </Text>
      <View style={{ marginTop: 10, gap: 8 }}>
        {visibleAudits.map(audit => {
          const tone = audit.delta_total > 0 ? theme.successText : audit.delta_total < 0 ? theme.warningText : theme.outline
          const deductedRows = audit.rows
            .filter(row => row.after < FAIRNESS_BREAKDOWN_MAX[row.key] || row.delta < 0)
            .sort((a, b) => {
              const lossA = FAIRNESS_BREAKDOWN_MAX[a.key] - a.after
              const lossB = FAIRNESS_BREAKDOWN_MAX[b.key] - b.after
              if (lossA !== lossB) return lossB - lossA
              return a.label.localeCompare(b.label)
            })
          const rowsToShow = deductedRows.length > 0 ? deductedRows : audit.rows.filter(row => row.delta !== 0).slice(0, 2)
          return (
            <View key={`fairness-audit-${audit.round_no}`} style={{ borderRadius: RADIUS.sm, backgroundColor: theme.surfaceContainerLow, padding: 10, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface }}>
                    Vòng {audit.round_no + 1}
                  </Text>
                  <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>
                    {audit.before_total} → {audit.after_total} điểm
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: tone }}>
                  {audit.delta_total > 0 ? '+' : ''}{audit.delta_total}
                </Text>
              </View>
              {rowsToShow.length > 0 ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {rowsToShow.map(row => {
                    const max = FAIRNESS_BREAKDOWN_MAX[row.key]
                    const loss = Math.max(0, max - row.after)
                    const rowTone = row.delta < 0 || loss > 0 ? theme.warningText : theme.primary
                    return (
                      <View key={`${audit.round_no}-${row.key}`} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surface, padding: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: theme.onSurface }}>
                            {row.label}
                          </Text>
                          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10.5, color: rowTone }}>
                            {row.after}/{max}{row.delta !== 0 ? ` (${row.delta > 0 ? '+' : ''}${row.delta})` : ''}
                          </Text>
                        </View>
                        <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline, lineHeight: 14 }}>
                          {describePreviewRow(row)}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <Text style={{ marginTop: 7, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>
                  Không có mục bị trừ điểm trong vòng này.
                </Text>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

export function FairnessEvolutionBlock({ state }: { state: SessionState }) {
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

export function LatestFairnessAuditCard({ audit }: { audit: FairnessAudit | null }) {
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
