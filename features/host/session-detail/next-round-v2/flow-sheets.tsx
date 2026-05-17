import React from 'react'
import { ActivityIndicator, FlatList, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { ChevronDown, History, UserMinus, UserPlus, Users, X, Zap } from 'lucide-react-native'

import { BORDER, RADIUS, SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { auditManualSwap } from '@/lib/next-round-suggester/manual-swap'
import { buildGroupAuditRows, type GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import {
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

export function RosterSheet({
  rows,
  playersById,
  expandedPlayerId,
  setExpandedPlayerId,
  busy,
  onToggleCheckout,
  onToggleRest,
  onSwap,
  onSyncRoster,
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
  expandedPlayerId: string | null
  setExpandedPlayerId: (playerId: string | null) => void
  busy: string | null
  onToggleCheckout: (playerId: string, checkedOut: boolean) => void
  onToggleRest: (playerId: string, optedRest: boolean) => void
  onSwap: (playerId: string) => void
  onSyncRoster: () => void
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
  return (
    <FlatList
      data={rows}
      keyExtractor={row => row.player_id}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={(
        <View>
      <SheetTitle title="Người chơi" subtitle="Tap từng người để check-out, xin nghỉ, group hoặc swap." />
      <TouchableOpacity onPress={onSyncRoster} style={{ height: 44, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        {busy === 'sync' ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 13)}>Sync roster</Text>}
      </TouchableOpacity>
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      renderItem={({ item: row }) => {
          const playerId = row.player_id
          const player = playersById.get(playerId)
          const expanded = expandedPlayerId === playerId
          const checkedOut = Boolean(row.checked_out_at)
          const selectedForGroup = groupSelection.includes(playerId)
          return (
            <Card key={playerId} style={{ borderRadius: RADIUS.md, overflow: 'hidden', borderColor: selectedForGroup ? theme.primary : theme.outlineVariant }}>
              <TouchableOpacity onPress={() => setExpandedPlayerId(expanded ? null : playerId)} style={{ minHeight: 60, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <PlayerAvatar name={playerName(playerId, playersById)} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 13, color: theme.onSurface }}>{playerName(playerId, playersById)}</Text>
                  <Text style={{ marginTop: 2, fontFamily: SCREEN_FONTS.body, fontSize: 11, color: theme.outline }}>
                    PVNA {(getPlayerPvna(player) ?? 0).toFixed(2)} · {row.matches_played} trận · đang nghỉ liên tiếp {row.consecutive_rest} lượt
                  </Text>
                </View>
                <ChevronDown size={16} color={theme.outline} />
              </TouchableOpacity>
              {expanded ? (
                <View style={{ borderTopWidth: BORDER.hairline, borderTopColor: theme.outlineVariant, padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <MiniAction label={checkedOut ? 'Check-in' : 'Check-out'} icon={checkedOut ? UserPlus : UserMinus} onPress={() => onToggleCheckout(playerId, checkedOut)} tone={checkedOut ? 'good' : 'danger'} />
                  <MiniAction label={row.opted_rest ? 'Bỏ nghỉ' : 'Xin nghỉ'} icon={History} onPress={() => onToggleRest(playerId, row.opted_rest)} tone="neutral" />
                  <MiniAction label={selectedForGroup ? 'Bỏ chọn' : 'Chọn group'} icon={Users} onPress={() => onToggleGroupSelection(playerId)} tone={selectedForGroup ? 'good' : 'neutral'} />
                  {row.group_id ? <MiniAction label="Xóa group" icon={X} onPress={() => onClearGroup(playerId)} tone="neutral" /> : null}
                  <MiniAction label="Swap" icon={Zap} onPress={() => onSwap(playerId)} tone="good" />
                </View>
              ) : null}
            </Card>
          )
        }}
      ListFooterComponent={rows.length > 0 ? (
        <View style={{ marginTop: 14, gap: 10 }}>
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
              Chọn 2+ người chơi để tạo group. Engine sẽ ưu tiên xếp họ cùng team hoặc cùng sân nhưng không bắt buộc.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={onCreateGroup}
              disabled={groupSelection.length < 2 || Boolean(busy?.startsWith('group-'))}
              style={{ flex: 1, height: 48, borderRadius: RADIUS.md, backgroundColor: groupSelection.length >= 2 ? theme.primary : theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
            >
              {busy?.startsWith('group-') ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={ctaTextStyle(theme.onPrimary, 12)}>Tạo group ({groupSelection.length})</Text>}
            </TouchableOpacity>
            {groupSelection.length > 0 ? (
              <TouchableOpacity onPress={onClearGroupSelection} style={{ width: 48, height: 48, borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color={theme.onSurface} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    />
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
        <SheetAction label="Sync roster" onPress={onSyncRoster} loading={busy === 'sync'} />
        <SheetAction label="Người chơi" onPress={onOpenRoster} />
        <SheetAction label="Fairness audit" onPress={onOpenFairness} />
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
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>Group audit</Text>
      {rows.length === 0 ? (
        <View style={{ borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, padding: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 11.5, color: theme.outline }}>Chưa có group nào được tạo.</Text>
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
                    {playerName(pair.player_a, playersById)} / {playerName(pair.player_b, playersById)}: {pair.count} trận chung team
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
  const partner = computePartnerDiversity(state)
  const opponent = computeOpponentDiversity(state)
  const burden = computeOpponentRepeatBurden(state)
  const pressure = computeRepeatPressure(state)
  const restByPlayer = new Map(computeRestFairness(state).per_player.map(player => [player.player_id, player]))
  const maxMatchesForChart = Math.max(1, ...summary.per_player.map(item => item.matches_played))
  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 48 }}>
      <LinearGradient colors={[theme.heroGradientStart, theme.primaryContainer]} style={{ borderRadius: RADIUS.lg, padding: 18, marginBottom: 14 }}>
        <Text style={eyebrowStyle(theme.heroCountdownText)}>Session đã hoàn tất</Text>
        <Text style={{ marginTop: 8, fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 36, color: theme.surface }}>
          {summary.total_rounds} vòng
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.heroBodyMuted }}>
          {summary.total_players} người chơi · điểm fairness tổng session
        </Text>
      </LinearGradient>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 46, color: theme.primary }}>
          {summary.fairness_score.total}<Text style={{ fontSize: 18 }}>/100</Text>
        </Text>
        {Object.entries(summary.fairness_score.breakdown).map(([key, value]) => (
          <BreakdownRow key={key} label={fairnessBreakdownLabel(key)} value={Number(value)} max={fairnessBreakdownMax(key)} detail="" />
        ))}
      </Card>
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
