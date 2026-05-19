import React, { memo, useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ChevronDown, History, UserMinus, UserPlus, Users, X, Zap } from 'lucide-react-native'

import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { auditManualSwap } from '@/lib/next-round-suggester/manual-swap'
import { buildGroupAuditRows, type GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import {
  computeAvailabilityMetrics,
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computeRestFairness,
} from '@/lib/next-round-suggester/fairness/metrics'
import { computeRepeatPressure } from '@/lib/next-round-suggester/fairness/pressure'
import type { sanitizeSummaryForHost } from '@/lib/next-round-suggester/fairness/sanitize'
import type {
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { Card, MiniAction, PlayerAvatar, SheetAction, SheetTitle } from './components'
import { ctaTextStyle, eyebrowStyle, getPlayerPvna, playerName, repeatRiskLabel } from './helpers'
import { PlayerQualityReport } from './player-quality-report'
import type { MatchCountConsistencyRow } from '@/lib/next-round-suggester/fairness/audit'

function fairnessBreakdownLabel(key: string) {
  if (key === 'match_count') return 'Số trận'
  if (key === 'partner_diversity') return 'Đa dạng partner (đồng đội)'
  if (key === 'opponent_diversity') return 'Đa dạng đối thủ'
  if (key === 'rest') return 'Nhịp nghỉ'
  if (key === 'gender_prefs') return 'Sở thích giới tính'
  return key.replace(/_/g, ' ')
}

function fairnessBreakdownMax(key: string) {
  if (key === 'match_count') return 25
  if (key === 'partner_diversity') return 20
  if (key === 'opponent_diversity') return 15
  if (key === 'rest') return 20
  if (key === 'gender_prefs') return 20
  return 20
}

function pressureText(level: string) {
  if (level === 'low') return 'thấp'
  if (level === 'medium') return 'vừa'
  if (level === 'high') return 'cao'
  return 'rất cao'
}

function firstRoundStartAt(state: SessionState) {
  const starts = state.rounds
    .filter(round => round.status === 'completed' && round.started_at)
    .map(round => round.started_at!.getTime())
  return starts.length > 0 ? Math.min(...starts) : null
}

function rosterEventCounts(state: SessionState) {
  const firstStart = firstRoundStartAt(state)
  let late = 0
  let checkedOut = 0
  let restingNow = 0
  for (const player of state.players.values()) {
    if (firstStart !== null && player.checked_in_at.getTime() > firstStart) late += 1
    if (player.checked_out_at) checkedOut += 1
    if (!player.checked_out_at && player.opted_rest) restingNow += 1
  }
  return { late, checkedOut, restingNow }
}

function rosterCauseText(state: SessionState) {
  const events = rosterEventCounts(state)
  const parts = [
    events.late > 0 ? `${events.late} người đến muộn` : null,
    events.checkedOut > 0 ? `${events.checkedOut} người về sớm/check-out` : null,
    events.restingNow > 0 ? `${events.restingNow} người đang xin nghỉ` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function joinNames(ids: string[], playersById: Map<string, ArrangementPlayer>, limit = 3) {
  const names = ids.slice(0, limit).map(id => playerName(id, playersById))
  const remaining = Math.max(0, ids.length - limit)
  return remaining > 0 ? `${names.join(', ')} và ${remaining} người khác` : names.join(', ')
}

function explainBreakdown(key: string, state: SessionState, playersById: Map<string, ArrangementPlayer>) {
  const rosterCause = rosterCauseText(state)
  const availability = computeAvailabilityMetrics(state)
  const pressure = computeRepeatPressure(state)

  if (key === 'match_count') {
    const metrics = computeMatchCountMetrics(state)
    const mostPlayed = metrics.per_player.filter(player => player.matches_played === metrics.max).map(player => player.player_id)
    const leastPlayed = metrics.per_player.filter(player => player.matches_played === metrics.min).map(player => player.player_id)
    const churn = availability.total_roster_changes > 0
      ? `Roster thay đổi ${availability.total_roster_changes} lần, mức biến động ${pressureText(availability.churn_level)}`
      : 'Roster ổn định'
    const cause = rosterCause
      ? ` Nguyên nhân hợp lý nhất là roster có thay đổi giữa buổi: ${rosterCause}. Khi một người vào muộn hoặc về sớm, họ không có cùng số vòng khả dụng như nhóm chơi từ đầu đến cuối, nên điểm số trận sẽ bị kéo xuống dù engine vẫn xếp công bằng trong phần thời gian họ có mặt.`
      : ' Vì roster khá ổn định, nếu điểm này thấp thì thường là do số người/sân tạo ra lượt nghỉ không đều hoặc một vài vòng phải ưu tiên ràng buộc khác.'
    return `Chỉ số này đo xem mọi người có được đánh số trận gần nhau không. Hiện người đánh nhiều nhất là ${joinNames(mostPlayed, playersById)} với ${metrics.max} trận; ít nhất là ${joinNames(leastPlayed, playersById)} với ${metrics.min} trận, lệch ${metrics.range} trận. Nếu tính theo thời gian thực sự có mặt, độ lệch còn khoảng ${availability.expected_match_delta_range.toFixed(1)} trận. ${churn}.${cause}`
  }

  if (key === 'partner_diversity') {
    const partner = computePartnerDiversity(state)
    const repeated = partner.repeat_pairs.filter(pair => pair.count > 1).length
    const lowest = [...partner.per_player]
      .sort((a, b) => a.diversity_ratio - b.diversity_ratio)
      .slice(0, 3)
      .map(player => player.player_id)
    const cause = rosterCause
      ? ` Roster biến động (${rosterCause}) làm nhóm ghép cặp nhỏ hoặc thay đổi liên tục, nên engine có ít lựa chọn partner mới hơn.`
      : ' Khi số vòng nhiều hơn số tổ hợp partner tốt, hoặc có nhóm đi cùng nhau, việc lặp partner dễ xảy ra hơn.'
    return `Chỉ số này đo mỗi người được chơi với bao nhiêu đồng đội khác nhau. Trung bình mỗi người có ${partner.avg_unique_partners.toFixed(1)} partner khác, đạt khoảng ${Math.round(partner.avg_diversity_ratio * 100)}% mức đa dạng lý tưởng; có ${repeated} cặp partner bị lặp. Nhóm ít đa dạng nhất gồm ${joinNames(lowest, playersById)}. Áp lực phải lặp đang ở mức ${pressureText(pressure.repeat_risk)}.${cause}`
  }

  if (key === 'opponent_diversity') {
    const opponent = computeOpponentDiversity(state)
    const burden = computeOpponentRepeatBurden(state)
    const repeated = opponent.repeat_pairs.filter(pair => pair.count > 1).length
    const mostBurdened = [...burden.per_player]
      .filter(player => player.repeated_opponents > 0)
      .sort((a, b) => b.repeated_opponents - a.repeated_opponents)
      .slice(0, 3)
      .map(player => player.player_id)
    const cause = rosterCause
      ? ` Roster biến động (${rosterCause}) làm số đối thủ khả dụng thay đổi theo từng vòng, nên một số người phải gặp lại đối thủ cũ.`
      : ' Nếu roster ổn định mà điểm này thấp, thường là vì số vòng chơi cao so với số người, hoặc nhiều người có ràng buộc khiến pool đối thủ bị thu hẹp.'
    const burdenText = mostBurdened.length > 0 ? ` Người bị lặp đối thủ nhiều nhất: ${joinNames(mostBurdened, playersById)}.` : ''
    return `Chỉ số này đo mỗi người có gặp được nhiều đối thủ khác nhau không. Trung bình mỗi người gặp ${(opponent.avg_unique_opponents ?? opponent.avg_unique_partners).toFixed(1)} đối thủ khác, đạt khoảng ${Math.round(opponent.avg_diversity_ratio * 100)}% mức lý tưởng; có ${repeated} cặp đối thủ bị lặp. Tải lặp tối đa là ${burden.max_repeated_opponents}.${burdenText}${cause}`
  }

  if (key === 'rest') {
    const rest = computeRestFairness(state)
    const maxRest = Math.max(0, ...rest.per_player.map(player => player.max_consecutive_rest))
    const affected = rest.violations.map(player => player.player_id)
    const affectedText = affected.length > 0 ? ` Người bị ảnh hưởng rõ nhất: ${joinNames(affected, playersById)}.` : ''
    const cause = rosterCause
      ? ` Có ${rosterCause}; phần đến muộn/về sớm và xin nghỉ chủ động không bị tính như lượt nghỉ do engine tạo ra. Chỉ các vòng người đó thật sự nằm trong roster và bị xếp ngồi ngoài mới được chấm.`
      : ' Điểm nghỉ thường thấp khi số người không chia đều cho số sân, khiến một số người phải nghỉ liên tiếp.'
    return `Chỉ số này đo nhịp nghỉ có đều không, đặc biệt tránh một người phải ngồi ngoài quá nhiều vòng liên tiếp. Max nghỉ liên tiếp hiện là ${maxRest}; có ${rest.violations.length} người vượt ngưỡng.${affectedText}${cause}`
  }

  if (key === 'gender_prefs') {
    const gender = computeGenderPrefSatisfaction(state)
    if (gender.total_pref_opportunities === 0) return 'Không có sở thích giới tính nào cần chấm điểm trong session này.'
    const unsat = gender.total_pref_opportunities - gender.satisfied_count
    const hardPrefs = gender.unsatisfiable.map(player => player.player_id)
    const hardText = hardPrefs.length > 0 ? ` Một số sở thích gần như không thể đáp ứng với roster hiện tại: ${joinNames(hardPrefs, playersById)}.` : ''
    return `Chỉ số này đo các lựa chọn ưu tiên partner/đối thủ theo giới tính có được đáp ứng không. Session đáp ứng ${gender.satisfied_count}/${gender.total_pref_opportunities} lượt (${Math.round(gender.satisfaction_rate * 100)}%), còn ${unsat} lượt chưa đạt.${hardText} Khi roster thiếu đúng nhóm người mà một số người ưu tiên, engine chỉ có thể giảm thiệt hại chứ không thể đáp ứng hết.`
  }

  return ''
}


function backToBackSummary(playRatio: number) {
  const pct = Math.round(playRatio * 100)
  if (playRatio <= 0.55) {
    return `Play ratio ${pct}%: ít khả năng back-to-back.`
  }
  if (playRatio <= 0.7) {
    return `Play ratio ${pct}%: có thể có back-to-back nhẹ.`
  }
  return `Play ratio ${pct}%: khả năng cao có back-to-back.`
}

export function SwapSheet({
  state,
  alternative,
  playersById,
  swapFromPlayerId,
  setSwapFromPlayerId,
  onSwap,
}: {
  state: SessionState
  alternative?: SuggestionAlternative | null
  playersById: Map<string, ArrangementPlayer>
  swapFromPlayerId: string | null
  setSwapFromPlayerId: (playerId: string) => void
  onSwap: (fromId: string, toId: string) => void
}) {
  const theme = useAppTheme()
  if (!alternative) return <SheetTitle title="Đổi người" subtitle="Chưa có phương án để swap." />

  const playingIds = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
  const targetIds = [...new Set([...playingIds, ...alternative.resting])]
  const candidates = swapFromPlayerId
    ? targetIds
        .filter(playerId => playerId !== swapFromPlayerId)
        .map(playerId => ({ playerId, audit: auditManualSwap(state, alternative, swapFromPlayerId, playerId) }))
        .sort((a, b) => {
          const aBlocked = !a.audit || a.audit.invalid_matches > 0
          const bBlocked = !b.audit || b.audit.invalid_matches > 0
          if (aBlocked !== bBlocked) return aBlocked ? 1 : -1
          const deltaDiff = (b.audit?.delta_fairness ?? -999) - (a.audit?.delta_fairness ?? -999)
          if (deltaDiff !== 0) return deltaDiff
          const burdenDiff = (a.audit?.after.max_opponent_burden ?? 999) - (b.audit?.after.max_opponent_burden ?? 999)
          if (burdenDiff !== 0) return burdenDiff
          return playerName(a.playerId, playersById).localeCompare(playerName(b.playerId, playersById))
        })
    : []

  return (
    <View>
      <SheetTitle title="Đổi người" subtitle="Chọn người cần đổi, rồi chọn candidate được sắp theo cải thiện." />
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>1. Đổi ra</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {targetIds.map(playerId => {
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
          <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>2. Đổi với · sắp theo cải thiện</Text>
          <View style={{ gap: 8 }}>
            {candidates.map(({ playerId, audit }) => {
              const blocked = !audit || audit.invalid_matches > 0
              const better = Boolean(audit && audit.delta_fairness > 0 && !blocked)
              const borderColor = blocked ? theme.dangerText : better ? theme.primary : theme.outlineVariant
              const auditDetail = audit
                ? `Điểm fairness ${audit.delta_fairness > 0 ? '+' : ''}${audit.delta_fairness} · chênh số trận ${audit.before.match_range}→${audit.after.match_range} · người bị lặp đối thủ nhiều nhất ${audit.before.max_opponent_burden}→${audit.after.max_opponent_burden}`
                : 'Swap không hợp lệ'
              return (
                <TouchableOpacity
                  key={playerId}
                  onPress={() => !blocked && onSwap(swapFromPlayerId, playerId)}
                  disabled={blocked}
                  style={{
                    minHeight: 58,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.surface,
                    borderWidth: BORDER.hairline,
                    borderColor: theme.outlineVariant,
                    borderLeftWidth: 4,
                    borderLeftColor: borderColor,
                    padding: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <PlayerAvatar name={playerName(playerId, playersById)} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                    <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                      PVNA {(state.players.get(playerId)?.pvna ?? 0).toFixed(2)}
                    </Text>
                    <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline }}>{auditDetail}</Text>
                  </View>
                  <Text style={ctaTextStyle(blocked ? theme.dangerText : better ? theme.primary : theme.outline, 12)}>
                    {blocked ? 'Chặn' : audit!.delta_fairness > 0 ? `+${audit!.delta_fairness}` : audit!.delta_fairness}
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

type RosterPlayerRowProps = {
  row: SessionPlayerStateRow
  player: ArrangementPlayer | undefined
  expanded: boolean
  selectedForGroup: boolean
  inActiveRound: boolean
  onExpand: (id: string | null) => void
  onToggleCheckout: (playerId: string, checkedOut: boolean) => void
  onToggleRest: (playerId: string, optedRest: boolean) => void
  onToggleGroupSelection: (playerId: string) => void
  onClearGroup: (playerId: string) => void
  onSwap: (playerId: string) => void
}

const RosterPlayerRow = memo(function RosterPlayerRow({
  row, player, expanded, selectedForGroup, inActiveRound, onExpand,
  onToggleCheckout, onToggleRest, onToggleGroupSelection, onClearGroup, onSwap,
}: RosterPlayerRowProps) {
  const theme = useAppTheme()
  const playerId = row.player_id
  const checkedOut = Boolean(row.checked_out_at)
  const resting = !checkedOut && row.opted_rest
  const name = player?.name ?? 'Người chơi'
  const cardBg = checkedOut ? theme.surfaceContainerLow : resting ? theme.warningBg : undefined
  const infoColor = resting ? theme.warningText : theme.outline
  const infoSuffix = checkedOut ? 'đã check-out' : resting ? 'đang xin nghỉ' : `nghỉ liên tiếp ${row.consecutive_rest} lượt`
  return (
    <Card style={{ borderRadius: RADIUS.md, overflow: 'hidden', borderColor: selectedForGroup ? theme.primary : theme.outlineVariant, ...(cardBg ? { backgroundColor: cardBg } : {}) }}>
      <TouchableOpacity testID={`nrv2-roster-player-${playerId}`} onPress={() => onExpand(expanded ? null : playerId)} style={{ minHeight: 60, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar name={name} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{name}</Text>
          <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: infoColor }}>
            PVNA {(getPlayerPvna(player) ?? 0).toFixed(2)} · {row.matches_played} trận · {infoSuffix}
          </Text>
        </View>
        <ChevronDown size={16} color={theme.outline} />
      </TouchableOpacity>
      {expanded ? (
        <View style={{ borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <MiniAction testID={`nrv2-roster-checkout-${playerId}`} label={checkedOut ? 'Check-in' : 'Check-out'} icon={checkedOut ? UserPlus : UserMinus} onPress={() => onToggleCheckout(playerId, checkedOut)} tone={checkedOut ? 'good' : 'danger'} />
          {!checkedOut ? (
            <MiniAction testID={`nrv2-roster-rest-${playerId}`} label={row.opted_rest ? 'Bỏ nghỉ' : 'Xin nghỉ'} icon={History} onPress={() => onToggleRest(playerId, row.opted_rest)} tone="neutral" />
          ) : null}
          {!checkedOut && !row.group_id ? (
            <MiniAction testID={`nrv2-roster-group-${playerId}`} label={selectedForGroup ? 'Bỏ chọn' : 'Chọn group'} icon={Users} onPress={() => onToggleGroupSelection(playerId)} tone={selectedForGroup ? 'good' : 'neutral'} />
          ) : null}
          {!checkedOut && row.group_id ? (
            <MiniAction label="Xóa khỏi nhóm" icon={X} onPress={() => onClearGroup(playerId)} tone="neutral" />
          ) : null}
          {inActiveRound ? <MiniAction label="Đổi người" icon={Zap} onPress={() => onSwap(playerId)} tone="good" /> : null}
        </View>
      ) : null}
    </Card>
  )
})

export function RosterSheet({
  rows,
  playersById,
  busy,
  activeRoundIds,
  onToggleCheckout,
  onToggleRest,
  onSwap,
  onRefreshRoster,
  groupSelection,
  groupSummaries,
  onToggleGroupSelection,
  onCreateGroup,
  onClearGroup,
  onClearWholeGroup,
  onClearGroupSelection,
}: {
  rows: SessionPlayerStateRow[]
  playersById: Map<string, ArrangementPlayer>
  busy: string | null
  activeRoundIds?: Set<string>
  onToggleCheckout: (playerId: string, checkedOut: boolean) => void
  onToggleRest: (playerId: string, optedRest: boolean) => void
  onSwap: (playerId: string) => void
  onRefreshRoster: () => void | Promise<void>
  groupSelection: string[]
  groupSummaries: GroupSummary[]
  groupAliases: Map<string, string>
  onToggleGroupSelection: (playerId: string) => void
  onCreateGroup: () => void
  onClearGroup: (playerId: string) => void
  onClearWholeGroup: (groupId: string) => void
  onClearGroupSelection: () => void
}) {
  const theme = useAppTheme()
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)
  const groupSelectionSet = useMemo(() => new Set(groupSelection), [groupSelection])

  type FlatItem =
    | { type: 'player'; row: SessionPlayerStateRow }
    | { type: 'section-divider'; label: string; count: number }
    | { type: 'group-header'; groupId: string; label: string; count: number }

  const { playingRows, flatItems, activeCount, restingCount, checkedOutCount } = useMemo(() => {
    const playing: SessionPlayerStateRow[] = []
    const checkedOut: SessionPlayerStateRow[] = []
    const resting: SessionPlayerStateRow[] = []
    const ungrouped: SessionPlayerStateRow[] = []
    const groupedMap = new Map<string, SessionPlayerStateRow[]>()

    for (const row of rows) {
      if (row.checked_out_at) {
        checkedOut.push(row)
      } else if (activeRoundIds?.has(row.player_id)) {
        playing.push(row)
      } else if (row.opted_rest) {
        resting.push(row)
      } else if (row.group_id) {
        const arr = groupedMap.get(row.group_id) ?? []
        arr.push(row)
        groupedMap.set(row.group_id, arr)
      } else {
        ungrouped.push(row)
      }
    }

    const groupedCount = [...groupedMap.values()].reduce((s, g) => s + g.length, 0)
    const items: FlatItem[] = []

    for (const row of ungrouped) items.push({ type: 'player', row })

    for (const [groupId, groupRows] of groupedMap) {
      const summary = groupSummaries.find(g => g.group_id === groupId)
      const label = summary?.label ?? 'Nhóm'
      items.push({ type: 'group-header', groupId, label, count: groupRows.length })
      for (const row of groupRows) items.push({ type: 'player', row })
    }

    if (resting.length > 0) {
      items.push({ type: 'section-divider', label: 'Xin nghỉ', count: resting.length })
      for (const row of resting) items.push({ type: 'player', row })
    }

    if (checkedOut.length > 0) {
      items.push({ type: 'section-divider', label: 'Đã check-out', count: checkedOut.length })
      for (const row of checkedOut) items.push({ type: 'player', row })
    }

    return {
      playingRows: playing,
      flatItems: items,
      activeCount: ungrouped.length + groupedCount + playing.length,
      restingCount: resting.length,
      checkedOutCount: checkedOut.length,
    }
  }, [rows, groupSummaries, activeRoundIds])

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <SheetTitle title="Người chơi" subtitle="Tap vào người chơi để xem thao tác: check-out, nghỉ, nhóm, đổi người." />
      <TouchableOpacity testID="nrv2-roster-sync" onPress={() => { void onRefreshRoster() }} style={{ height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Text style={ctaTextStyle(theme.onPrimary, 13)}>Làm mới danh sách người chơi</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, padding: 10 }}>
          <Text style={eyebrowStyle(theme.primary)}>Đang trong roster</Text>
          <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.primary }}>{activeCount}</Text>
        </View>
        <View style={{ flex: 1, borderRadius: RADIUS.md, backgroundColor: theme.warningBg, padding: 10 }}>
          <Text style={eyebrowStyle(theme.warningText)}>Xin nghỉ</Text>
          <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.warningText }}>{restingCount}</Text>
        </View>
        <View style={{ flex: 1, borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, padding: 10 }}>
          <Text style={eyebrowStyle(theme.outline)}>Đã check-out</Text>
          <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.outline }}>{checkedOutCount}</Text>
        </View>
      </View>
      {playingRows.length > 0 ? (
        <View style={{ borderWidth: 1.5, borderColor: theme.primary, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: 12 }}>
          <View style={{ backgroundColor: theme.primaryContainer, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.heroLiveDot }} />
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.primary }}>Đang thi đấu · {playingRows.length}</Text>
          </View>
          <View style={{ padding: 8, gap: 8 }}>
            {playingRows.map(row => (
              <RosterPlayerRow
                key={row.player_id}
                row={row}
                player={playersById.get(row.player_id)}
                expanded={expandedPlayerId === row.player_id}
                selectedForGroup={groupSelectionSet.has(row.player_id)}
                inActiveRound={true}
                onExpand={setExpandedPlayerId}
                onToggleCheckout={onToggleCheckout}
                onToggleRest={onToggleRest}
                onToggleGroupSelection={onToggleGroupSelection}
                onClearGroup={onClearGroup}
                onSwap={onSwap}
              />
            ))}
          </View>
        </View>
      ) : null}
      {flatItems.map(item => {
        if (item.type === 'section-divider') {
          return (
            <View key={`__divider_${item.label}__`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant }} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.outline }}>{item.label} · {item.count}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant }} />
            </View>
          )
        }
        if (item.type === 'group-header') {
          return (
            <View key={`__group_${item.groupId}__`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.primaryContainer }} />
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.primary }}>{item.label} · {item.count} người</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.primaryContainer }} />
            </View>
          )
        }
        return (
          <View key={item.row.player_id} style={{ marginBottom: 8 }}>
            <RosterPlayerRow
              row={item.row}
              player={playersById.get(item.row.player_id)}
              expanded={expandedPlayerId === item.row.player_id}
              selectedForGroup={groupSelectionSet.has(item.row.player_id)}
              inActiveRound={activeRoundIds?.has(item.row.player_id) ?? false}
              onExpand={setExpandedPlayerId}
              onToggleCheckout={onToggleCheckout}
              onToggleRest={onToggleRest}
              onToggleGroupSelection={onToggleGroupSelection}
              onClearGroup={onClearGroup}
              onSwap={onSwap}
            />
          </View>
        )
      })}
      {rows.length > 0 ? (
        <View style={{ marginTop: 6, gap: 10 }}>
          {groupSummaries.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={eyebrowStyle(theme.outline)}>Nhóm hiện tại</Text>
              {groupSummaries.map(group => (
                <View key={group.group_id} style={{ borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, padding: 10, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.onSurface }} numberOfLines={2}>
                    {group.label}: {group.player_ids.map(id => playerName(id, playersById)).join(', ')}
                  </Text>
                  <TouchableOpacity onPress={() => onClearWholeGroup(group.group_id)} style={{ minHeight: 34, borderRadius: RADIUS.md, backgroundColor: theme.surface, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={ctaTextStyle(theme.outline, 10)}>Xóa</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, padding: 12 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.primary }}>
              Chọn từ 2 người chơi trở lên để tạo nhóm. Engine sẽ ưu tiên xếp họ cùng đội hoặc cùng sân nhưng không bắt buộc.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              testID="nrv2-roster-create-group"
              onPress={onCreateGroup}
              disabled={groupSelection.length < 2 || Boolean(busy?.startsWith('group-'))}
              style={{ flex: 1, height: 48, borderRadius: RADIUS.md, backgroundColor: groupSelection.length >= 2 ? theme.primary : theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
            >
              {busy?.startsWith('group-') ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Tạo nhóm ({groupSelection.length})</Text>}
            </TouchableOpacity>
            {groupSelection.length > 0 ? (
              <TouchableOpacity onPress={onClearGroupSelection} style={{ width: 48, height: 48, borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color={theme.onSurface} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    </ScrollView>
  )
}

export function LateArrivalsSheet({
  players,
  busy,
  onAddPlayer,
}: {
  players: ArrangementPlayer[]
  busy: string | null
  onAddPlayer: (playerId: string) => void
}) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Người đến muộn" subtitle="Thêm người đã tới muộn vào roster live để engine xếp từ vòng kế tiếp." />
      <View style={{ gap: 8 }}>
        {players.length === 0 ? (
          <Card style={{ padding: 14, backgroundColor: theme.surfaceContainerLow }}>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>
              Không còn ai trong danh sách chưa tới.
            </Text>
          </Card>
        ) : players.map(player => {
          const playerId = String(player.id)
          const loading = busy === `late-${playerId}`
          return (
            <Card key={`late-${playerId}`} style={{ borderRadius: RADIUS.md, padding: 10 }}>
              <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <PlayerAvatar name={player.name || 'Người chơi'} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }} numberOfLines={1}>
                    {player.name || 'Người chơi'}
                  </Text>
                  <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    PVNA {(getPlayerPvna(player) ?? 0).toFixed(2)} · trạng thái chưa tới
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onAddPlayer(playerId)}
                  disabled={loading}
                  style={{
                    minHeight: 40,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.secondaryContainer,
                    paddingHorizontal: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {loading ? <ActivityIndicator color={theme.primary} /> : <Text style={ctaTextStyle(theme.primary, 11)}>Thêm</Text>}
                </TouchableOpacity>
              </View>
            </Card>
          )
        })}
      </View>
    </View>
  )
}

export function HistorySheet({ rounds, playersById }: { rounds: SessionRoundRow[]; playersById: Map<string, ArrangementPlayer> }) {
  const theme = useAppTheme()
  return (
    <View>
      <SheetTitle title="Lịch sử vòng" subtitle="Các vòng đã lưu trong live session." />
      <View style={{ gap: 10 }}>
        {rounds.map(round => (
          <Card key={round.round_no} style={{ borderRadius: RADIUS.md, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>Vòng {round.round_no}</Text>
              <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.successBg, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={ctaTextStyle(theme.successText, 11)}>Đã lưu</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              {round.matches.map(match => (
                <View key={`${round.round_no}-${match.court_idx}`} style={{ borderRadius: RADIUS.xs, backgroundColor: theme.surfaceAlt, padding: 8 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
                    {match.team_a.map(id => playerName(id, playersById)).join(' · ')} vs {match.team_b.map(id => playerName(id, playersById)).join(' · ')}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.rescueAccent }}>
              Nghỉ: {round.resting.map(id => playerName(id, playersById)).join(', ') || 'Không có'}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  )
}

export function MoreSheet({
  onSyncRoster,
  onOpenRoster,
  onOpenHistory,
  onOpenFairness,
  busy,
}: {
  onSyncRoster: () => void
  onOpenRoster: () => void
  onOpenHistory: () => void
  onOpenFairness: () => void
  busy: string | null
}) {
  return (
    <View>
      <SheetTitle title="Thao tác nhanh" />
      <View style={{ gap: 10 }}>
        <SheetAction label="Cập nhật danh sách người chơi" onPress={onSyncRoster} loading={busy === 'sync'} />
        <SheetAction label="Người chơi" onPress={onOpenRoster} />
        <SheetAction label="Đánh giá Fairness" onPress={onOpenFairness} />
        <SheetAction label="Lịch sử vòng" onPress={onOpenHistory} />
      </View>
    </View>
  )
}

export function GroupAuditBlock({
  state,
  groupSummaries,
  playersById,
}: {
  state: SessionState
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const rows = buildGroupAuditRows(state, groupSummaries)
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Đánh giá Nhóm</Text>
      {rows.length === 0 ? (
        <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Chưa có nhóm nào được tạo.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map(row => (
            <View key={row.group_id} style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>
                {row.label}: {row.player_ids.map(id => playerName(id, playersById)).join(', ')}
              </Text>
              <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>
                Cùng xuất hiện trong {row.shared_matches} trận.
              </Text>
              <View style={{ marginTop: 8, gap: 4 }}>
                {row.pair_counts.map(pair => (
                  <Text key={`${pair.player_a}-${pair.player_b}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
                    {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} trận chung đội
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export function BreakdownRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const theme = useAppTheme()
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{label}</Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.outline }}>{value}/{max}</Text>
      </View>
      <View style={{ height: 8, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: pct >= 95 ? theme.primary : theme.primaryContainer }} />
      </View>
      {detail ? <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>{detail}</Text> : null}
    </View>
  )
}

export function RepeatDetailsBlock({
  partnerPairs,
  opponentPairs,
  playersById,
}: {
  partnerPairs: Array<{ player_a: string; player_b: string; count: number }>
  opponentPairs: Array<{ player_a: string; player_b: string; count: number }>
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const renderPairs = (pairs: Array<{ player_a: string; player_b: string; count: number }>) => {
    const repeated = pairs.filter(pair => pair.count > 1)
    if (repeated.length === 0) {
      return <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>Không có cặp lặp.</Text>
    }
    return repeated.map(pair => (
      <Text key={`${pair.player_a}-${pair.player_b}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
        {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} lần
      </Text>
    ))
  }

  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Text style={eyebrowStyle(theme.outline)}>Cặp lặp chi tiết</Text>
      <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Partner lặp (đồng đội)</Text>
        <View style={{ gap: 3 }}>{renderPairs(partnerPairs)}</View>
      </View>
      <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, padding: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Đối thủ lặp</Text>
        <View style={{ gap: 3 }}>{renderPairs(opponentPairs)}</View>
      </View>
    </View>
  )
}

export function OpponentBurdenSummary({
  burden,
  playersById,
}: {
  burden: ReturnType<typeof computeOpponentRepeatBurden>
  playersById: Map<string, ArrangementPlayer>
}) {
  const theme = useAppTheme()
  const rows = burden.per_player
    .filter(player => player.repeated_opponents > 0)
    .sort((a, b) => b.repeated_opponents - a.repeated_opponents)
  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Người bị lặp đối thủ nhiều</Text>
      {rows.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Không có ai bị lặp đối thủ.</Text>
      ) : (
        <View style={{ gap: 4 }}>
          {rows.map(row => (
            <Text key={`burden-${row.player_id}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.onSurface }}>
              {playerName(row.player_id, playersById)}: {row.repeated_opponents} đối thủ lặp
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

export function RecapView({
  summary,
  state,
  matchCountConsistencyRows,
  groupSummaries,
  playersById,
  onOpenHistory,
  onContinue,
}: {
  summary: ReturnType<typeof sanitizeSummaryForHost>
  state: SessionState
  matchCountConsistencyRows: MatchCountConsistencyRow[]
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
  onOpenHistory: () => void
  onContinue: () => void
}) {
  const theme = useAppTheme()
  const maxMatchesForChart = useMemo(
    () => Math.max(1, ...summary.per_player.map(item => item.matches_played)),
    [summary.per_player],
  )
  const { partner, opponent, burden, pressure, restByPlayer, breakdownExplanations, lowScoreReasons } = useMemo(() => {
    const p = computePartnerDiversity(state)
    const o = computeOpponentDiversity(state)
    const b = computeOpponentRepeatBurden(state)
    const pr = computeRepeatPressure(state)
    const restMap = new Map(computeRestFairness(state).per_player.map(player => [player.player_id, player]))
    // explainBreakdown gọi computeAvailabilityMetrics + computeRepeatPressure nội bộ — tính 1 lần/key
    const explanations = Object.fromEntries(
      Object.keys(summary.fairness_score.breakdown).map(key => [key, explainBreakdown(key, state, playersById)]),
    )
    const reasons = Object.entries(summary.fairness_score.breakdown)
      .map(([key, value]) => ({ key, value: Number(value), max: fairnessBreakdownMax(key) }))
      .filter(item => item.value < item.max * 0.8)
      .sort((a, b) => (a.value / a.max) - (b.value / b.max))
      .slice(0, 3)
      .map(item => ({ key: item.key, label: fairnessBreakdownLabel(item.key), text: explanations[item.key] ?? '' }))
    return { partner: p, opponent: o, burden: b, pressure: pr, restByPlayer: restMap, breakdownExplanations: explanations, lowScoreReasons: reasons }
  }, [state, summary.fairness_score, playersById])
  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 48 }}>
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 18, marginBottom: 14 }}>
        <Text style={eyebrowStyle(theme.heroCountdownText)}>Session đã hoàn tất</Text>
        <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 36, color: theme.surface }}>
          {summary.total_rounds} vòng
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
          {summary.total_players} người chơi · điểm fairness tổng buổi chơi
        </Text>
      </LinearGradient>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 46, color: theme.primary }}>
          {summary.fairness_score.total}<Text style={{ fontSize: 18 }}>/100</Text>
        </Text>
        {Object.entries(summary.fairness_score.breakdown).map(([key, value]) => (
          <BreakdownRow key={key} label={fairnessBreakdownLabel(key)} value={Number(value)} max={fairnessBreakdownMax(key)} detail={breakdownExplanations[key] ?? ''} />
        ))}
      </Card>
      {lowScoreReasons.length > 0 ? (
        <Card style={{ padding: 14, marginBottom: 14, backgroundColor: theme.warningBg }}>
          <Text style={[eyebrowStyle(theme.warningText), { marginBottom: 8 }]}>Vì sao điểm bị kéo xuống</Text>
          <View style={{ gap: 8 }}>
            {lowScoreReasons.map(reason => (
              <View key={`reason-${reason.key}`} style={{ gap: 2 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.warningText }}>{reason.label}</Text>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.warningText }}>{reason.text}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <PlayerQualityReport state={state} playersById={playersById} />
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Số trận mỗi người</Text>
        <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.secondaryContainer, padding: 10, marginBottom: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, lineHeight: 16, color: theme.primary }}>
            Cách đọc: mỗi vòng người chơi hoặc được xếp đánh, hoặc nghỉ vòng đó. Lượt nghỉ là số vòng không được xếp đánh. Max là số lượt nghỉ liên tiếp dài nhất. Ví dụ 8 vòng, đánh 6 trận thì nghỉ 2 lượt.
          </Text>
        </View>
        {summary.per_player.map(player => {
          const rest = restByPlayer.get(player.player_id)
          return (
            <View key={player.player_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <PlayerAvatar name={playerName(player.player_id, playersById)} size={26} />
              <View style={{ width: 92 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurface }} numberOfLines={1}>
                  {playerName(player.player_id, playersById)}
                </Text>
                <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 9.5, color: theme.outline }} numberOfLines={1}>
                  Nghỉ {rest?.total_rests ?? 0} lượt · max liên tiếp {rest?.max_consecutive_rest ?? player.max_consecutive_rest}
                </Text>
              </View>
              <View style={{ flex: 1, height: 8, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, overflow: 'hidden' }}>
                <View style={{ width: `${(player.matches_played / maxMatchesForChart) * 100}%`, height: '100%', backgroundColor: theme.primary }} />
              </View>
              <Text style={{ width: 20, textAlign: 'right', fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface }}>{player.matches_played}</Text>
            </View>
          )
        })}
      </Card>
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <Text style={[eyebrowStyle(theme.outline), { marginBottom: 10 }]}>Áp lực lặp partner (đồng đội)/đối thủ</Text>
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline, lineHeight: 17 }}>
          Mức {repeatRiskLabel(pressure.repeat_risk)} · hệ số giảm phạt {pressure.penalty_multiplier.toFixed(2)} · trung bình {pressure.avg_matches_per_player.toFixed(1)} trận/người · áp lực đối thủ {pressure.opponent_pressure.toFixed(2)}
        </Text>
        <Text style={{ marginTop: 6, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline, lineHeight: 17 }}>
          {backToBackSummary(pressure.play_ratio)} Back-to-back là người chơi đánh các vòng liền nhau không có lượt nghỉ xen giữa.
        </Text>
      </Card>
      <RepeatDetailsBlock partnerPairs={partner.repeat_pairs} opponentPairs={opponent.repeat_pairs} playersById={playersById} />
      <GroupAuditBlock state={state} groupSummaries={groupSummaries} playersById={playersById} />
      <OpponentBurdenSummary burden={burden} playersById={playersById} />
      {matchCountConsistencyRows.length > 0 ? (
        <Card style={{ padding: 14, marginBottom: 14, backgroundColor: theme.dangerBg }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.dangerText }}>Cảnh báo đồng bộ</Text>
          <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.dangerText }}>
            Live state khác replay từ lịch sử. Report đang dùng dữ liệu replay.
          </Text>
          <View style={{ marginTop: 8, gap: 4 }}>
            {matchCountConsistencyRows.slice(0, 8).map(row => (
              <Text key={`mismatch-${row.player_id}`} style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.dangerText }}>
                {playerName(row.player_id, playersById)}: live {row.live}, replay {row.replay}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity onPress={onContinue} style={{ flex: 1, height: 52, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={ctaTextStyle(theme.primary, 12)}>Chạy thêm vòng</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenHistory} style={{ flex: 1, height: 52, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={ctaTextStyle(theme.onPrimary, 12)}>Lịch sử vòng</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}
