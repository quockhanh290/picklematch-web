import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '@/lib/next-round-suggester/live-preview'
import { scoreMatch } from '@/lib/next-round-suggester/score'
import { DEFAULT_SCORING_WEIGHTS } from '@/lib/next-round-suggester/state'
import type { PlayerSessionState, SessionState, Team } from '@/lib/next-round-suggester/types'

type RawPlayer = {
  player_id: string
  group_id?: string | null
  checked_in_at?: string
  checked_out_at?: string | null
  effective_pvna?: number | null
}

type RawProfile = {
  id: string
  name?: string
  pvna?: number
  gender?: string
  partner_gender_pref?: string
  opponent_gender_pref?: string
}

type RawMatch = {
  id: string
  status: string
  cycle_no?: number | null
  round_no?: number | null
  court_idx?: number | null
  team_a: Team
  team_b: Team
}

type BoardMatch = { team_a: Team; team_b: Team }
type Variant = 'baseline' | 'lookahead' | 'quality_debt'

type MatchMetrics = {
  inter: number
  intraA: number
  intraB: number
  maxIntra: number
  score: number
  partnerRepeats: number
  opponentRepeats: number
  genderPenalty: number
}

type BoardMetrics = {
  matches: number
  avgInter: number
  maxInter: number
  interOverTolerance: number
  interOverOne: number
  avgIntra: number
  maxIntra: number
  intraOverOne: number
  intraOverTwo: number
  partnerRepeats: number
  opponentRepeats: number
  genderPenalty: number
  engineScore: number
  maxProjectedDebt: number
  squaredProjectedDebt: number
}

type VariantResult = {
  variant: Variant
  state: SessionState
  debt: Map<string, number>
  rounds: Array<{
    round: number
    duplicateSlotsRepaired: number
    before: BoardMetrics
    after: BoardMetrics
  }>
  allMatches: BoardMatch[]
}

const TOLERANCE = 0.5
const LATE_ROUND_START = 5
const LOCAL_SEARCH_PASSES = 3

function preference(value?: string): 'M' | 'F' | 'any' {
  if (value === 'male' || value === 'M') return 'M'
  if (value === 'female' || value === 'F') return 'F'
  return 'any'
}

function gender(value?: string): 'M' | 'F' {
  return value === 'female' || value === 'F' ? 'F' : 'M'
}

function buildInitialState(players: RawPlayer[], profiles: RawProfile[], courts: number): SessionState {
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]))
  const playerStates = new Map<string, PlayerSessionState>()
  for (const row of players) {
    const profile = profilesById.get(row.player_id)
    playerStates.set(row.player_id, {
      player_id: row.player_id,
      pvna: Number(row.effective_pvna ?? profile?.pvna ?? 0),
      effective_pvna: row.effective_pvna ?? undefined,
      group_id: row.group_id ?? null,
      checked_in_at: new Date(row.checked_in_at ?? 0),
      checked_out_at: row.checked_out_at ? new Date(row.checked_out_at) : null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
      gender: gender(profile?.gender),
      partner_gender_pref: preference(profile?.partner_gender_pref),
      opponent_gender_pref: preference(profile?.opponent_gender_pref),
      rounds_available: 0,
    })
  }
  return {
    session_id: 'counterfactual',
    current_round: 0,
    status: 'active',
    config: {
      courts,
      pvna_tolerance: TOLERANCE,
      weights: DEFAULT_SCORING_WEIGHTS,
    },
    players: playerStates,
    rounds: [],
  }
}

function pvna(state: SessionState, playerId: string) {
  const player = state.players.get(playerId)
  return Number(player?.effective_pvna ?? player?.pvna ?? 0)
}

function metricsForMatch(match: BoardMatch, state: SessionState): MatchMetrics {
  const teamASum = match.team_a.reduce((sum, id) => sum + pvna(state, id), 0)
  const teamBSum = match.team_b.reduce((sum, id) => sum + pvna(state, id), 0)
  const intraA = Math.abs(pvna(state, match.team_a[0]) - pvna(state, match.team_a[1]))
  const intraB = Math.abs(pvna(state, match.team_b[0]) - pvna(state, match.team_b[1]))
  const result = scoreMatch(match.team_a, match.team_b, state, {
    tolerance: TOLERANCE,
    allowRepeatOverflow: true,
    allowIntraTeamGapOverflow: true,
    allowRecentGroupRematch: true,
  })
  return {
    inter: Math.abs(teamASum - teamBSum),
    intraA,
    intraB,
    maxIntra: Math.max(intraA, intraB),
    score: result.score,
    partnerRepeats: Number(result.stats.partner_repeats ?? 0),
    opponentRepeats: Number(result.stats.opponent_repeats ?? 0),
    genderPenalty: Number(result.stats.gender_pref_penalty ?? 0),
  }
}

function playerBurden(matchMetrics: MatchMetrics, partnerIntra: number) {
  return Math.max(0, matchMetrics.inter - TOLERANCE) * 2 + Math.max(0, partnerIntra - 1)
}

function summarizeBoard(board: BoardMatch[], state: SessionState, debt: Map<string, number>): BoardMetrics {
  const metrics = board.map(match => metricsForMatch(match, state))
  const projectedDebt = new Map(debt)
  board.forEach((match, index) => {
    const matchMetrics = metrics[index]
    match.team_a.forEach(id => projectedDebt.set(id, (projectedDebt.get(id) ?? 0) + playerBurden(matchMetrics, matchMetrics.intraA)))
    match.team_b.forEach(id => projectedDebt.set(id, (projectedDebt.get(id) ?? 0) + playerBurden(matchMetrics, matchMetrics.intraB)))
  })
  const debtValues = [...projectedDebt.values()]
  return {
    matches: board.length,
    avgInter: metrics.reduce((sum, item) => sum + item.inter, 0) / Math.max(1, metrics.length),
    maxInter: Math.max(0, ...metrics.map(item => item.inter)),
    interOverTolerance: metrics.filter(item => item.inter > TOLERANCE + 1e-9).length,
    interOverOne: metrics.filter(item => item.inter > 1 + 1e-9).length,
    avgIntra: metrics.reduce((sum, item) => sum + item.maxIntra, 0) / Math.max(1, metrics.length),
    maxIntra: Math.max(0, ...metrics.map(item => item.maxIntra)),
    intraOverOne: metrics.filter(item => item.maxIntra > 1 + 1e-9).length,
    intraOverTwo: metrics.filter(item => item.maxIntra > 2 + 1e-9).length,
    partnerRepeats: metrics.reduce((sum, item) => sum + item.partnerRepeats, 0),
    opponentRepeats: metrics.reduce((sum, item) => sum + item.opponentRepeats, 0),
    genderPenalty: metrics.reduce((sum, item) => sum + item.genderPenalty, 0),
    engineScore: metrics.reduce((sum, item) => sum + item.score, 0),
    maxProjectedDebt: Math.max(0, ...debtValues),
    squaredProjectedDebt: debtValues.reduce((sum, value) => sum + value * value, 0),
  }
}

function comparisonTuple(metrics: BoardMetrics, variant: Exclude<Variant, 'baseline'>) {
  const quality = [
    metrics.interOverOne,
    metrics.intraOverTwo,
    metrics.interOverTolerance,
    metrics.intraOverOne,
    metrics.maxInter,
    metrics.maxIntra,
  ]
  if (variant === 'quality_debt') {
    return [...quality, metrics.maxProjectedDebt, metrics.squaredProjectedDebt, metrics.partnerRepeats, metrics.opponentRepeats, metrics.genderPenalty, metrics.engineScore]
  }
  return [...quality, metrics.partnerRepeats, metrics.opponentRepeats, metrics.genderPenalty, metrics.engineScore]
}

function isBetter(left: BoardMetrics, right: BoardMetrics, variant: Exclude<Variant, 'baseline'>) {
  const leftTuple = comparisonTuple(left, variant)
  const rightTuple = comparisonTuple(right, variant)
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (Math.abs(leftTuple[index] - rightTuple[index]) <= 1e-9) continue
    return leftTuple[index] < rightTuple[index]
  }
  return false
}

function teamSplits(ids: string[]): Array<[Team, Team]> {
  return [
    [[ids[0], ids[1]], [ids[2], ids[3]]],
    [[ids[0], ids[2]], [ids[1], ids[3]]],
    [[ids[0], ids[3]], [ids[1], ids[2]]],
  ]
}

function twoCourtBoards(ids: string[]): BoardMatch[][] {
  const boards: BoardMatch[][] = []
  const first = ids[0]
  for (let a = 1; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      for (let c = b + 1; c < ids.length; c += 1) {
        const firstFour = [first, ids[a], ids[b], ids[c]]
        const firstSet = new Set(firstFour)
        const secondFour = ids.filter(id => !firstSet.has(id))
        for (const [teamA, teamB] of teamSplits(firstFour)) {
          for (const [teamC, teamD] of teamSplits(secondFour)) {
            boards.push([{ team_a: teamA, team_b: teamB }, { team_a: teamC, team_b: teamD }])
          }
        }
      }
    }
  }
  return boards
}

function optimizeBoard(
  initial: BoardMatch[],
  state: SessionState,
  debt: Map<string, number>,
  variant: Exclude<Variant, 'baseline'>,
) {
  let board = initial.map(match => ({ team_a: [...match.team_a] as Team, team_b: [...match.team_b] as Team }))
  const invariantCaps = summarizeBoard(board, state, debt)
  for (let pass = 0; pass < LOCAL_SEARCH_PASSES; pass += 1) {
    let improved = false
    for (let left = 0; left < board.length; left += 1) {
      for (let right = left + 1; right < board.length; right += 1) {
        const otherMatches = board.filter((_, index) => index !== left && index !== right)
        const ids = [...board[left].team_a, ...board[left].team_b, ...board[right].team_a, ...board[right].team_b]
        let bestBoard = board
        let bestMetrics = summarizeBoard(board, state, debt)
        for (const pair of twoCourtBoards(ids)) {
          const candidate = [...otherMatches, ...pair]
          const candidateMetrics = summarizeBoard(candidate, state, debt)
          if (
            candidateMetrics.partnerRepeats > invariantCaps.partnerRepeats
            || candidateMetrics.opponentRepeats > invariantCaps.opponentRepeats
            || candidateMetrics.genderPenalty > invariantCaps.genderPenalty
          ) {
            continue
          }
          if (isBetter(candidateMetrics, bestMetrics, variant)) {
            bestBoard = candidate
            bestMetrics = candidateMetrics
          }
        }
        if (bestBoard !== board) {
          board = bestBoard
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return board
}

function repairDuplicateSlots(board: BoardMatch[], state: SessionState) {
  const seen = new Set<string>()
  const duplicateSlots: Array<{ match: BoardMatch; team: 'a' | 'b'; index: number }> = []
  for (const match of board) {
    for (const team of ['a', 'b'] as const) {
      const ids = team === 'a' ? match.team_a : match.team_b
      ids.forEach((id, index) => {
        if (seen.has(id)) duplicateSlots.push({ match, team, index })
        else seen.add(id)
      })
    }
  }
  const replacements = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !seen.has(player.player_id))
    .sort((left, right) => {
      if (right.consecutive_rest !== left.consecutive_rest) return right.consecutive_rest - left.consecutive_rest
      if (left.matches_played !== right.matches_played) return left.matches_played - right.matches_played
      return left.player_id.localeCompare(right.player_id)
    })
  duplicateSlots.forEach((slot, index) => {
    const replacement = replacements[index]
    if (!replacement) return
    const team = slot.team === 'a' ? slot.match.team_a : slot.match.team_b
    team[slot.index] = replacement.player_id
    seen.add(replacement.player_id)
  })
  return duplicateSlots.length
}

function applyBoard(state: SessionState, board: BoardMatch[], roundNo: number) {
  let nextState = { ...state, current_round: roundNo }
  const playedIds = new Set<string>()
  board.forEach((match, index) => {
    match.team_a.forEach(id => playedIds.add(id))
    match.team_b.forEach(id => playedIds.add(id))
    nextState = buildProjectedStateAfterLiveMatch(nextState, {
      id: `counterfactual-${roundNo}-${index}`,
      session_id: state.session_id,
      sequence_no: roundNo * state.config.courts + index,
      round_no: roundNo,
      court_idx: index,
      status: 'completed',
      team_a: match.team_a,
      team_b: match.team_b,
      resting: [],
      score_a: 0,
      score_b: 0,
      suggested_at: new Date(0).toISOString(),
      started_at: null,
      ended_at: new Date(0).toISOString(),
    }, roundNo)
  })
  return buildProjectedStateAfterCompletedLiveRound(nextState, playedIds)
}

function applyDebt(debt: Map<string, number>, board: BoardMatch[], state: SessionState) {
  const nextDebt = new Map(debt)
  for (const match of board) {
    const metrics = metricsForMatch(match, state)
    match.team_a.forEach(id => nextDebt.set(id, (nextDebt.get(id) ?? 0) + playerBurden(metrics, metrics.intraA)))
    match.team_b.forEach(id => nextDebt.set(id, (nextDebt.get(id) ?? 0) + playerBurden(metrics, metrics.intraB)))
  }
  return nextDebt
}

function runVariant(
  variant: Variant,
  initialState: SessionState,
  rounds: Array<{ round: number; matches: BoardMatch[] }>,
): VariantResult {
  let state = initialState
  let debt = new Map([...state.players.keys()].map(id => [id, 0]))
  const result: VariantResult = { variant, state, debt, rounds: [], allMatches: [] }
  for (const round of rounds) {
    const actualBoard = round.matches.map(match => ({
      team_a: [...match.team_a] as Team,
      team_b: [...match.team_b] as Team,
    }))
    let board = actualBoard
    let duplicateSlotsRepaired = 0
    if (variant !== 'baseline') {
      duplicateSlotsRepaired = repairDuplicateSlots(board, state)
      if (round.round + 1 >= LATE_ROUND_START) {
        board = optimizeBoard(board, state, debt, variant)
      }
    }
    const before = summarizeBoard(actualBoard, state, debt)
    const after = summarizeBoard(board, state, debt)
    result.rounds.push({ round: round.round + 1, duplicateSlotsRepaired, before, after })
    result.allMatches.push(...board)
    debt = applyDebt(debt, board, state)
    state = applyBoard(state, board, round.round)
  }
  result.state = state
  result.debt = debt
  return result
}

function aggregate(result: VariantResult) {
  const roundMetrics = result.rounds.map(round => round.after)
  const totalMatches = roundMetrics.reduce((sum, round) => sum + round.matches, 0)
  const matchCounts = [...result.state.players.values()].map(player => player.matches_played)
  const debtValues = [...result.debt.values()]
  return {
    matches: totalMatches,
    avg_team_gap: roundMetrics.reduce((sum, round) => sum + round.avgInter * round.matches, 0) / totalMatches,
    max_team_gap: Math.max(...roundMetrics.map(round => round.maxInter)),
    team_gap_over_0_5: roundMetrics.reduce((sum, round) => sum + round.interOverTolerance, 0),
    team_gap_over_1: roundMetrics.reduce((sum, round) => sum + round.interOverOne, 0),
    avg_intra_gap: roundMetrics.reduce((sum, round) => sum + round.avgIntra * round.matches, 0) / totalMatches,
    max_intra_gap: Math.max(...roundMetrics.map(round => round.maxIntra)),
    intra_gap_over_1: roundMetrics.reduce((sum, round) => sum + round.intraOverOne, 0),
    intra_gap_over_2: roundMetrics.reduce((sum, round) => sum + round.intraOverTwo, 0),
    partner_repeats: roundMetrics.reduce((sum, round) => sum + round.partnerRepeats, 0),
    opponent_repeats: roundMetrics.reduce((sum, round) => sum + round.opponentRepeats, 0),
    match_count_min: Math.min(...matchCounts),
    match_count_max: Math.max(...matchCounts),
    player_quality_debt_max: Math.max(...debtValues),
    player_quality_debt_p95: [...debtValues].sort((a, b) => a - b)[Math.floor((debtValues.length - 1) * 0.95)],
  }
}

function roundNumber(match: RawMatch) {
  return Number(match.cycle_no ?? match.round_no ?? 0)
}

function main() {
  const directory = process.argv[2]
  if (!directory) {
    throw new Error('Usage: npx tsx scripts/diagnostics/evaluate-session-quality-counterfactual.ts <session-data-directory>')
  }
  const players = JSON.parse(readFileSync(join(directory, 'players.json'), 'utf8')) as RawPlayer[]
  const profiles = JSON.parse(readFileSync(join(directory, 'player_profiles.json'), 'utf8')) as RawProfile[]
  const rawMatches = JSON.parse(readFileSync(join(directory, 'live_matches.json'), 'utf8')) as RawMatch[]
  const completed = rawMatches.filter(match => match.status === 'completed')
  const courts = Math.max(...completed.map(match => Number(match.court_idx ?? 0))) + 1
  const rounds = [...new Set(completed.map(roundNumber))]
    .sort((left, right) => left - right)
    .map(round => ({
      round,
      matches: completed
        .filter(match => roundNumber(match) === round)
        .sort((left, right) => Number(left.court_idx ?? 0) - Number(right.court_idx ?? 0))
        .map(match => ({ team_a: match.team_a, team_b: match.team_b })),
    }))
  const initialState = buildInitialState(players, profiles, courts)
  const startedAt = performance.now()
  const results = (['baseline', 'lookahead', 'quality_debt'] as Variant[])
    .map(variant => runVariant(variant, initialState, rounds))
  const elapsedMs = performance.now() - startedAt
  const compactMetrics = (metrics: BoardMetrics) => ({
    avg_team_gap: Number(metrics.avgInter.toFixed(3)),
    max_team_gap: Number(metrics.maxInter.toFixed(3)),
    team_gap_over_0_5: metrics.interOverTolerance,
    team_gap_over_1: metrics.interOverOne,
    avg_intra_gap: Number(metrics.avgIntra.toFixed(3)),
    max_intra_gap: Number(metrics.maxIntra.toFixed(3)),
    intra_gap_over_1: metrics.intraOverOne,
    intra_gap_over_2: metrics.intraOverTwo,
    partner_repeats: metrics.partnerRepeats,
    opponent_repeats: metrics.opponentRepeats,
    max_projected_debt: Number(metrics.maxProjectedDebt.toFixed(3)),
  })
  console.log(JSON.stringify({
    input: { directory, players: players.length, courts, rounds: rounds.length, completed_matches: completed.length },
    elapsed_ms: Math.round(elapsedMs),
    variants: Object.fromEntries(results.map(result => [result.variant, {
      summary: aggregate(result),
      changed_rounds: result.rounds
        .filter(round => JSON.stringify(round.before) !== JSON.stringify(round.after) || round.duplicateSlotsRepaired > 0)
        .map(round => ({
          round: round.round,
          duplicate_slots_repaired: round.duplicateSlotsRepaired,
          before: compactMetrics(round.before),
          after: compactMetrics(round.after),
        })),
    }])),
  }, null, 2))
}

main()
