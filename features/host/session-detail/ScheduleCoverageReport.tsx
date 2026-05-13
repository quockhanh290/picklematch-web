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
  avgRest?: string
  minRest?: number | null
  consecutive?: number
  rotations?: number[]
  preferenceHits: number
  preferenceTotal: number
  preferenceSatisfaction: string
  preferenceMisses: PreferenceMiss[]
  missingPartners: string[]
  missingOpponents: string[]
}

type PreferenceMiss = {
  key: string
  playerId: string
  playerName: string
  type: 'partner' | 'opponent'
  preferred: string
  actual: string
  rotation: number
  court?: number
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
  variant?: 'mix-in' | 'fixed' | 'social' | 'rotation'
  quality?: {
    runtimeMs: number
    timedOut: boolean
    fallbackUsed: boolean
    overallScore?: number
  }
  playerStatsInitiallyExpanded?: boolean
  hideSummary?: boolean
  hidePlayerStats?: boolean
  focusedPlayerId?: string | null
  onOpenStatExplanation?: (key: string, value: string | number) => void
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

function formatPlayerListWithGender(players: (ArrangementPlayer | undefined)[]) {
  return players.map(player => {
    if (!player) return 'N/A'
    return `${player.name} - ${formatPrefLabel(normalizeGender(player.gender))}`
  }).join(' / ')
}

export function ScheduleCoverageReport({ players, schedule, mode, minGamesPerPlayer, variant = 'mix-in', quality, playerStatsInitiallyExpanded = true, hideSummary = false, hidePlayerStats = false, focusedPlayerId = null, onOpenStatExplanation }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [playerStatsExpanded, setPlayerStatsExpanded] = useState(playerStatsInitiallyExpanded)
  const [expandedPreferenceRows, setExpandedPreferenceRows] = useState<Set<string>>(() => new Set())
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
    const playerPreferenceStats = new Map<string, { hits: number; total: number }>(playerIds.map(id => [id, { hits: 0, total: 0 }]))

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
          const stats = playerPreferenceStats.get(id) || { hits: 0, total: 0 }
          stats.total++
          if (partners.some(partner => matchesGenderPref(partner, player.metadata.partner_gender_pref))) {
            partnerPrefHits++
            matchPartnerPrefHits++
            stats.hits++
          } else {
            preferenceMisses.push({
              key: `${matchIndex}-${id}-${playerIndex}-partner`,
              playerId: id,
              playerName: player.name,
              type: 'partner',
              preferred: formatPrefLabel(player.metadata.partner_gender_pref),
              actual: formatPlayerListWithGender(partners),
              rotation: match.rotation || matchIndex + 1,
              court: match.court,
            })
          }
          playerPreferenceStats.set(id, stats)
        }
        if (player?.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any') {
          opponentPrefTotal++
          matchOpponentPrefTotal++
          const stats = playerPreferenceStats.get(id) || { hits: 0, total: 0 }
          stats.total++
          if (opponents.some(opponent => matchesGenderPref(opponent, player.metadata.opponent_gender_pref))) {
            opponentPrefHits++
            matchOpponentPrefHits++
            stats.hits++
          } else {
            preferenceMisses.push({
              key: `${matchIndex}-${id}-${playerIndex}-opponent`,
              playerId: id,
              playerName: player.name,
              type: 'opponent',
              preferred: formatPrefLabel(player.metadata.opponent_gender_pref),
              actual: formatPlayerListWithGender(opponents),
              rotation: match.rotation || matchIndex + 1,
              court: match.court,
            })
          }
          playerPreferenceStats.set(id, stats)
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
      const preferenceStats = playerPreferenceStats.get(id) || { hits: 0, total: 0 }

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
        minRest: (() => {
          const rots = (playerRotations.get(id) || []).sort((a, b) => a - b)
          const gaps: number[] = []
          for (let i = 0; i < rots.length - 1; i++) gaps.push(rots[i+1] - rots[i] - 1)
          return gaps.length ? Math.min(...gaps) : null
        })(),
        consecutive: (() => {
          const rots = (playerRotations.get(id) || []).sort((a, b) => a - b)
          let count = 0
          for (let i = 0; i < rots.length - 1; i++) if (rots[i+1] - rots[i] === 1) count++
          return count
        })(),
        rotations: (playerRotations.get(id) || []).sort((a, b) => a - b),
        preferenceHits: preferenceStats.hits,
        preferenceTotal: preferenceStats.total,
        preferenceSatisfaction: preferenceStats.total > 0 ? `${Math.round((preferenceStats.hits / preferenceStats.total) * 100)}%` : '-',
        preferenceMisses: preferenceMisses.filter(item => item.playerId === id),
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
    const uniqueTargetGames = Math.max(1, minGamesPerPlayer)
    const uniqueOpponentTargetGames = uniqueTargetGames * 2
    const partnerTarget = variant === 'fixed' ? 1 : Math.max(1, playerIds.length - 1)
    const opponentTarget = variant === 'fixed' ? Math.max(1, playerIds.length - 2) : Math.max(1, playerIds.length - 1)
    const underTarget = rows.filter(row => row.games < targetGames)
    const fullPartnerRows = rows.filter(row => row.partners >= partnerTarget)
    const fullOpponentRows = rows.filter(row => row.opponents >= opponentTarget)
    const partnerCounts = rows.map(row => row.partners)
    const opponentCounts = rows.map(row => row.opponents)
    const avgRestValues = rows
      .map(row => Number(row.avgRest))
      .filter(value => Number.isFinite(value))
    const minRestValues = rows
      .map(row => row.minRest)
      .filter((value): value is number => typeof value === 'number')
    const avgRestAcrossPlayers = avgRestValues.length
      ? (avgRestValues.reduce((sum, value) => sum + value, 0) / avgRestValues.length).toFixed(1)
      : '-'
    const minRestAcrossPlayers = minRestValues.length ? Math.min(...minRestValues).toString() : '-'

    const avgSkillGap = schedule.length > 0 ? totalSkillGap / schedule.length : 0
    const playersWithPreference = rows.filter(row => row.preferenceTotal > 0)
    const preferencePlayerTargetPercent = playersWithPreference.length
      ? `${Math.round((playersWithPreference.filter(row => row.preferenceHits / row.preferenceTotal >= 0.75).length / playersWithPreference.length) * 100)}%`
      : '-'
    const heavySkillGapCount = matchQualities.filter(match => match.skillGap > 0.5).length
    
    // Sử dụng trực tiếp điểm số từ thuật toán để đảm bảo đồng bộ 100%
    const overallScore = quality?.overallScore || 0

    return {
      rows,
      targetGames,
      uniqueTargetGames,
      uniqueOpponentTargetGames,
      underTarget,
      repeatedPartners: repeatedPartners.sort((a, b) => b.count - a.count || a.names.localeCompare(b.names)),
      repeatedOpponents: repeatedOpponents.sort((a, b) => b.count - a.count || a.names.localeCompare(b.names)),
      minGames: games.length ? Math.min(...games) : 0,
      maxGames: games.length ? Math.max(...games) : 0,
      minUniquePartners: partnerCounts.length ? Math.min(...partnerCounts) : 0,
      maxUniquePartners: partnerCounts.length ? Math.max(...partnerCounts) : 0,
      minUniqueOpponents: opponentCounts.length ? Math.min(...opponentCounts) : 0,
      maxUniqueOpponents: opponentCounts.length ? Math.max(...opponentCounts) : 0,
      avgRestAcrossPlayers,
      minRestAcrossPlayers,
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
      preferencePlayerTargetPercent,
      heavySkillGapCount,
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

  const visibleRows = useMemo(() => {
    let baseRows = (expanded || hideSummary) ? report.rows : report.rows.slice(0, 5)
    if (focusedPlayerId) {
      const focusedIndex = baseRows.findIndex(r => r.id === focusedPlayerId)
      if (focusedIndex !== -1) {
        const focusedRow = baseRows[focusedIndex]
        const remaining = baseRows.filter(r => r.id !== focusedPlayerId)
        return [focusedRow, ...remaining]
      }
    }
    return baseRows
  }, [expanded, hideSummary, report.rows, focusedPlayerId])

  const hasWarnings = report.underTarget.length > 0 || report.repeatedPartners.length > 0 || report.repeatedOpponents.length > 0
  const scoreTone = report.overallScore >= 80
    ? { bg: '#E1F5EE', fg: '#0F6E56', border: '#88D4B5' }
    : report.overallScore >= 60
      ? { bg: '#FFF4D6', fg: '#A05A16', border: '#F5DFA0' }
      : { bg: '#FEE2E2', fg: '#B91C1C', border: '#FCA5A5' }

  return (
    <View style={hideSummary ? { marginTop: 0 } : { backgroundColor: '#F8F3E8', borderRadius: 24, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: hasWarnings ? '#EBCB79' : '#B9DDC8' }}>
      {!hideSummary && (
        <>
          <View style={{ backgroundColor: '#FFFCF5', borderRadius: 20, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E3DC', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', right: -34, top: -42, width: 120, height: 120, borderRadius: 60, backgroundColor: scoreTone.bg, opacity: 0.48 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ 
                  width: 68, height: 68, borderRadius: 20,
                  backgroundColor: scoreTone.bg,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: scoreTone.border
                }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 26, color: scoreTone.fg, fontWeight: '900', lineHeight: 30 }}>
                    {report.overallScore}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>ĐIỂM CHẤT LƯỢNG</Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '700' }}>DỰA TRÊN TRÌNH ĐỘ, PREF & NGHỈ</Text>
                </View>
              </View>
              <View style={{ backgroundColor: scoreTone.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: scoreTone.border }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: scoreTone.fg, fontWeight: '900' }}>
                  {hasWarnings ? 'CẦN TỐI ƯU THÊM' : 'LỊCH TUYỆT VỜI'}
                </Text>
              </View>
            </View>
            <View style={{ height: 8, borderRadius: 999, backgroundColor: '#F1EFE8', overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(0, Math.min(100, report.overallScore))}%`, height: '100%', borderRadius: 999, backgroundColor: scoreTone.border }} />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { label: 'Trận', value: `${schedule.length}`, key: 'Phủ giờ' },
              { label: 'Game/ng', value: `${report.minGames}-${report.maxGames}`, key: 'Phủ trận' },
              { label: 'Unique partner/min', value: `${report.minUniquePartners}-${report.maxUniquePartners}/${report.uniqueTargetGames}`, key: 'Đa dạng Bạn chơi' },
              { label: 'Unique đối thủ/min', value: `${report.minUniqueOpponents}-${report.maxUniqueOpponents}/${report.uniqueOpponentTargetGames}`, key: 'Đa dạng Đối thủ' },
              { label: 'Hài lòng Partner', value: report.partnerPrefTotal > 0 ? `${Math.round((report.partnerPrefHits / report.partnerPrefTotal) * 100)}%` : '100%', key: 'Hài lòng Partner' },
              { label: 'Hài lòng Đối thủ', value: report.opponentPrefTotal > 0 ? `${Math.round((report.opponentPrefHits / report.opponentPrefTotal) * 100)}%` : '100%', key: 'Hài lòng Đối thủ' },
              { label: 'Nghỉ TB', value: report.avgRestAcrossPlayers, key: 'Nhịp nghỉ' },
              { label: 'Min nghỉ', value: report.minRestAcrossPlayers, key: 'Min nghỉ' },
              { label: 'Lệch trình TB', value: report.avgSkillGap.toFixed(2), key: 'Cân bằng Skill' },
              { label: 'Lệch max', value: report.maxSkillGap.toFixed(2), key: 'Cân bằng Skill' },
            ].map(item => {
              // Map labels to STAT_EXPLANATIONS keys
              let statKey = item.key
              
              return (
                <TouchableOpacity 
                  key={item.label} 
                  onPress={() => onOpenStatExplanation?.(statKey, item.value)}
                  disabled={!onOpenStatExplanation}
                  activeOpacity={0.7}
                  style={{ backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#E5E3DC', width: '48.5%', minHeight: 64, marginBottom: 8 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', fontWeight: '800' }}>{item.label}</Text>
                    {onOpenStatExplanation && <Text style={{ fontSize: 10, color: '#0F6E56', fontWeight: '900' }}>ⓘ</Text>}
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 17, color: '#1A2E2A', fontWeight: '900', marginTop: 4 }}>{item.value}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      )}


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

      {!hideSummary && !hidePlayerStats && (
        <TouchableOpacity
          onPress={() => setPlayerStatsExpanded(prev => !prev)}
          activeOpacity={0.82}
          style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.md, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E3DC', marginBottom: playerStatsExpanded ? 10 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '900' }}>
              {'Chi ti\u1ebft stats ng\u01b0\u1eddi ch\u01a1i'}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#7A8884', marginTop: 2 }}>
              {playerStatsExpanded ? '\u0110ang hi\u1ec3n th\u1ecb chi ti\u1ebft t\u1eebng ng\u01b0\u1eddi' : `B\u1ea5m \u0111\u1ec3 xem ${report.rows.length} ng\u01b0\u1eddi`}
            </Text>
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
            {playerStatsExpanded ? 'Thu g\u1ecdn' : 'M\u1edf'}
          </Text>
        </TouchableOpacity>
      )}

      {!hidePlayerStats && playerStatsExpanded && (
      <View style={{ gap: 10 }}>
        {visibleRows.map(row => {
          const isFocused = row.id === focusedPlayerId
          const playerGameTarget = report.uniqueTargetGames
          const hasEnoughGames = row.games >= playerGameTarget
          const initials = row.name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'
          const preferenceExpanded = expandedPreferenceRows.has(row.id)
          const player = playerById.get(row.id)
          const partnerPref = player?.metadata?.partner_gender_pref
          const opponentPref = player?.metadata?.opponent_gender_pref
          const playerMetrics = [
            { label: 'Trận', value: `${row.games}/${playerGameTarget}`, color: hasEnoughGames ? '#0F6E56' : '#D69A2D' },
            { label: 'Unique partner/min', value: `${row.partners}/${report.uniqueTargetGames}`, color: '#2563EB' },
            { label: 'Unique đối thủ/min', value: `${row.opponents}/${report.uniqueOpponentTargetGames}`, color: '#7C3AED' },
            { label: '% hài lòng pref', value: row.preferenceSatisfaction, color: row.preferenceTotal === 0 || row.preferenceHits / row.preferenceTotal >= 0.75 ? '#0F6E56' : '#D69A2D' },
            { label: 'Nghỉ TB', value: row.avgRest ?? '-', color: '#596864' },
            { label: 'Min nghỉ', value: row.minRest == null ? '-' : String(row.minRest), color: '#596864' },
          ]

          return (
            <View key={row.id} style={{ backgroundColor: isFocused ? '#E1F5EE' : '#FFFCF5', borderRadius: RADIUS.lg, padding: 12, borderWidth: isFocused ? 2 : 1, borderColor: isFocused ? '#0F6E56' : (hasEnoughGames ? '#BFE3D6' : '#F5DFA0'), overflow: 'hidden' }}>
            <View style={{ position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: '#F8E8C8', opacity: 0.55, right: -26, top: -30 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#12352F', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#FFF5DE', fontWeight: '900' }}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>{row.name}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 150 }}>
                {partnerPref && partnerPref !== 'any' && (
                  <View style={{ backgroundColor: '#E9F0FF', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: '#BFD0FF' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#243B88', fontWeight: '900' }}>
                      Partner {formatPrefLabel(partnerPref)}
                    </Text>
                  </View>
                )}
                {opponentPref && opponentPref !== 'any' && (
                  <View style={{ backgroundColor: '#F4E9FF', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: '#D8B4FE' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#6D28D9', fontWeight: '900' }}>
                      Đối thủ {formatPrefLabel(opponentPref)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {playerMetrics.map(metric => (
                <View key={metric.label} style={{ width: '31.5%', minWidth: 92, backgroundColor: '#F8F3E8', borderRadius: RADIUS.md, padding: 9, borderWidth: 1, borderColor: '#EFE3CC' }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#8A8174', fontWeight: '800', textTransform: 'uppercase' }}>
                    {metric.label}
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: metric.color, fontWeight: '900', marginTop: 3 }}>
                    {metric.value}
                  </Text>
                </View>
              ))}
            </View>

            {row.consecutive > 0 && (
              <View style={{ marginTop: 9, backgroundColor: '#FFF2D6', borderRadius: RADIUS.md, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#F2D28A' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#854F0B', fontWeight: '800' }}>
                  Nghỉ 0 vòng: {row.consecutive}
                </Text>
              </View>
            )}

            <View style={{ marginTop: 9, backgroundColor: '#F4F7FF', borderRadius: RADIUS.md, paddingVertical: 8, paddingHorizontal: 9, borderWidth: 1, borderColor: '#D8E2FF' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#3150A8', fontWeight: '900', textTransform: 'uppercase' }}>
                  Vòng chơi
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1, justifyContent: 'flex-end' }}>
                {row.rotations.slice(0, 8).map(rotation => (
                  <View key={rotation} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#E9F0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BFD0FF' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#243B88', fontWeight: '900' }}>
                      {rotation}
                    </Text>
                  </View>
                ))}
                {row.rotations.length > 8 && (
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3EEE3', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E6D8BE' }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 9, color: '#7A746A', fontWeight: '900' }}>
                      +{row.rotations.length - 8}
                    </Text>
                  </View>
                )}
                </View>
              </View>
            </View>

            {row.preferenceMisses.length > 0 && (
              <View style={{ marginTop: 9, backgroundColor: '#FFF2D6', borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#F2D28A', overflow: 'hidden' }}>
                <TouchableOpacity
                  onPress={() => setExpandedPreferenceRows(prev => {
                    const next = new Set(prev)
                    if (next.has(row.id)) next.delete(row.id)
                    else next.add(row.id)
                    return next
                  })}
                  style={{ paddingVertical: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#854F0B', fontWeight: '900' }}>
                      Preference chưa đáp ứng
                    </Text>
                    <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 8, color: '#9A6A19', marginTop: 2 }}>
                      {row.preferenceMisses.length} mục cần xem chi tiết
                    </Text>
                  </View>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#854F0B', fontWeight: '900' }}>
                    {preferenceExpanded ? 'Thu' : 'Mở'}
                  </Text>
                </TouchableOpacity>
                {preferenceExpanded && (
                  <View style={{ borderTopWidth: 1, borderTopColor: '#F2D28A', paddingVertical: 7, paddingHorizontal: 9, gap: 6 }}>
                    {row.preferenceMisses.map(item => (
                      <View key={item.key} style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.sm, paddingVertical: 6, paddingHorizontal: 7, borderWidth: 1, borderColor: '#F5DFA0' }}>
                        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: '#854F0B', lineHeight: 14 }} numberOfLines={1}>
                          V{item.rotation}{item.court ? ` S${item.court}` : ''}: muốn {item.type === 'partner' ? 'partner' : 'đối thủ'} {item.preferred} · Thực tế: {item.actual || 'không có'}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

          </View>
          )
        })}
      {report.rows.length > 5 && !hideSummary && !hidePlayerStats && (
        <TouchableOpacity onPress={() => setExpanded(prev => !prev)} style={{ alignSelf: 'center', paddingTop: 10 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
            {expanded ? 'Thu gọn báo cáo' : `Xem tất cả ${report.rows.length} người`}
          </Text>
        </TouchableOpacity>
      )}
      </View>
      )}
    </View>
  )
}
