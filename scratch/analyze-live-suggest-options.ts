import { execFileSync } from 'node:child_process'
import { suggestNextMatch } from '../lib/next-round-suggester/suggest'
import { mapRowsToSessionState } from '../lib/next-round-suggester/state'
import { applyFairnessAdjustment, correctForFairness } from '../lib/next-round-suggester/fairness/corrector'
import type {
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '../lib/next-round-suggester/types'
import {
  getProjectedRepeatSummary,
  MAX_PROJECTED_OPPONENT_PAIR_COUNT,
  MAX_PROJECTED_PARTNER_PAIR_COUNT,
} from '../lib/next-round-suggester/score'

type DbRows<T> = { rows: T[] }

type PlayerNameRow = {
  player_id: string
  name: string | null
  pvna: number | string | null
  current_elo: number | null
  elo: number | null
}

type SessionRow = {
  id: string
  latest_live_match: string | null
  live_matches: number
}

function query<T>(sql: string): T[] {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const raw = execFileSync(npx, ['supabase', 'db', 'query', '--linked'], {
    encoding: 'utf8',
    input: sql,
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error(`Could not parse Supabase JSON output:\n${raw}`)
  }
  return (JSON.parse(raw.slice(start, end + 1)) as DbRows<T>).rows
}

function playerLabel(names: Map<string, PlayerNameRow>, playerId: string) {
  return names.get(playerId)?.name ?? playerId.slice(0, 8)
}

function pairLabel(names: Map<string, PlayerNameRow>, team: [string, string]) {
  return `${playerLabel(names, team[0])}+${playerLabel(names, team[1])}`
}

function sumPvna(state: SessionState, ids: [string, string]) {
  return ids.reduce((sum, id) => sum + (state.players.get(id)?.pvna ?? 0), 0)
}

function project(state: SessionState, alt: SuggestionAlternative, roundNo: number): SessionState {
  const match = alt.matches[0]
  const playedIds = new Set([...match.team_a, ...match.team_b])
  const players = new Map(state.players)

  players.forEach((player, playerId) => {
    if (!playedIds.has(playerId)) return
    players.set(playerId, {
      ...player,
      matches_played: player.matches_played + 1,
      last_played_round: roundNo,
      consecutive_play: player.consecutive_play + 1,
      consecutive_rest: 0,
      opted_rest: false,
    })
  })

  const incrementPair = (playerAId: string, playerBId: string, type: 'partner' | 'opponent') => {
    const playerA = players.get(playerAId)
    const playerB = players.get(playerBId)
    if (playerA) {
      const partnerCounts = new Map(playerA.partner_counts)
      const opponentCounts = new Map(playerA.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerBId, (counts.get(playerBId) ?? 0) + 1)
      players.set(playerAId, { ...playerA, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
    if (playerB) {
      const partnerCounts = new Map(playerB.partner_counts)
      const opponentCounts = new Map(playerB.opponent_counts)
      const counts = type === 'partner' ? partnerCounts : opponentCounts
      counts.set(playerAId, (counts.get(playerAId) ?? 0) + 1)
      players.set(playerBId, { ...playerB, partner_counts: partnerCounts, opponent_counts: opponentCounts })
    }
  }

  incrementPair(match.team_a[0], match.team_a[1], 'partner')
  incrementPair(match.team_b[0], match.team_b[1], 'partner')
  for (const playerAId of match.team_a) {
    for (const playerBId of match.team_b) {
      incrementPair(playerAId, playerBId, 'opponent')
    }
  }

  const rounds = [
    ...state.rounds,
    {
      session_id: state.session_id,
      round_no: roundNo,
      status: 'completed' as const,
      matches: [match],
      resting: alt.resting,
      started_at: null,
      ended_at: new Date(),
    },
  ]

  return { ...state, players, rounds }
}

function describeAlternative(
  state: SessionState,
  names: Map<string, PlayerNameRow>,
  alt: SuggestionAlternative,
  rank: number,
) {
  const match = alt.matches[0]
  const teamASum = sumPvna(state, match.team_a)
  const teamBSum = sumPvna(state, match.team_b)
  const repeatSummary = getProjectedRepeatSummary(match.team_a, match.team_b, state)
  const repeatOverflow =
    repeatSummary.max_partner_pair_count > MAX_PROJECTED_PARTNER_PAIR_COUNT ||
    repeatSummary.max_opponent_pair_count > MAX_PROJECTED_OPPONENT_PAIR_COUNT ||
    repeatSummary.max_repeated_partners_per_player > MAX_PROJECTED_PARTNER_PAIR_COUNT ||
    repeatSummary.max_repeated_opponents_per_player > MAX_PROJECTED_OPPONENT_PAIR_COUNT
  const pvnaOverflow = Math.max(0, match.stats?.pvna_diff ?? 0) > state.config.pvna_tolerance
  const tradeoffs = (alt.tradeoffs ?? []).map(t => `${t.type}:${t.severity.toFixed(2)}`).join(', ') || '-'

  return [
    `#${rank}`,
    `${pairLabel(names, match.team_a)} vs ${pairLabel(names, match.team_b)}`,
    `gap=${(match.stats?.pvna_diff ?? Math.abs(teamASum - teamBSum)).toFixed(2)}`,
    `sum=${teamASum.toFixed(2)}-${teamBSum.toFixed(2)}`,
    `partnerMax=${repeatSummary.max_partner_pair_count}`,
    `oppMax=${repeatSummary.max_opponent_pair_count}`,
    `perPlayer=${repeatSummary.max_repeated_partners_per_player}/${repeatSummary.max_repeated_opponents_per_player}`,
    `pvnaOver=${pvnaOverflow ? 'Y' : 'N'}`,
    `repeatOver=${repeatOverflow ? 'Y' : 'N'}`,
    `score=${alt.score.toFixed(1)}`,
    `tradeoffs=${tradeoffs}`,
  ].join(' | ')
}

const argSessionId = process.argv[2]
const searchArg = process.argv.find(arg => arg.startsWith('--search='))
const throughArg = process.argv.find(arg => arg.startsWith('--through='))
const singleCourtArg = process.argv.find(arg => arg.startsWith('--single-court='))
const courtsArg = process.argv.find(arg => arg.startsWith('--courts='))
const throughCount = throughArg ? Number(throughArg.slice('--through='.length)) : null
const singleCourtIdx = singleCourtArg ? Math.max(0, Number(singleCourtArg.slice('--single-court='.length)) - 1) : null
const searchNames = searchArg
  ? searchArg.slice('--search='.length).split(',').map(name => name.trim()).filter(Boolean)
  : []
const sessions = argSessionId
  ? [{ id: argSessionId, latest_live_match: null, live_matches: 0 }]
  : query<SessionRow>(`
      select s.id, count(lm.id) as live_matches, max(lm.created_at) as latest_live_match
      from sessions s
      left join session_live_matches lm on lm.session_id=s.id
      where s.check_in_completed is true or lm.id is not null
      group by s.id
      order by coalesce(max(lm.created_at), max(s.created_at)) desc
      limit 1
    `)
const sessionId = sessions[0]?.id
if (!sessionId) throw new Error('No session found')

const playerRows = query<SessionPlayerStateRow>(`
  select sps.session_id, sps.player_id, sps.group_id, sps.checked_in_at, sps.checked_out_at,
         sps.matches_played, sps.last_played_round, sps.consecutive_rest, sps.consecutive_play,
         sps.opted_rest,
         json_build_object(
           'pvna', p.pvna,
           'current_elo', p.current_elo,
           'elo', p.elo,
           'gender', p.gender,
           'partner_gender_pref', p.partner_gender_pref,
           'opponent_gender_pref', p.opponent_gender_pref
         ) as players
  from session_player_state sps
  join players p on p.id=sps.player_id
  where sps.session_id='${sessionId}'
  order by sps.checked_in_at asc
`)
const preferenceRows = query<SessionPlayerPreferenceRow>(`
  select sp.player_id, sp.metadata,
         json_build_object(
           'pvna', p.pvna,
           'current_elo', p.current_elo,
           'elo', p.elo,
           'gender', p.gender,
           'partner_gender_pref', p.partner_gender_pref,
           'opponent_gender_pref', p.opponent_gender_pref
         ) as players
  from session_players sp
  join players p on p.id=sp.player_id
  where sp.session_id='${sessionId}'
  order by sp.player_id asc
`)
const pairRows = query<SessionPairHistoryRow>(`
  select session_id, player_a, player_b, partner_count, opponent_count
  from session_pair_history
  where session_id='${sessionId}'
  order by player_a asc, player_b asc
`)
const roundRows = query<any>(`
  select id, session_id, round_no, status, matches, resting, started_at, ended_at
  from session_rounds
  where session_id='${sessionId}'
  order by round_no asc
`)
const liveRows = query<SessionLiveMatchRow>(`
  select id, session_id, sequence_no, round_no, court_idx, status, team_a, team_b, resting,
         score_a, score_b, suggested_at, started_at, ended_at, created_at, updated_at
  from session_live_matches
  where session_id='${sessionId}'
  order by sequence_no asc
`)
const names = new Map(query<PlayerNameRow>(`
  select sps.player_id, p.name, p.pvna, p.current_elo, p.elo
  from session_player_state sps
  join players p on p.id=sps.player_id
  where sps.session_id='${sessionId}'
`).map(row => [row.player_id, row]))

const courts = courtsArg
  ? Math.max(1, Math.floor(Number(courtsArg.slice('--courts='.length))))
  : Math.max(1, ...liveRows.map(row => (row.court_idx ?? 0) + 1), 6)
const makeBaseState = (snapshotTime?: string | null) => mapRowsToSessionState({
  sessionId,
  playerRows: playerRows.map(row => ({
    ...row,
    checked_out_at: snapshotTime && new Date(row.checked_in_at).getTime() > new Date(snapshotTime).getTime()
      ? snapshotTime
      : row.checked_out_at,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    opted_rest: false,
  })),
  pairRows: [],
  roundRows: [],
  preferenceRows,
  courts,
  pvnaTolerance: 0.5,
})

function replayStateThrough(matchCount: number) {
  const rows = liveRows.filter(row => row.status !== 'cancelled').slice(0, matchCount)
  const nextRow = liveRows.filter(row => row.status !== 'cancelled')[matchCount]
  const snapshotTime = nextRow?.created_at ?? rows.at(-1)?.created_at ?? null
  let replayState = makeBaseState(snapshotTime)
  rows.forEach((row, index) => {
    const match = {
      matches: [{
        court_idx: row.court_idx ?? 0,
        team_a: row.team_a,
        team_b: row.team_b,
        stats: {
          pvna_diff: Math.abs(sumPvna(replayState, row.team_a) - sumPvna(replayState, row.team_b)),
          partner_repeats: 0,
          opponent_repeats: 0,
          group_bonus: 0,
          gender_pref_penalty: 0,
        },
      }],
      resting: row.resting,
      score: 0,
      warnings: [],
      stats: {
        pvna_diff: 0,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
      },
    } satisfies SuggestionAlternative
    replayState = project(replayState, match, row.round_no ?? Math.floor(index / courts))
  })
  return replayState
}

function sameNameSet(ids: string[], wanted: string[]) {
  const labels = ids.map(id => names.get(id)?.name ?? id).sort()
  return labels.join('|') === [...wanted].sort().join('|')
}

function buildClientRoundRows(sourceLiveRows: SessionLiveMatchRow[], sourcePlayerRows: SessionPlayerStateRow[]) {
  const completedLive = sourceLiveRows.filter(m => m.status === 'completed')
  const byRound = new Map<number, SessionLiveMatchRow[]>()
  for (const match of completedLive.filter(m => m.round_no != null)) {
    const key = match.round_no!
    if (!byRound.has(key)) byRound.set(key, [])
    byRound.get(key)!.push(match)
  }
  let nextFallbackRoundKey = Math.max(-1, ...byRound.keys()) + 1
  for (const match of completedLive.filter(m => m.round_no == null).sort((a, b) => a.sequence_no - b.sequence_no)) {
    const courtIdx = match.court_idx ?? match.sequence_no
    const targetRound = [...byRound.entries()]
      .filter(([key]) => key >= nextFallbackRoundKey)
      .find(([, matches]) => !matches.some(m => (m.court_idx ?? m.sequence_no) === courtIdx))
    const key = targetRound ? targetRound[0] : nextFallbackRoundKey++
    if (!byRound.has(key)) byRound.set(key, [])
    byRound.get(key)!.push(match)
  }
  const presentPlayerIds = sourcePlayerRows.filter(r => !r.checked_out_at).map(r => r.player_id)
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundNo, matches]) => {
      const playedIds = new Set(matches.flatMap(m => [...m.team_a, ...m.team_b]))
      const roundStartedAt = matches.map(m => m.started_at).filter(Boolean).sort()[0]
      const roundEndedAt = matches.map(m => m.ended_at).filter(Boolean).sort().reverse()[0]
      let roundPresentIds: string[]
      if (roundStartedAt) {
        const roundStartMs = new Date(roundStartedAt).getTime()
        const roundEndMs = roundEndedAt ? new Date(roundEndedAt).getTime() : Infinity
        roundPresentIds = sourcePlayerRows
          .filter(p => {
            const checkedIn = new Date(p.checked_in_at).getTime()
            const checkedOut = p.checked_out_at ? new Date(p.checked_out_at).getTime() : Infinity
            return checkedIn <= roundEndMs && checkedOut >= roundStartMs
          })
          .map(p => p.player_id)
      } else {
        roundPresentIds = presentPlayerIds
      }
      return {
        id: matches[0].id,
        session_id: sessionId,
        round_no: roundNo,
        status: 'completed' as const,
        matches: matches.map(m => ({
          court_idx: m.court_idx ?? 0,
          team_a: m.team_a,
          team_b: m.team_b,
        })),
        resting: matches.length >= courts ? roundPresentIds.filter(id => !playedIds.has(id)) : [],
        started_at: roundStartedAt ?? null,
        ended_at: roundEndedAt ?? null,
      }
    })
}

function withClientFairness(input: SessionState) {
  const baseState: SessionState = {
    ...input,
    config: {
      ...input.config,
      weights: {
        ...input.config.weights,
        pvna: 1,
      },
    },
  }
  const adjustment = correctForFairness(baseState)
  return {
    state: applyFairnessAdjustment(baseState, adjustment),
    tierOverrides: adjustment.tier_overrides,
    applied: adjustment.applied_for_warnings,
  }
}

if (searchNames.length === 4) {
  const countable = liveRows.filter(row => row.status !== 'cancelled')
  for (let through = 0; through <= countable.length; through += 1) {
    let searchState = replayStateThrough(through)
    const busy = new Set<string>()
    const projectedRoundNo = Math.floor(through / courts)
    const existingRoundMatchCount = through % courts
    for (let index = 0; index < courts - existingRoundMatchCount; index += 1) {
      const courtIdx = existingRoundMatchCount + index
      const result = suggestNextMatch(searchState, {
        court_idx: courtIdx,
        busy_player_ids: busy,
        max_alternatives: 8,
      })
      const top = result.alternatives[0]
      if (!top?.matches[0]) break
      const match = top.matches[0]
      const teamNames = [...match.team_a, ...match.team_b].map(id => names.get(id)?.name ?? id)
      if (sameNameSet(teamNames, searchNames)) {
        console.log(`found through=${through} court=${courtIdx + 1} projectedRound=${projectedRoundNo}`)
        result.alternatives.forEach((alt, altIndex) => {
          console.log(describeAlternative(searchState, names, alt, altIndex + 1))
        })
        process.exit(0)
      }
      match.team_a.forEach(id => busy.add(id))
      match.team_b.forEach(id => busy.add(id))
      searchState = project(searchState, top, projectedRoundNo)
    }
  }
  console.log(`not found search=${searchNames.join(',')}`)
  process.exit(0)
}

const sourceLiveRows = throughCount == null
  ? liveRows
  : liveRows.filter(row => row.status !== 'cancelled').slice(0, throughCount)

let state = throughCount == null ? mapRowsToSessionState({
  sessionId,
  playerRows,
  pairRows,
  roundRows: buildClientRoundRows(sourceLiveRows, playerRows),
  preferenceRows,
  courts,
  pvnaTolerance: 0.5,
}) : replayStateThrough(throughCount)
const clientFairness = withClientFairness(state)
state = clientFairness.state

const countableMatches = sourceLiveRows.filter(row => row.status !== 'cancelled')
const currentRound = Math.floor(countableMatches.length / courts)
let projectedRoundNo = currentRound
let projectedRoundMatchCount = countableMatches.length % courts
const courtIdxsByRound = new Map<number, Set<number>>()
const playerIdsByRound = new Map<number, Set<string>>()
countableMatches.forEach((match, matchIndex) => {
  const roundNo = Math.floor(matchIndex / courts)
  if (match.court_idx !== null && match.court_idx !== undefined) {
    const courtIdxs = courtIdxsByRound.get(roundNo) ?? new Set<number>()
    courtIdxs.add(Number(match.court_idx))
    courtIdxsByRound.set(roundNo, courtIdxs)
  }
  const playerIds = playerIdsByRound.get(roundNo) ?? new Set<string>()
  match.team_a.forEach(playerId => playerIds.add(playerId))
  match.team_b.forEach(playerId => playerIds.add(playerId))
  playerIdsByRound.set(roundNo, playerIds)
})
let roundCourtIdxs = new Set(courtIdxsByRound.get(projectedRoundNo) ?? [])
let roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])

console.log(`session=${sessionId} players=${playerRows.length} liveMatches=${liveRows.length} courts=${courts}`)
console.log(`starting projectedRound=${projectedRoundNo} existingRoundMatchCount=${projectedRoundMatchCount}`)
console.log(`fairnessApplied=${clientFairness.applied.join(',') || '-'} tierOverrides=${Object.keys(clientFairness.tierOverrides).map(id => playerLabel(names, id)).join(',') || '-'}`)

if (singleCourtIdx != null) {
  const result = suggestNextMatch(state, {
    court_idx: singleCourtIdx,
    busy_player_ids: new Set<string>(),
    tier_overrides: clientFairness.tierOverrides,
    max_alternatives: 12,
  })
  console.log(`\nSingle Court ${singleCourtIdx + 1} top ${result.alternatives.length} alternatives:`)
  result.alternatives.forEach((alt, index) => {
    console.log(describeAlternative(state, names, alt, index + 1))
  })
  process.exit(0)
}

for (let index = 0; index < courts; index += 1) {
  if (projectedRoundMatchCount >= courts) {
    projectedRoundNo += 1
    projectedRoundMatchCount = 0
    roundCourtIdxs = new Set(courtIdxsByRound.get(projectedRoundNo) ?? [])
    roundBusyIds = new Set(playerIdsByRound.get(projectedRoundNo) ?? [])
  }
  const nextCourtIdx = Array.from({ length: courts }, (_, idx) => idx)
    .find(idx => !roundCourtIdxs.has(idx))
  if (nextCourtIdx === undefined) break
  const courtIdx = nextCourtIdx
  const result = suggestNextMatch(state, {
    court_idx: courtIdx,
    busy_player_ids: roundBusyIds,
    tier_overrides: clientFairness.tierOverrides,
    max_alternatives: 8,
  })
  const top = result.alternatives[0]
  console.log(`\nCourt ${courtIdx + 1} top ${result.alternatives.length} alternatives:`)
  result.alternatives.forEach((alt, index) => {
    console.log(describeAlternative(state, names, alt, index + 1))
  })
  if (!top?.matches[0]) break
  top.matches[0].team_a.forEach(id => roundBusyIds.add(id))
  top.matches[0].team_b.forEach(id => roundBusyIds.add(id))
  state = project(state, top, projectedRoundNo)
  roundCourtIdxs.add(courtIdx)
  projectedRoundMatchCount += 1
}
