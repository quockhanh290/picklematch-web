import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

type ScheduledMatch = {
  teamA: string[]
  teamB: string[]
  rotation?: number
  court?: number
  teamANo?: number
  teamBNo?: number
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

type PreferenceMiss = {
  key: string
  playerName: string
  type: 'partner' | 'opponent'
  preferred: string
  actual: string
}

type MatchQuality = {
  key: string
  label: string
  teamALabel: string
  teamBLabel: string
  teamASkill: number
  teamBSkill: number
  skillGap: number
  partnerPrefHits: number
  partnerPrefTotal: number
  opponentPrefHits: number
  opponentPrefTotal: number
}

type Props = {
  players: ArrangementPlayer[]
  schedule: ScheduledMatch[]
  mode: 'full' | 'limited'
  minGamesPerPlayer: number
  variant?: 'mix-in' | 'fixed'
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

function normalizeGender(value?: string | null) {
  const gender = String(value || '').toLowerCase()
  if (gender === 'female' || gender === 'f' || gender === 'nữ' || gender === 'nu') return 'female'
  if (gender === 'male' || gender === 'm' || gender === 'nam') return 'male'
  return null
}

function matchesGenderPref(player: ArrangementPlayer | undefined, pref?: string | null) {
  if (!player || !pref || pref === 'any') return true
  return normalizeGender(player.gender) === pref
}

function getPlayerSkill(player: ArrangementPlayer | undefined) {
  if (!player) return 0
  return Number(player.pvna ?? (player.elo / 100) ?? 0)
}

function formatPrefLabel(pref?: string | null) {
  if (pref === 'male') return 'Nam'
  if (pref === 'female') return 'Nữ'
  return 'Bất kỳ'
}

function formatPlayerList(players: (ArrangementPlayer | undefined)[]) {
  return players.map(player => player?.name || 'N/A').join(' / ')
}

export function ScheduleCoverageReport({ players, schedule, mode, minGamesPerPlayer, variant = 'mix-in', quality }: Props) {
  const [expanded, setExpanded] = useState(false)
  const playerIds = useMemo(() => players.map(p => String(p.id)), [players])
  const playerNameById = useMemo(() => {
    const map = new Map<string, string>()
    players.forEach(player => map.set(String(player.id), player.name))
    return map
  }, [players])
  const playerById = useMemo(() => {
    const map = new Map<string, ArrangementPlayer>()
    players.forEach(player => map.set(String(player.id), player))
    return map
  }, [players])

  const report = useMemo(() => {
    const partnerMap = new Map<string, number>()
    const opponentMap = new Map<string, number>()
    const gamesCount = new Map<string, number>(playerIds.map(id => [id, 0]))
    const playerRotations = new Map<string, number[]>(playerIds.map(id => [id, []]))
    const partnerByPlayer = new Map<string, Set<string>>(playerIds.map(id => [id, new Set<string>()]))
    const opponentByPlayer = new Map<string, Set<string>>(playerIds.map(id => [id, new Set<string>()]))

    let partnerPrefHits = 0
    let partnerPrefTotal = 0
    let opponentPrefHits = 0
    let opponentPrefTotal = 0
    let fixedPartnerPrefHits = 0
    let fixedPartnerPrefTotal = 0
    let totalSkillGap = 0
    let maxSkillGap = 0
    const preferenceMisses: PreferenceMiss[] = []
    const matchQualities: MatchQuality[] = []

    schedule.forEach((match, matchIndex) => {
      const teamA = match.teamA.map(String)
      const teamB = match.teamB.map(String)
      const all = [...teamA, ...teamB]
      const teamAPlayers = teamA.map(id => playerById.get(id))
      const teamBPlayers = teamB.map(id => playerById.get(id))
      const teamASkill = teamA.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)), 0)
      const teamBSkill = teamB.reduce((sum, id) => sum + getPlayerSkill(playerById.get(id)), 0)
      const skillGap = Math.abs(teamASkill - teamBSkill)
      let matchPartnerPrefHits = 0
      let matchPartnerPrefTotal = 0
      let matchOpponentPrefHits = 0
      let matchOpponentPrefTotal = 0
      totalSkillGap += skillGap
      maxSkillGap = Math.max(maxSkillGap, skillGap)

      all.forEach(id => {
        gamesCount.set(id, (gamesCount.get(id) || 0) + 1)
        if (!playerRotations.has(id)) playerRotations.set(id, [])
        playerRotations.get(id)!.push(match.rotation || 0)
      })

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

      all.forEach((id, playerIndex) => {
        const player = playerById.get(id)
        const partners = (teamA.includes(id) ? teamA : teamB)
          .filter(otherId => otherId !== id)
          .map(otherId => playerById.get(otherId))
        const opponents = (teamA.includes(id) ? teamB : teamA).map(otherId => playerById.get(otherId))

        if (player?.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any') {
          partnerPrefTotal++
          matchPartnerPrefTotal++
          if (partners.some(partner => matchesGenderPref(partner, player.metadata.partner_gender_pref))) {
            partnerPrefHits++
            matchPartnerPrefHits++
          } else {
            preferenceMisses.push({
              key: `${matchIndex}-${id}-${playerIndex}-partner`,
              playerName: player.name,
              type: 'partner',
              preferred: formatPrefLabel(player.metadata.partner_gender_pref),
              actual: formatPlayerList(partners),
            })
          }
        }
        if (player?.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any') {
          opponentPrefTotal++
          matchOpponentPrefTotal++
          if (opponents.some(opponent => matchesGenderPref(opponent, player.metadata.opponent_gender_pref))) {
            opponentPrefHits++
            matchOpponentPrefHits++
          } else {
            preferenceMisses.push({
              key: `${matchIndex}-${id}-${playerIndex}-opponent`,
              playerName: player.name,
              type: 'opponent',
              preferred: formatPrefLabel(player.metadata.opponent_gender_pref),
              actual: formatPlayerList(opponents),
            })
          }
        }
      })

      matchQualities.push({
        key: `${match.rotation || 0}-${match.court || 0}-${matchIndex}`,
        label: match.rotation ? `Vòng ${match.rotation}${match.court ? ` · Sân ${match.court}` : ''}` : `Trận ${matchIndex + 1}`,
        teamALabel: `${match.teamANo ? `Đội ${match.teamANo}: ` : ''}${formatPlayerList(teamAPlayers)}`,
        teamBLabel: `${match.teamBNo ? `Đội ${match.teamBNo}: ` : ''}${formatPlayerList(teamBPlayers)}`,
        teamASkill,
        teamBSkill,
        skillGap,
        partnerPrefHits: matchPartnerPrefHits,
        partnerPrefTotal: matchPartnerPrefTotal,
        opponentPrefHits: matchOpponentPrefHits,
        opponentPrefTotal: matchOpponentPrefTotal,
      })
    })

    if (variant === 'fixed') {
      playerIds.forEach(id => {
        const player = playerById.get(id)
        if (!player?.metadata?.partner_gender_pref || player.metadata.partner_gender_pref === 'any') return
        fixedPartnerPrefTotal++
        const partnerIds = partnerByPlayer.get(id) || new Set<string>()
        const matched = [...partnerIds].some(partnerId => matchesGenderPref(playerById.get(partnerId), player.metadata.partner_gender_pref))
        if (matched) fixedPartnerPrefHits++
      })
    }

    const rows: PlayerCoverage[] = playerIds.map(id => {
      const otherIds = playerIds.filter(otherId => otherId !== id)
      const partnerSet = partnerByPlayer.get(id) || new Set<string>()
      const opponentSet = opponentByPlayer.get(id) || new Set<string>()

      const opponentPool = variant === 'fixed'
        ? otherIds.filter(otherId => !partnerSet.has(otherId))
        : otherIds

      return {
        id,
        name: playerNameById.get(id) || 'Player',
        games: gamesCount.get(id) || 0,
        partners: partnerSet.size,
        opponents: opponentSet.size,
        avgRest: (() => {
          const rots = (playerRotations.get(id) || []).sort((a, b) => a - b)
          const games = gamesCount.get(id) || 0
          if (games <= 1) return '-'
          let totalGap = 0
          for (let i = 0; i < rots.length - 1; i++) totalGap += (rots[i+1] - rots[i] - 1)
          return (totalGap / (games - 1)).toFixed(1)
        })(),
        consecutive: (() => {
          const rots = (playerRotations.get(id) || []).sort((a, b) => a - b)
          let count = 0
          for (let i = 0; i < rots.length - 1; i++) if (rots[i+1] - rots[i] === 1) count++
          return count
        })(),
        rotations: (playerRotations.get(id) || []).sort((a, b) => a - b),
        missingPartners: variant === 'fixed'
          ? (partnerSet.size > 0 ? [] : ['Chưa có partner'])
          : otherIds.filter(otherId => !partnerSet.has(otherId)).map(otherId => playerNameById.get(otherId) || 'Player'),
        missingOpponents: opponentPool.filter(otherId => !opponentSet.has(otherId)).map(otherId => playerNameById.get(otherId) || 'Player'),
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
    const fixedTeamCount = Math.max(1, playerIds.length / 2)
    const targetGames = variant === 'fixed'
      ? Math.max(1, fixedTeamCount - 1)
      : mode === 'limited'
        ? Math.min(minGamesPerPlayer, Math.max(1, playerIds.length - 1))
        : Math.max(1, playerIds.length - 1)
    const partnerTarget = variant === 'fixed' ? 1 : Math.max(1, playerIds.length - 1)
    const opponentTarget = variant === 'fixed' ? Math.max(1, playerIds.length - 2) : Math.max(1, playerIds.length - 1)
    const underTarget = rows.filter(row => row.games < targetGames)
    const fullPartnerRows = rows.filter(row => row.partners >= partnerTarget)
    const fullOpponentRows = rows.filter(row => row.opponents >= opponentTarget)

    const avgSkillGap = schedule.length > 0 ? totalSkillGap / schedule.length : 0
    
    // Sử dụng trực tiếp điểm số từ thuật toán để đảm bảo đồng bộ 100%
    const overallScore = quality?.overallScore || 0

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
      partnerTarget,
      opponentTarget,
      partnerPrefHits: variant === 'fixed' ? fixedPartnerPrefHits : partnerPrefHits,
      partnerPrefTotal: variant === 'fixed' ? fixedPartnerPrefTotal : partnerPrefTotal,
      opponentPrefHits,
      opponentPrefTotal,
      avgSkillGap,
      maxSkillGap,
      preferenceMisses,
      overallScore,
      matchQualities: matchQualities.sort((a, b) => {
        const [rotA, courtA] = a.key.split('-').map(Number)
        const [rotB, courtB] = b.key.split('-').map(Number)
        if (rotA !== rotB) return rotA - rotB
        return courtA - courtB
      }),
    }
  }, [minGamesPerPlayer, mode, playerById, playerIds, playerNameById, schedule, variant, quality])

  if (schedule.length === 0 || players.length < 4) return null

  const visibleRows = expanded ? report.rows : report.rows.slice(0, 5)
  const hasWarnings = report.underTarget.length > 0 || report.repeatedPartners.length > 0 || report.repeatedOpponents.length > 0

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: hasWarnings ? '#F5DFA0' : '#D9E9DF' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ 
            width: 48, height: 48, borderRadius: 12, 
            backgroundColor: report.overallScore >= 80 ? '#E1F5EE' : report.overallScore >= 60 ? '#FFF4D6' : '#FEE2E2',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: report.overallScore >= 80 ? '#0F6E56' : report.overallScore >= 60 ? '#D97706' : '#EF4444'
          }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: report.overallScore >= 80 ? '#0F6E56' : report.overallScore >= 60 ? '#D97706' : '#B91C1C', fontWeight: '900' }}>
              {report.overallScore}
            </Text>
          </View>
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>ĐIỂM CHẤT LƯỢNG</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '700' }}>DỰA TRÊN TRÌNH ĐỘ, PREF & NGHỈ</Text>
          </View>
        </View>
        <View style={{ backgroundColor: hasWarnings ? '#FFF4D6' : '#E1F5EE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: hasWarnings ? '#F5DFA0' : '#A7F3D0' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: hasWarnings ? '#854F0B' : '#0F6E56', fontWeight: '900' }}>
            {hasWarnings ? 'CẦN TỐI ƯU THÊM' : 'LỊCH TUYỆT VỜI'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { label: 'Trận', value: `${schedule.length}` },
          { label: 'Game/ng', value: `${report.minGames}-${report.maxGames}` },
          { label: 'Full partner', value: `${report.fullPartnerCount}/${players.length}` },
          { label: 'Full đối thủ', value: `${report.fullOpponentCount}/${players.length}` },
          { label: 'Pref partner', value: report.partnerPrefTotal ? `${report.partnerPrefHits}/${report.partnerPrefTotal}` : '-' },
          { label: 'Pref đối thủ', value: report.opponentPrefTotal ? `${report.opponentPrefHits}/${report.opponentPrefTotal}` : '-' },
          { 
            label: '% HL PARTNER', 
            value: report.partnerPrefTotal > 0 ? `${Math.round((report.partnerPrefHits / report.partnerPrefTotal) * 100)}%` : '100%'
          },
          { 
            label: '% HL ĐỐI THỦ', 
            value: report.opponentPrefTotal > 0 ? `${Math.round((report.opponentPrefHits / report.opponentPrefTotal) * 100)}%` : '100%'
          },
          { label: 'Lệch trình TB', value: report.avgSkillGap.toFixed(2) },
          { label: 'Lệch max', value: report.maxSkillGap.toFixed(2) },
        ].map(item => (
          <View key={item.label} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#E5E3DC' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800' }}>{item.label}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900', marginTop: 2 }}>{item.value}</Text>
          </View>
        ))}
      </View>


      {quality?.timedOut && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15, marginBottom: 8 }}>
          Scheduler đã dừng sau {Math.round(quality.runtimeMs)}ms để tránh treo UI. Lịch này có thể chưa tối ưu tuyệt đối.
        </Text>
      )}

      {variant === 'fixed' && report.matchQualities.length > 0 && (
        <View style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: '#E8E2D6', marginBottom: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900', marginBottom: 8 }}>
            CHẤT LƯỢNG TRẬN ĐẤU
          </Text>
          {report.matchQualities.map(match => {
            const gapColor = match.skillGap <= 0.5 ? '#0F6E56' : match.skillGap <= 1.2 ? '#854F0B' : '#993C1D'
            return (
              <View key={match.key} style={{ borderTopWidth: 1, borderTopColor: '#F1EFE8', paddingTop: 8, marginTop: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>{match.label}</Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: gapColor, fontWeight: '900' }}>
                    Lệch {match.skillGap.toFixed(2)}
                  </Text>
                </View>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#596864', marginTop: 4 }} numberOfLines={2}>
                  {match.teamALabel} ({match.teamASkill.toFixed(2)}) vs {match.teamBLabel} ({match.teamBSkill.toFixed(2)})
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#9C968A', marginTop: 3 }}>
                  Pref partner {match.partnerPrefTotal ? `${match.partnerPrefHits}/${match.partnerPrefTotal}` : '-'} · Pref đối thủ {match.opponentPrefTotal ? `${match.opponentPrefHits}/${match.opponentPrefTotal}` : '-'}
                </Text>
              </View>
            )
          })}
        </View>
      )}

      {report.preferenceMisses.length > 0 && (
        <View style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: '#F5DFA0', marginBottom: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#854F0B', fontWeight: '900', marginBottom: 6 }}>
            PREFERENCE CHƯA ĐÁP ỨNG
          </Text>
          {report.preferenceMisses.slice(0, expanded ? report.preferenceMisses.length : 5).map(item => (
            <Text key={item.key} style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15 }}>
              {item.playerName}: muốn {item.type === 'partner' ? 'partner' : 'đối thủ'} {item.preferred}, hiện là {item.actual || 'không có'}
            </Text>
          ))}
        </View>
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
              Partner {row.partners}/{report.partnerTarget} | Đối thủ {row.opponents}/{report.opponentTarget} | Nghỉ TB: {row.avgRest} {row.consecutive > 0 ? `(!${row.consecutive} liên tục)` : ''}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#0F6E56', marginTop: 4, fontWeight: '700' }}>
              VÒNG: {row.rotations.join(', ')}
            </Text>
            {(row.missingPartners.length > 0 || row.missingOpponents.length > 0) && (
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#9C968A', lineHeight: 14, marginTop: 4 }} numberOfLines={expanded ? undefined : 2}>
                Thiếu: {row.missingPartners.length ? `P(${row.missingPartners.length})` : ''} {row.missingOpponents.length ? `O(${row.missingOpponents.length})` : ''}
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
