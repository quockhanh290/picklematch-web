import React, { memo, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { ChevronDown, History, UserMinus, UserPlus, Users, X, Zap } from 'lucide-react-native'

import { BORDER, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { GroupSummary } from '@/lib/next-round-suggester/fairness/group-audit'
import type { SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { Card, MiniAction, PlayerAvatar, SheetTitle } from '../components'
import { ctaTextStyle, eyebrowStyle, getPlayerPvna, playerName } from '../helpers'

type RosterPlayerRowProps = {
  row: SessionPlayerStateRow
  player: ArrangementPlayer | undefined
  consecutiveRest: number
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
  row, player, consecutiveRest, expanded, selectedForGroup, inActiveRound, onExpand,
  onToggleCheckout, onToggleRest, onToggleGroupSelection, onClearGroup, onSwap,
}: RosterPlayerRowProps) {
  const theme = useAppTheme()
  const playerId = row.player_id
  const checkedOut = Boolean(row.checked_out_at)
  const resting = !checkedOut && row.opted_rest
  const name = player?.name ?? 'Người chơi'
  const cardBg = checkedOut ? theme.surfaceContainerLow : resting ? theme.warningBg : undefined
  const infoColor = resting ? theme.warningText : theme.outline
  const infoSuffix = checkedOut ? 'đã check-out' : resting ? 'đang xin nghỉ' : `nghỉ liên tiếp ${consecutiveRest} lượt`
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
  consecutiveRestByPlayer,
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
  consecutiveRestByPlayer?: Map<string, number>
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
                consecutiveRest={consecutiveRestByPlayer?.get(row.player_id) ?? row.consecutive_rest ?? 0}
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
              consecutiveRest={consecutiveRestByPlayer?.get(item.row.player_id) ?? item.row.consecutive_rest ?? 0}
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
