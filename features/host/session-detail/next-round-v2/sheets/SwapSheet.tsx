import React from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { BORDER, RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { auditManualSwap } from '@/lib/next-round-suggester/manual-swap'
import type { SessionState, SuggestionAlternative } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { useAppTheme } from '@/lib/theme-context'

import { PlayerAvatar, SheetTitle } from '../components'
import { ctaTextStyle, eyebrowStyle, playerName } from '../helpers'

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
    <View testID="nrv2-swap-sheet">
      <SheetTitle title="Đổi người" subtitle="Chọn người cần đổi, rồi chọn candidate được sắp theo cải thiện." />
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>1. Đổi ra</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {targetIds.map(playerId => {
          const active = swapFromPlayerId === playerId
          return (
            <TouchableOpacity
              key={playerId}
              testID={`nrv2-swap-from-${playerId}`}
              accessibilityState={{ selected: active }}
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
                  testID={`nrv2-swap-to-${playerId}`}
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
