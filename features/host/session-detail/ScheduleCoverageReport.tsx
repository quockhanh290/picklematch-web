import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

type ScheduledMatch = {
  teamA: string[]
  teamB: string[]
}

type PairIssue = {
  key: string
  names: string
  count: number
}

type PlayerCoverage = {
  id: string
  name: string
  games: number
  partners: number
  opponents: number
  missingPartners: string[]
  missingOpponents: string[]
}

type Props = {
  players: ArrangementPlayer[]
  schedule: ScheduledMatch[]
  mode: 'full' | 'limited'
  minGamesPerPlayer: number
  quality?: {
    runtimeMs: number
    timedOut: boolean
    fallbackUsed: boolean
  }
}

const pairKey = (a: string, b: string) => a < b ? `${a}_${b}` : `${b}_${a}`

function increment(map: Map<string, number>, a: string, b: string) {
  const key = pairKey(a, b)
  map.set(key, (map.get(key) || 0) + 1)
}

export function ScheduleCoverageReport({ players, schedule, mode, minGamesPerPlayer, quality }: Props) {
  const [expanded, setExpanded] = useState(false)
  const playerIds = useMemo(() => players.map(p => String(p.id)), [players])
  const playerNameById = useMemo(() => {
    const map = new Map<string, string>()
    players.forEach(player => map.set(String(player.id), player.name))
    return map
  }, [players])

  const report = useMemo(() => {
    const partnerMap = new Map<string, number>()
    const opponentMap = new Map<string, number>()
    const gamesCount = new Map<string, number>(playerIds.map(id => [id, 0]))
    const partnerByPlayer = new Map<string, Set<string>>(playerIds.map(id => [id, new Set<string>()]))
    const opponentByPlayer = new Map<string, Set<string>>(playerIds.map(id => [id, new Set<string>()]))

    schedule.forEach(match => {
      const teamA = match.teamA.map(String)
      const teamB = match.teamB.map(String)
      const all = [...teamA, ...teamB]

      all.forEach(id => gamesCount.set(id, (gamesCount.get(id) || 0) + 1))

      if (teamA.length === 2) {
        increment(partnerMap, teamA[0], teamA[1])
        partnerByPlayer.get(teamA[0])?.add(teamA[1])
        partnerByPlayer.get(teamA[1])?.add(teamA[0])
      }
      if (teamB.length === 2) {
        increment(partnerMap, teamB[0], teamB[1])
        partnerByPlayer.get(teamB[0])?.add(teamB[1])
        partnerByPlayer.get(teamB[1])?.add(teamB[0])
      }

      teamA.forEach(a => teamB.forEach(b => {
        increment(opponentMap, a, b)
        opponentByPlayer.get(a)?.add(b)
        opponentByPlayer.get(b)?.add(a)
      }))
    })

    const rows: PlayerCoverage[] = playerIds.map(id => {
      const otherIds = playerIds.filter(otherId => otherId !== id)
      const partnerSet = partnerByPlayer.get(id) || new Set<string>()
      const opponentSet = opponentByPlayer.get(id) || new Set<string>()

      return {
        id,
        name: playerNameById.get(id) || 'Player',
        games: gamesCount.get(id) || 0,
        partners: partnerSet.size,
        opponents: opponentSet.size,
        missingPartners: otherIds.filter(otherId => !partnerSet.has(otherId)).map(otherId => playerNameById.get(otherId) || 'Player'),
        missingOpponents: otherIds.filter(otherId => !opponentSet.has(otherId)).map(otherId => playerNameById.get(otherId) || 'Player'),
      }
    }).sort((a, b) => {
      if (a.games !== b.games) return a.games - b.games
      if (a.partners !== b.partners) return a.partners - b.partners
      if (a.opponents !== b.opponents) return a.opponents - b.opponents
      return a.name.localeCompare(b.name)
    })

    const repeatedPartners: PairIssue[] = []
    const repeatedOpponents: PairIssue[] = []
    partnerMap.forEach((count, key) => {
      if (count <= 1) return
      const [a, b] = key.split('_')
      repeatedPartners.push({
        key,
        names: `${playerNameById.get(a) || 'Player'} / ${playerNameById.get(b) || 'Player'}`,
        count,
      })
    })
    opponentMap.forEach((count, key) => {
      if (count <= 2) return
      const [a, b] = key.split('_')
      repeatedOpponents.push({
        key,
        names: `${playerNameById.get(a) || 'Player'} / ${playerNameById.get(b) || 'Player'}`,
        count,
      })
    })

    const games = rows.map(row => row.games)
    const targetGames = mode === 'limited' ? Math.min(minGamesPerPlayer, Math.max(1, playerIds.length - 1)) : Math.max(1, playerIds.length - 1)
    const underTarget = rows.filter(row => row.games < targetGames)
    const fullPartnerRows = rows.filter(row => row.partners >= playerIds.length - 1)
    const fullOpponentRows = rows.filter(row => row.opponents >= playerIds.length - 1)

    return {
      rows,
      targetGames,
      underTarget,
      repeatedPartners: repeatedPartners.sort((a, b) => b.count - a.count || a.names.localeCompare(b.names)),
      repeatedOpponents: repeatedOpponents.sort((a, b) => b.count - a.count || a.names.localeCompare(b.names)),
      minGames: games.length ? Math.min(...games) : 0,
      maxGames: games.length ? Math.max(...games) : 0,
      fullPartnerCount: fullPartnerRows.length,
      fullOpponentCount: fullOpponentRows.length,
    }
  }, [minGamesPerPlayer, mode, playerIds, playerNameById, schedule])

  if (schedule.length === 0 || players.length < 4) return null

  const visibleRows = expanded ? report.rows : report.rows.slice(0, 5)
  const hasWarnings = report.underTarget.length > 0 || report.repeatedPartners.length > 0 || report.repeatedOpponents.length > 0

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: hasWarnings ? '#F5DFA0' : '#D9E9DF' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>
            BÁO CÁO ĐỘ PHỦ LỊCH
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
            Kiểm tra lịch vừa tạo trước khi bắt đầu đánh.
          </Text>
        </View>
        <View style={{ backgroundColor: hasWarnings ? '#FFF4D6' : '#E1F5EE', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: hasWarnings ? '#854F0B' : '#0F6E56', fontWeight: '900' }}>
            {hasWarnings ? 'CẦN XEM' : 'ỔN'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { label: 'Trận', value: `${schedule.length}` },
          { label: 'Game/ng', value: `${report.minGames}-${report.maxGames}` },
          { label: 'Full partner', value: `${report.fullPartnerCount}/${players.length}` },
          { label: 'Full đối thủ', value: `${report.fullOpponentCount}/${players.length}` },
        ].map(item => (
          <View key={item.label} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#E5E3DC' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800' }}>{item.label}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 2 }}>{item.value}</Text>
          </View>
        ))}
      </View>

      {report.underTarget.length > 0 && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15, marginBottom: 8 }}>
          Chưa đủ mục tiêu {report.targetGames} trận: {report.underTarget.map(row => `${row.name} (${row.games})`).join(', ')}
        </Text>
      )}

      {quality?.timedOut && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15, marginBottom: 8 }}>
          Scheduler đã dừng sau {Math.round(quality.runtimeMs)}ms để tránh treo UI. Lịch này có thể chưa tối ưu tuyệt đối.
        </Text>
      )}

      {(report.repeatedPartners.length > 0 || report.repeatedOpponents.length > 0) && (
        <View style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: '#F5DFA0', marginBottom: 10 }}>
          {report.repeatedPartners.length > 0 && (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15 }}>
              Partner lặp: {report.repeatedPartners.slice(0, 4).map(item => `${item.names} x${item.count}`).join(', ')}
            </Text>
          )}
          {report.repeatedOpponents.length > 0 && (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15, marginTop: report.repeatedPartners.length > 0 ? 4 : 0 }}>
              Đối thủ lặp nhiều: {report.repeatedOpponents.slice(0, 4).map(item => `${item.names} x${item.count}`).join(', ')}
            </Text>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        {visibleRows.map(row => (
          <View key={row.id} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: '#E8E2D6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '900' }}>{row.name}</Text>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: row.games >= report.targetGames ? '#0F6E56' : '#854F0B', fontWeight: '900' }}>
                {row.games}/{report.targetGames} trận
              </Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 5 }}>
              Partner {row.partners}/{players.length - 1} | Đối thủ {row.opponents}/{players.length - 1}
            </Text>
            {(row.missingPartners.length > 0 || row.missingOpponents.length > 0) && (
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#9C968A', lineHeight: 14, marginTop: 4 }} numberOfLines={expanded ? undefined : 2}>
                Thiếu partner: {row.missingPartners.length ? row.missingPartners.join(', ') : 'không'} | Thiếu đối thủ: {row.missingOpponents.length ? row.missingOpponents.join(', ') : 'không'}
              </Text>
            )}
          </View>
        ))}
      </View>

      {report.rows.length > 5 && (
        <TouchableOpacity onPress={() => setExpanded(prev => !prev)} style={{ alignSelf: 'center', paddingTop: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
            {expanded ? 'Thu gọn báo cáo' : `Xem tất cả ${report.rows.length} người`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
