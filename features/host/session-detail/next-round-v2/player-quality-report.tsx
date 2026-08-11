import { toDisplayCourtCycle } from '@/lib/next-round-suggester/round-numbering'
import React, { useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { BORDER, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import {
  computeAvailabilityMetrics,
  computeGenderPrefSatisfaction,
  computeMatchCountMetrics,
  computeOpponentDiversity,
  computeOpponentRepeatBurden,
  computePartnerDiversity,
  computePartnerRepeatBurden,
  computeRestFairness,
} from '@/lib/next-round-suggester/fairness/metrics'
import { computeRepeatPressure } from '@/lib/next-round-suggester/fairness/pressure'
import type { SessionLiveMatchRow, SessionState } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { Card, PlayerAvatar } from './components'
import { eyebrowStyle, playerName } from './helpers'

type PlayerQualityIssue = {
  label: string
  detail: string
  severity: 'watch' | 'priority'
}

type PlayerQualityRow = {
  player_id: string
  score: number
  label: string
  matches_played: number
  issues: PlayerQualityIssue[]
}

type MatchShortfallReason = {
  total_rounds: number
  rounds_available: number
  played_rounds: number
  benched_rounds: number
  absent_rounds: number
  capacity_limited_rounds: number
  benched_round_numbers: number[]
  absent_round_numbers: number[]
}

type RoundActivity = {
  round_no: number
  activity: 'played' | 'rested' | 'absent'
}

type MatchResult = {
  round_no: number | null
  court_idx: number | null
  score_a: number
  score_b: number
  won: boolean | null
  teammates: string[]
  opponents: string[]
}

function firstCompletedRoundStart(state: SessionState): number | null {
  const starts = state.rounds
    .filter(round => round.status === 'completed' && round.started_at)
    .map(round => round.started_at!.getTime())
  return starts.length > 0 ? Math.min(...starts) : null
}

function joinNames(ids: string[], playersById: Map<string, ArrangementPlayer>, limit = 3) {
  const names = ids.slice(0, limit).map(id => playerName(id, playersById))
  const remaining = Math.max(0, ids.length - limit)
  return remaining > 0 ? `${names.join(', ')} và ${remaining} người khác` : names.join(', ')
}

function qualityLabel(score: number, issues: PlayerQualityIssue[]) {
  if (issues.some(issue => issue.severity === 'priority')) return 'Cần giải thích'
  if (score >= 86) return 'Tốt'
  if (score >= 72) return 'Theo dõi'
  return 'Cần ưu tiên'
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getRoundRoster(round: SessionState['rounds'][number]) {
  return new Set([
    ...round.matches.flatMap(match => [...match.team_a, ...match.team_b]),
    ...round.resting,
  ])
}

function analyzeMatchShortfall(state: SessionState, playerId: string): MatchShortfallReason {
  const completedRounds = [...state.rounds]
    .filter(round => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
  let playedRounds = 0
  let benchedRounds = 0
  let absentRounds = 0
  let capacityLimitedRounds = 0
  const benchedRoundNumbers: number[] = []
  const absentRoundNumbers: number[] = []

  for (const round of completedRounds) {
    const playing = round.matches.some(match => (
      match.team_a.includes(playerId) || match.team_b.includes(playerId)
    ))
    const resting = round.resting.includes(playerId)
    const roster = getRoundRoster(round)
    const slots = round.matches.length * 4

    if (roster.size > slots) capacityLimitedRounds += 1
    if (playing) {
      playedRounds += 1
    } else if (resting) {
      benchedRounds += 1
      benchedRoundNumbers.push(round.round_no)
    } else {
      absentRounds += 1
      absentRoundNumbers.push(round.round_no)
    }
  }

  return {
    total_rounds: completedRounds.length,
    rounds_available: playedRounds + benchedRounds,
    played_rounds: playedRounds,
    benched_rounds: benchedRounds,
    absent_rounds: absentRounds,
    capacity_limited_rounds: capacityLimitedRounds,
    benched_round_numbers: benchedRoundNumbers,
    absent_round_numbers: absentRoundNumbers,
  }
}

function formatRoundList(rounds: number[], limit = 4) {
  if (rounds.length === 0) return ''
  const visible = rounds.slice(0, limit).join(', ')
  const remaining = rounds.length - limit
  return remaining > 0 ? `${visible} và ${remaining} vòng khác` : visible
}

function explainMatchShortfall(input: {
  player: { checked_in_at: Date; checked_out_at: Date | null; matches_played: number }
  expectedMatches: number
  matchDelta: number
  joinedLate: boolean
  checkedOut: boolean
  shortfall: MatchShortfallReason
}) {
  const parts = [
    `Đánh ${input.player.matches_played} trận, kỳ vọng khoảng ${input.expectedMatches.toFixed(1)} (thiếu ${Math.abs(input.matchDelta).toFixed(1)}).`,
  ]

  if (input.joinedLate) {
    parts.push(`Nguyên nhân chính: chỉ có mặt trong ${input.shortfall.rounds_available}/${input.shortfall.total_rounds} vòng được tính vì vào sau vòng đầu.`)
  } else if (input.checkedOut) {
    parts.push(`Nguyên nhân chính: đã check-out trước khi session kết thúc, nên không còn trong pool các vòng cuối.`)
  } else if (input.shortfall.absent_rounds > 0) {
    parts.push(`Nguyên nhân chính: không nằm trong roster ở ${input.shortfall.absent_rounds} vòng (${formatRoundList(input.shortfall.absent_round_numbers)}).`)
  } else if (input.shortfall.benched_rounds > 0) {
    parts.push(`Nguyên nhân chính: bị xếp nghỉ ${input.shortfall.benched_rounds}/${input.shortfall.rounds_available} vòng có mặt (${formatRoundList(input.shortfall.benched_round_numbers)}).`)
  } else {
    parts.push('Nguyên nhân chính: thiếu trận đến từ cách chia slot theo từng vòng, không phải do một lượt nghỉ riêng lẻ nổi bật.')
  }

  if (input.shortfall.capacity_limited_rounds > 0) {
    parts.push(`${input.shortfall.capacity_limited_rounds} vòng có nhiều người hơn slot sân, nên bắt buộc phải có người ngồi ngoài.`)
  }

  return parts.join(' ')
}

function getPlayerRoundActivity(state: SessionState, playerId: string): RoundActivity[] {
  return state.rounds
    .filter(round => round.status === 'completed')
    .sort((a, b) => a.round_no - b.round_no)
    .map(round => {
      const played = round.matches.some(m => m.team_a.includes(playerId) || m.team_b.includes(playerId))
      const rested = round.resting.includes(playerId)
      return {
        round_no: round.round_no,
        activity: played ? 'played' : rested ? 'rested' : 'absent',
      }
    })
}

function getPlayerMatchResults(
  liveMatchRows: SessionLiveMatchRow[],
  playerId: string,
  playersById: Map<string, ArrangementPlayer>,
): MatchResult[] {
  return liveMatchRows
    .filter(m => m.status === 'completed' && (m.team_a.includes(playerId) || m.team_b.includes(playerId)))
    .sort((a, b) => a.sequence_no - b.sequence_no)
    .map(m => {
      const inTeamA = m.team_a.includes(playerId)
      const teammates = (inTeamA ? m.team_a : m.team_b).filter(id => id !== playerId)
      const opponents = inTeamA ? m.team_b : m.team_a
      const hasScore = m.score_a > 0 || m.score_b > 0
      const won = hasScore
        ? inTeamA ? m.score_a > m.score_b : m.score_b > m.score_a
        : null
      return { round_no: m.round_no, court_idx: m.court_idx, score_a: m.score_a, score_b: m.score_b, won, teammates, opponents }
    })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function buildPlayerQualityRows(
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
): PlayerQualityRow[] {
  const match = computeMatchCountMetrics(state)
  const availability = computeAvailabilityMetrics(state)
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const rest = computeRestFairness(state)
  const pressure = computeRepeatPressure(state)
  const genderSatisfaction = computeGenderPrefSatisfaction(state)
  const firstStart = firstCompletedRoundStart(state)

  const availabilityById = new Map(availability.per_player.map(row => [row.player_id, row]))
  const partnerById = new Map(partner.per_player.map(row => [row.player_id, row]))
  const opponentById = new Map(opponent.per_player.map(row => [row.player_id, row]))
  const partnerBurdenById = new Map(partnerBurden.per_player.map(row => [row.player_id, row]))
  const opponentBurdenById = new Map(opponentBurden.per_player.map(row => [row.player_id, row]))
  const restById = new Map(rest.per_player.map(row => [row.player_id, row]))
  const genderById = new Map(genderSatisfaction.per_player.map(row => [row.player_id, row]))

  return [...state.players.values()].map(player => {
    const availabilityRow = availabilityById.get(player.player_id)
    const partnerRow = partnerById.get(player.player_id)
    const opponentRow = opponentById.get(player.player_id)
    const partnerRepeat = partnerBurdenById.get(player.player_id)
    const opponentRepeat = opponentBurdenById.get(player.player_id)
    const restRow = restById.get(player.player_id)
    const genderRow = genderById.get(player.player_id)
    const issues: PlayerQualityIssue[] = []
    let score = 100

    const expectedMatches = availabilityRow?.expected_matches ?? match.avg
    const matchDelta = availabilityRow
      ? player.matches_played - availabilityRow.expected_matches
      : player.matches_played - match.avg
    const joinedLate = firstStart !== null && player.checked_in_at.getTime() > firstStart
    const checkedOut = Boolean(player.checked_out_at)

    if (matchDelta <= -0.75) {
      score -= 18
      const shortfall = analyzeMatchShortfall(state, player.player_id)
      issues.push({
        label: 'Số trận thấp',
        detail: explainMatchShortfall({
          player,
          expectedMatches,
          matchDelta,
          joinedLate,
          checkedOut,
          shortfall,
        }),
        severity: joinedLate || checkedOut ? 'watch' : 'priority',
      })
    }

    if (matchDelta >= 1.25 && match.range > 1) {
      score -= 8
      issues.push({
        label: 'Số trận cao hơn nhóm',
        detail: `Đánh nhiều hơn kỳ vọng khoảng ${matchDelta.toFixed(1)} trận; nếu chạy tiếp nên nhường nhịp cho nhóm đang thiếu trận.`,
        severity: 'watch',
      })
    }

    if ((restRow?.max_consecutive_rest ?? 0) >= 2) {
      score -= 16
      issues.push({
        label: 'Nghỉ liên tiếp',
        detail: `Có lúc nghỉ liên tiếp ${restRow?.max_consecutive_rest ?? 0} lượt; vòng sau nên ưu tiên vào sân nếu người này còn active.`,
        severity: 'priority',
      })
    }

    if (partnerRow && player.matches_played >= 3 && partnerRow.diversity_ratio < 0.75) {
      score -= 12
      issues.push({
        label: 'Partner chưa đa dạng',
        detail: `Có ${partnerRow.unique_count}/${player.matches_played} partner khác nhau; một vài cặp bị dùng lại nhiều hơn lý tưởng.`,
        severity: 'watch',
      })
    }

    if (opponentRow && player.matches_played >= 3 && opponentRow.diversity_ratio < 0.75) {
      score -= 12
      issues.push({
        label: 'Đối thủ chưa đa dạng',
        detail: `Gặp ${opponentRow.unique_count}/${player.matches_played * 2} lượt đối thủ khác nhau; lịch đang xoay lại đối thủ cũ khá sớm.`,
        severity: 'watch',
      })
    }

    if (partnerRepeat && partnerRepeat.repeated_partners > 0) {
      const names = joinNames(partnerRepeat.repeated_partner_ids, playersById)
      score -= Math.min(16, partnerRepeat.repeated_partners * 6)
      issues.push({
        label: 'Lặp partner',
        detail: `Bị lặp partner với ${names}. ${pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme' ? 'Một phần do áp lực lặp của setup hiện tại cao.' : 'Nên đổi partner nếu chạy thêm vòng.'}`,
        severity: partnerRepeat.repeated_partners >= 2 ? 'priority' : 'watch',
      })
    }

    if (opponentRepeat && opponentRepeat.repeated_opponents > 0) {
      const names = joinNames(opponentRepeat.repeated_opponent_ids, playersById)
      score -= Math.min(18, opponentRepeat.repeated_opponents * 7)
      issues.push({
        label: 'Lặp đối thủ',
        detail: `Gặp lại đối thủ cũ: ${names}. ${pressure.repeat_risk === 'high' || pressure.repeat_risk === 'extreme' ? 'Setup này có pool đối thủ hẹp nên khó tránh hoàn toàn.' : 'Nên ưu tiên đổi đối thủ ở vòng sau.'}`,
        severity: opponentRepeat.repeated_opponents >= 2 ? 'priority' : 'watch',
      })
    }

    if (genderRow && player.matches_played >= 2) {
      const hasPartnerPref = player.partner_gender_pref !== 'any'
      const hasOpponentPref = player.opponent_gender_pref !== 'any'
      const partnerPct = Math.round(genderRow.partner_satisfaction_rate * 100)
      const opponentPct = Math.round(genderRow.opponent_satisfaction_rate * 100)
      const partnerPrefLabel = player.partner_gender_pref === 'M' ? 'nam' : 'nữ'
      const opponentPrefLabel = player.opponent_gender_pref === 'M' ? 'nam' : 'nữ'

      if (hasPartnerPref && genderRow.partner_satisfaction_rate < 0.6) {
        score -= genderRow.partner_satisfaction_rate < 0.3 ? 14 : 8
        issues.push({
          label: 'Sở thích đồng đội chưa được đáp ứng',
          detail: `Muốn đồng đội ${partnerPrefLabel} nhưng chỉ được xếp đúng ${partnerPct}% số trận. ${genderSatisfaction.unsatisfiable.length > 0 ? 'Số lượng người cùng giới trong session ít, khó đáp ứng hoàn toàn.' : 'Nên ưu tiên xếp đúng sở thích ở vòng sau.'}`,
          severity: genderRow.partner_satisfaction_rate < 0.3 ? 'priority' : 'watch',
        })
      }

      if (hasOpponentPref && genderRow.opponent_satisfaction_rate < 0.6) {
        score -= genderRow.opponent_satisfaction_rate < 0.3 ? 14 : 8
        issues.push({
          label: 'Sở thích đối thủ chưa được đáp ứng',
          detail: `Muốn đối thủ ${opponentPrefLabel} nhưng chỉ được xếp đúng ${opponentPct}% số trận. ${genderSatisfaction.unsatisfiable.length > 0 ? 'Số lượng người cùng giới trong session ít, khó đáp ứng hoàn toàn.' : 'Nên ưu tiên xếp đúng sở thích ở vòng sau.'}`,
          severity: genderRow.opponent_satisfaction_rate < 0.3 ? 'priority' : 'watch',
        })
      }
    }

    const finalScore = clampScore(score)
    return {
      player_id: player.player_id,
      score: finalScore,
      label: qualityLabel(finalScore, issues),
      matches_played: player.matches_played,
      issues,
    }
  }).sort((a, b) => {
    const priorityDiff =
      b.issues.filter(issue => issue.severity === 'priority').length -
      a.issues.filter(issue => issue.severity === 'priority').length
    if (priorityDiff !== 0) return priorityDiff
    if (a.score !== b.score) return a.score - b.score
    return playerName(a.player_id, playersById).localeCompare(playerName(b.player_id, playersById))
  })
}

function RoundActivityChips({ activities }: { activities: RoundActivity[] }) {
  const theme = useAppTheme()
  if (activities.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
      {activities.map(({ round_no, activity }) => {
        const played = activity === 'played'
        const absent = activity === 'absent'
        const bg = played ? theme.primary : absent ? theme.dangerBg : 'transparent'
        const border = played ? theme.primary : absent ? theme.dangerText : theme.outlineVariant
        const textColor = played ? theme.onPrimary : absent ? theme.dangerText : theme.outline
        return (
          <View
            key={round_no}
            style={{
              width: 26,
              height: 26,
              borderRadius: RADIUS.full,
              backgroundColor: bg,
              borderWidth: 1.5,
              borderColor: border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 10, color: textColor }}>
              {toDisplayCourtCycle(round_no)}
            </Text>
          </View>
        )
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, width: '100%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.outline }}>Đánh</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: theme.outlineVariant }} />
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.outline }}>Nghỉ</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.dangerBg, borderWidth: 1, borderColor: theme.dangerText }} />
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.outline }}>Vắng</Text>
        </View>
      </View>
    </View>
  )
}

function CheckInInfo({
  checkedInAt,
  checkedOutAt,
  joinedLate,
}: {
  checkedInAt: Date
  checkedOutAt: Date | null
  joinedLate: boolean
}) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
        Check-in {formatTime(checkedInAt)}
      </Text>
      {checkedOutAt && (
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
          · Check-out {formatTime(checkedOutAt)}
        </Text>
      )}
      {joinedLate && (
        <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.warningBg, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 9, color: theme.warningText }}>Đến muộn</Text>
        </View>
      )}
      {checkedOutAt && (
        <View style={{ borderRadius: RADIUS.full, backgroundColor: theme.warningBg, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 9, color: theme.warningText }}>Về sớm</Text>
        </View>
      )}
    </View>
  )
}


function PlayerCard({
  row,
  state,
  playersById,
  liveMatchRows,
  firstStart,
}: {
  row: PlayerQualityRow
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  liveMatchRows?: SessionLiveMatchRow[]
  firstStart: number | null
}) {
  const theme = useAppTheme()
  const [detailExpanded, setDetailExpanded] = useState(false)
  const player = state.players.get(row.player_id)
  const joinedLate = player != null && firstStart !== null && player.checked_in_at.getTime() > firstStart
  const roundActivities = useMemo(() => getPlayerRoundActivity(state, row.player_id), [state, row.player_id])
  const matchResults = useMemo(
    () => liveMatchRows ? getPlayerMatchResults(liveMatchRows, row.player_id, playersById) : [],
    [liveMatchRows, row.player_id, playersById],
  )

  const priority = row.issues.some(issue => issue.severity === 'priority')
  const tone = priority ? theme.warningText : row.issues.length > 0 ? theme.primary : theme.successText
  const hasAnyScore = matchResults.some(r => r.score_a > 0 || r.score_b > 0)

  const detailLabel = [
    matchResults.length > 0 ? `${matchResults.length} trận` : null,
    row.issues.length > 0 ? `${row.issues.length} vấn đề` : null,
  ].filter(Boolean).join(' · ')

  return (
    <View
      style={{
        borderRadius: RADIUS.md,
        backgroundColor: theme.surface,
        borderWidth: BORDER.hairline,
        borderColor: priority ? theme.warningStrong : theme.outlineVariant,
        padding: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar name={playerName(row.player_id, playersById)} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }} numberOfLines={1}>
            {playerName(row.player_id, playersById)}
          </Text>
          <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
            {row.matches_played} trận · {row.label}
          </Text>
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: tone }}>
          {row.score}
        </Text>
      </View>

      {player && (
        <CheckInInfo
          checkedInAt={player.checked_in_at}
          checkedOutAt={player.checked_out_at}
          joinedLate={joinedLate}
        />
      )}

      <RoundActivityChips activities={roundActivities} />

      <TouchableOpacity
        onPress={() => setDetailExpanded(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 }}
        activeOpacity={0.7}
      >
        <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: theme.primary }}>
          {detailExpanded ? '▲' : '▼'} Chi tiết{detailLabel ? ` (${detailLabel})` : ''}
        </Text>
      </TouchableOpacity>

      {detailExpanded && (
        <View style={{ marginTop: 8, gap: 8 }}>
          {matchResults.length > 0 && (
            <View style={{ gap: 6 }}>
              {matchResults.map((r, idx) => {
                const scoreLabel = hasAnyScore && (r.score_a > 0 || r.score_b > 0)
                  ? `${r.score_a} – ${r.score_b}`
                  : null
                const resultBadge = r.won === true ? 'Thắng' : r.won === false ? 'Thua' : null
                const badgeColor = r.won === true ? theme.successText : theme.dangerText
                const badgeBg = r.won === true ? theme.successBg : theme.dangerBg
                const courtLabel = r.court_idx != null ? `Sân ${r.court_idx + 1}` : null
                const roundLabel = r.round_no != null ? `Vòng ${toDisplayCourtCycle(r.round_no)}` : `Trận ${idx + 1}`
                return (
                  <View
                    key={idx}
                    style={{
                      borderRadius: RADIUS.sm,
                      backgroundColor: theme.secondaryContainer,
                      borderWidth: BORDER.hairline,
                      borderColor: theme.outlineVariant,
                      padding: 9,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: theme.onSurface }}>
                        {roundLabel}{courtLabel ? ` · ${courtLabel}` : ''}
                      </Text>
                      {scoreLabel && (
                        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: theme.onSurface }}>
                          {scoreLabel}
                        </Text>
                      )}
                      {resultBadge && (
                        <View style={{ borderRadius: RADIUS.full, backgroundColor: badgeBg, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 9, color: badgeColor }}>{resultBadge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 10.5, color: theme.outline, lineHeight: 15 }}>
                      Cùng: {joinNames(r.teammates, playersById)} · vs {joinNames(r.opponents, playersById)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}

          {row.issues.length === 0 ? (
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline, lineHeight: 16 }}>
              Chỉ số ổn: số trận, nghỉ, partner và đối thủ không có điểm cần giải thích.
            </Text>
          ) : (
            <View style={{ gap: 7 }}>
              {row.issues.slice(0, 4).map(issue => (
                <View key={`${row.player_id}-${issue.label}`} style={{ gap: 2 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11.5, color: issue.severity === 'priority' ? theme.warningText : theme.onSurface }}>
                    {issue.label}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline, lineHeight: 15 }}>
                    {issue.detail}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

export function PlayerQualityReport({
  state,
  playersById,
  liveMatchRows,
}: {
  state: SessionState
  playersById: Map<string, ArrangementPlayer>
  liveMatchRows?: SessionLiveMatchRow[]
}) {
  const theme = useAppTheme()
  const rows = useMemo(() => buildPlayerQualityRows(state, playersById), [state, playersById])
  const issueCount = rows.filter(row => row.issues.length > 0).length
  const firstStart = useMemo(() => firstCompletedRoundStart(state), [state])

  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={eyebrowStyle(theme.outline)}>Chất lượng từng người</Text>
          <Text style={{ marginTop: 3, fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline, lineHeight: 16 }}>
            Người nào có chỉ số chưa tốt sẽ có lý do cụ thể bên dưới.
          </Text>
        </View>
        <View style={{ borderRadius: RADIUS.full, backgroundColor: issueCount > 0 ? theme.warningBg : theme.successBg, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 11, color: issueCount > 0 ? theme.warningText : theme.successText }}>
            {issueCount} cần xem
          </Text>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        {rows.map(row => (
          <PlayerCard
            key={row.player_id}
            row={row}
            state={state}
            playersById={playersById}
            liveMatchRows={liveMatchRows}
            firstStart={firstStart}
          />
        ))}
      </View>
    </Card>
  )
}
