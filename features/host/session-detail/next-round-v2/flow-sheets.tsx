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
  SessionLiveMatchRow,
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
    const repeated = pairs.filter(pair => pair.count > 1).sort((a, b) => b.count - a.count)
    if (repeated.length === 0) {
      return <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Không có cặp nào gặp lại.</Text>
    }
    return repeated.map((pair, index) => {
      const repeatCount = pair.count - 1
      const isHigh = repeatCount >= 2
      const badgeBg = isHigh ? theme.dangerBg : theme.warningBg
      const badgeText = isHigh ? theme.dangerText : theme.warningText
      const isLast = index === repeated.length - 1
      return (
        <View
          key={`${pair.player_a}-${pair.player_b}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: isLast ? 0 : BORDER.hairline, borderBottomColor: theme.outlineVariant }}
        >
          <View style={{ flexDirection: 'row' }}>
            <PlayerAvatar name={playerName(pair.player_a, playersById)} size={28} />
            <View style={{ marginLeft: -8 }}>
              <PlayerAvatar name={playerName(pair.player_b, playersById)} size={28} />
            </View>
          </View>
          <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface }} numberOfLines={1}>
            {playerName(pair.player_a, playersById)} + {playerName(pair.player_b, playersById)}
          </Text>
          <View style={{ backgroundColor: badgeBg, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: badgeText }}>
              lặp {repeatCount}×
            </Text>
          </View>
        </View>
      )
    })
  }

  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 12 }]}>Các cặp gặp nhau nhiều lần</Text>
      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Đồng đội</Text>
      <View style={{ marginBottom: 12 }}>{renderPairs(partnerPairs)}</View>
      <View style={{ height: BORDER.hairline, backgroundColor: theme.outlineVariant, marginBottom: 12 }} />
      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 12, color: theme.onSurface, marginBottom: 6 }}>Đối thủ</Text>
      <View>{renderPairs(opponentPairs)}</View>
    </Card>
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
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 12 }]}>Ai gặp lại đối thủ nhiều nhất</Text>
      {rows.length === 0 ? (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Không ai gặp lại đối thủ cũ.</Text>
      ) : (
        <View style={{ gap: 2 }}>
          {rows.map((row, index) => {
            const isHigh = row.repeated_opponents >= 2
            const isLast = index === rows.length - 1
            return (
              <View
                key={`burden-${row.player_id}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: isLast ? 0 : BORDER.hairline, borderBottomColor: theme.outlineVariant }}
              >
                <PlayerAvatar name={playerName(row.player_id, playersById)} size={30} />
                <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurface }}>
                  {playerName(row.player_id, playersById)}
                </Text>
                <View style={{ backgroundColor: isHigh ? theme.dangerBg : theme.surfaceContainerLow, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: isHigh ? theme.dangerText : theme.outline }}>
                    {row.repeated_opponents} đối thủ
                  </Text>
                </View>
              </View>
            )
          })}
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
  liveMatchRows,
  onOpenHistory,
  onContinue,
}: {
  summary: ReturnType<typeof sanitizeSummaryForHost>
  state: SessionState
  matchCountConsistencyRows: MatchCountConsistencyRow[]
  groupSummaries: GroupSummary[]
  playersById: Map<string, ArrangementPlayer>
  liveMatchRows?: SessionLiveMatchRow[]
  onOpenHistory: () => void
  onContinue: () => void
}) {
  const theme = useAppTheme()
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
      <PlayerQualityReport state={state} playersById={playersById} liveMatchRows={liveMatchRows} />
      <Card style={{ padding: 14, marginBottom: 14 }}>
        <Text style={[eyebrowStyle(theme.outline), { marginBottom: 12 }]}>Độ đa dạng thi đấu</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <View style={{
            backgroundColor: pressure.repeat_risk === 'low' ? theme.secondaryContainer : pressure.repeat_risk === 'medium' ? theme.warningBg : theme.dangerBg,
            borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4,
          }}>
            <Text style={{
              fontFamily: SCREEN_FONTS.bold, fontSize: 12,
              color: pressure.repeat_risk === 'low' ? theme.primary : pressure.repeat_risk === 'medium' ? theme.warningText : theme.dangerText,
            }}>
              Mức {repeatRiskLabel(pressure.repeat_risk)}
            </Text>
          </View>
          <View style={{ backgroundColor: theme.surfaceContainerLow, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>
              TB {pressure.avg_matches_per_player.toFixed(1)} trận/người
            </Text>
          </View>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline, lineHeight: 17 }}>
          {pressure.play_ratio <= 0.55
            ? 'Phần lớn mọi người có ít nhất 1 vòng nghỉ xen giữa các trận.'
            : pressure.play_ratio <= 0.7
              ? `${Math.round(pressure.play_ratio * 100)}% người đánh liên tiếp không có vòng nghỉ xen giữa.`
              : `${Math.round(pressure.play_ratio * 100)}% người đánh liên tiếp — session dày, ít cơ hội nghỉ.`}
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
                {playerName(row.player_id, playersById)}: trận {row.live}/{row.replay} · nghỉ {row.live_consecutive_rest}/{row.replay_consecutive_rest} · đánh liền {row.live_consecutive_play}/{row.replay_consecutive_play} · partner {row.live_partner_total}/{row.replay_partner_total} · đối thủ {row.live_opponent_total}/{row.replay_opponent_total}
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

export * from './sheets/SwapSheet'
export * from './sheets/RosterSheet'
export * from './sheets/LateArrivalsSheet'
export * from './sheets/HistorySheet'
export * from './sheets/MoreSheet'
