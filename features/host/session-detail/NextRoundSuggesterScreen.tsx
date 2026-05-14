import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { CheckCircle2, Play, RefreshCcw, UserMinus, UserPlus } from 'lucide-react-native'

import { AppLoading } from '@/components/design'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type {
  Match,
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
  return team.reduce((sum, id) => sum + (state.players.get(id)?.elo ?? 1000), 0) / 2
}

function getMatchLabel(match: Match, playersById: Map<string, ArrangementPlayer>) {
  const teamA = match.team_a.map(id => playerName(id, playersById)).join(' / ')
  const teamB = match.team_b.map(id => playerName(id, playersById)).join(' / ')
  return `${teamA}  vs  ${teamB}`
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

export function NextRoundSuggesterScreen({ sessionId, players, courts }: Props) {
  const theme = useAppTheme()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [rows, setRows] = useState<LiveRows>({ playerRows: [], pairRows: [], roundRows: [] })
  const [selectedAlternative, setSelectedAlternative] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pvnaTolerance, setPvnaTolerance] = useState(0.5)
  const [courtCount, setCourtCount] = useState(Math.max(1, Math.min(4, courts)))
  const [swapFromPlayerId, setSwapFromPlayerId] = useState<string | null>(null)
  const [manualAlternative, setManualAlternative] = useState<SuggestionAlternative | null>(null)
  const [groupSelection, setGroupSelection] = useState<string[]>([])

  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed' || !player.status),
    [players],
  )
  const checkedInPlayers = useMemo(
    () => confirmedPlayers.filter(player => player.checkInStatus === 'present' || !player.checkInStatus),
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
        players: { elo: getPlayerPvna(playersById.get(row.player_id)) },
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

  const state = useMemo(() => mapRowsToSessionState({
    sessionId,
    playerRows: rows.playerRows.map(row => ({
      ...row,
      players: { elo: getPlayerPvna(playersById.get(row.player_id)) || row.players?.elo || 0 },
    })),
    pairRows: rows.pairRows,
    roundRows: rows.roundRows,
    courts: courtCount,
    eloTolerance: pvnaTolerance,
  }), [courtCount, playersById, pvnaTolerance, rows, sessionId])

  state.config.weights = {
    ...state.config.weights,
    elo: 100,
  }

  const suggestion = useMemo(() => suggestNextRound(state), [state])
  const activeRound = useMemo(
    () => rows.roundRows.find(row => row.status === 'active') ?? null,
    [rows.roundRows],
  )
  const presentCount = rows.playerRows.filter(row => !row.checked_out_at).length
  const optedRestCount = rows.playerRows.filter(row => !row.checked_out_at && row.opted_rest).length
  const completedRounds = rows.roundRows.filter(row => row.status === 'completed').sort((a, b) => b.round_no - a.round_no)

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
      await invokeLiveSessionFunction('session-sync-roster', sessionId, {
        player_ids: checkedInPlayers.map(player => String(player.id)),
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

      await invokeLiveSessionFunction('session-rounds-end', sessionId, {}, { round_no: activeRound.round_no })
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

  const selected = suggestion.alternatives[selectedAlternative] ?? suggestion.alternatives[0]
  const workingAlternative = manualAlternative ?? selected

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
            {[1, 2, 3, 4].map(value => {
              const active = courtCount === value
              const disabled = value > Math.max(1, Math.floor(presentCount / 4))
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
                      {shortGroupId(row.group_id)}
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
                      PVNA {getPlayerPvna(player).toFixed(2)} · Trận {row.matches_played} · Nghỉ {row.consecutive_rest} · Chơi liền {row.consecutive_play}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <MiniButton
                      label={groupSelection.includes(row.player_id) ? 'Picked' : 'Group'}
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
                  label="Start selected round"
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
    { label: 'PVNA diff tổng', value: alternative.stats.elo_diff.toFixed(2), tone: '#0F6E56' },
    { label: 'Partner lặp', value: String(alternative.stats.partner_repeats), tone: '#A05A16' },
    { label: 'Đối thủ lặp', value: String(alternative.stats.opponent_repeats), tone: '#7C3AED' },
    { label: 'Group bonus', value: String(alternative.stats.group_bonus), tone: '#2563EB' },
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
  return (
    <View style={{ backgroundColor: '#F8F3E8', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#0F6E56', fontWeight: '900' }}>
        Sân {match.court_idx + 1} · PVNA diff {diff.toFixed(2)}
      </Text>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 6, lineHeight: 18 }}>
        {getMatchLabel(match, playersById)}
      </Text>
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
