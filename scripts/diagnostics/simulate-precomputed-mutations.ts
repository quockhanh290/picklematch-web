import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { repairUnavailablePlannedBoard, validatePlannedBoard } from '@/lib/next-round-suggester/planner/validation'
import type { PlayerSessionState, SessionState } from '@/lib/next-round-suggester/types'
import {
  aggregate,
  buildInitialState,
  buildShadowPrecomputedPlan,
  projectPlannedBoard,
  projectQualityDebt,
  type BoardMatch,
  type RawPlayer,
  type RawProfile,
} from './evaluate-session-quality-counterfactual'

type PlannedRound = {
  round: number
  resting: string[]
  matches: BoardMatch[]
}

function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    players: new Map([...state.players].map(([id, player]) => [id, {
      ...player,
      partner_counts: new Map(player.partner_counts),
      opponent_counts: new Map(player.opponent_counts),
    }])),
    rounds: [...state.rounds],
  }
}

function projectPrefix(initialState: SessionState, rounds: PlannedRound[]) {
  let state = cloneState(initialState)
  let debt = new Map([...state.players.keys()].map(id => [id, 0]))
  for (const round of rounds) {
    debt = projectQualityDebt(debt, round.matches, state)
    state = projectPlannedBoard(state, round.matches, round.round - 1)
  }
  return { state, debt }
}

function matchKey(match: BoardMatch) {
  return `${match.team_a.join('+')}::${match.team_b.join('+')}`
}

function changedMatches(before: PlannedRound[], after: PlannedRound[]) {
  return after.reduce((sum, round, index) => {
    const oldMatches = before[index]?.matches ?? []
    return sum + round.matches.filter((match, matchIndex) => matchKey(match) !== matchKey(oldMatches[matchIndex])).length
  }, 0)
}

function selectedIds(rounds: PlannedRound[]) {
  return rounds.flatMap(round => round.matches.flatMap(match => [...match.team_a, ...match.team_b]))
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function validateSchedule(rounds: PlannedRound[], state: SessionState) {
  return rounds.map(round => ({
    round: round.round,
    ...validatePlannedBoard({ matches: round.matches, players: state.players }),
  }))
}

function plannedRound(round: number, matches: BoardMatch[], state: SessionState): PlannedRound {
  const playing = new Set(matches.flatMap(match => [...match.team_a, ...match.team_b]))
  return {
    round,
    matches,
    resting: [...state.players.values()]
      .filter(player => player.checked_out_at === null && !player.opted_rest && !playing.has(player.player_id))
      .map(player => player.player_id)
      .sort(),
  }
}

function continueAfterFixedRound(options: {
  state: SessionState
  debt: ReadonlyMap<string, number>
  fixedRound: PlannedRound
  remainingRounds: number
  courts: number
}) {
  const debt = projectQualityDebt(options.debt, options.fixedRound.matches, options.state)
  const state = projectPlannedBoard(options.state, options.fixedRound.matches, options.fixedRound.round - 1)
  const tail = buildShadowPrecomputedPlan(state, options.remainingRounds, options.courts, {
    localSearchPasses: 1,
    startingRound: options.fixedRound.round,
    initialDebt: debt,
  })
  return {
    schedule: [options.fixedRound, ...tail.schedule],
    tail,
  }
}

function activeMatchRange(state: SessionState) {
  const counts = [...state.players.values()]
    .filter(player => player.checked_out_at === null)
    .map(player => player.matches_played)
  return [Math.min(...counts), Math.max(...counts)]
}

function addLateArrival(state: SessionState, template: PlayerSessionState) {
  const playerId = 'mutation-late-arrival'
  state.players.set(playerId, {
    ...template,
    player_id: playerId,
    checked_in_at: new Date(),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    rounds_available: 0,
  })
  return playerId
}

export function runMutationSimulation(
  initialState: SessionState,
  roundCount: number,
  courts: number,
  inputLabel = 'in-memory',
) {
  const base = buildShadowPrecomputedPlan(initialState, roundCount, courts, { localSearchPasses: 1 })
  const prefixLength = Math.min(3, roundCount - 1)
  const prefix = base.schedule.slice(0, prefixLength)
  const suffix = base.schedule.slice(prefixLength)
  const projected = projectPrefix(initialState, prefix)

  const resumed = buildShadowPrecomputedPlan(projected.state, suffix.length, courts, {
    localSearchPasses: 1,
    startingRound: prefixLength,
    initialDebt: projected.debt,
  })
  const noMutationChurn = changedMatches(suffix, resumed.schedule)
  assert(noMutationChurn === 0, `No-mutation resume changed ${noMutationChurn} matches`)

  const checkoutState = cloneState(projected.state)
  const checkoutId = suffix[0].matches[0].team_a[0]
  checkoutState.players.set(checkoutId, {
    ...checkoutState.players.get(checkoutId)!,
    checked_out_at: new Date(),
  })
  const checkoutRepair = repairUnavailablePlannedBoard({
    matches: suffix[0].matches,
    players: checkoutState.players,
  })
  assert(checkoutRepair.validation.valid, 'Checkout nearest-round repair is invalid')
  const checkoutPlan = continueAfterFixedRound({
    state: checkoutState,
    debt: projected.debt,
    fixedRound: plannedRound(suffix[0].round, checkoutRepair.board, checkoutState),
    remainingRounds: suffix.length - 1,
    courts,
  })
  const checkoutValidation = validateSchedule(checkoutPlan.schedule, checkoutState)
  assert(checkoutValidation.every(result => result.valid), 'Checkout replan contains an invalid player')
  assert(!selectedIds(checkoutPlan.schedule).includes(checkoutId), 'Checkout player remained in replan')

  const optedRestState = cloneState(projected.state)
  const optedRestId = suffix[0].matches[0].team_b[0]
  optedRestState.players.set(optedRestId, {
    ...optedRestState.players.get(optedRestId)!,
    opted_rest: true,
  })
  const optedRestRepair = repairUnavailablePlannedBoard({
    matches: suffix[0].matches,
    players: optedRestState.players,
  })
  assert(optedRestRepair.validation.valid, 'Opted-rest nearest-round repair is invalid')
  const optedRestRound = plannedRound(suffix[0].round, optedRestRepair.board, optedRestState)
  assert(!selectedIds([optedRestRound]).includes(optedRestId), 'Opted-rest player remained in immediate replan')

  const lateState = cloneState(projected.state)
  const template = [...lateState.players.values()].sort((left, right) => left.pvna - right.pvna)[Math.floor(lateState.players.size / 2)]
  const lateId = addLateArrival(lateState, template)
  const latePlan = continueAfterFixedRound({
    state: lateState,
    debt: projected.debt,
    fixedRound: suffix[0],
    remainingRounds: suffix.length - 1,
    courts,
  })
  const lateAppearances = selectedIds(latePlan.schedule).filter(id => id === lateId).length
  assert(lateAppearances > 0, 'Late arrival never entered the replanned session')
  assert(validateSchedule(latePlan.schedule, lateState).every(result => result.valid), 'Late-arrival replan is invalid')

  const nextRound = suffix[0]
  const busyIds = new Set([
    ...prefix[prefix.length - 1].matches[0].team_a,
    ...prefix[prefix.length - 1].matches[0].team_b,
  ])
  const rollingValidation = validatePlannedBoard({
    matches: nextRound.matches,
    players: projected.state.players,
    busyIds,
  })
  const consumableMatches = nextRound.matches.filter((_, index) => !rollingValidation.invalidMatchIndexes.includes(index))
  assert(rollingValidation.invalidMatchIndexes.length > 0, 'Slow-court validation did not block busy players')
  assert(validatePlannedBoard({ matches: consumableMatches, players: projected.state.players, busyIds }).valid, 'Consumable rolling matches double-book a busy player')

  const outOfOrderBusyIds = new Set([
    ...prefix[prefix.length - 1].matches.slice(0, 2).flatMap(match => [...match.team_a, ...match.team_b]),
  ])
  const outOfOrderValidation = validatePlannedBoard({
    matches: nextRound.matches,
    players: projected.state.players,
    busyIds: outOfOrderBusyIds,
  })
  const outOfOrderConsumable = nextRound.matches.filter((_, index) => !outOfOrderValidation.invalidMatchIndexes.includes(index))
  assert(validatePlannedBoard({
    matches: outOfOrderConsumable,
    players: projected.state.players,
    busyIds: outOfOrderBusyIds,
  }).valid, 'Out-of-order completion emitted a busy player')

  const canceledMatch = nextRound.matches[Math.min(2, nextRound.matches.length - 1)]
  const cancellationValidation = validatePlannedBoard({
    matches: [canceledMatch],
    players: projected.state.players,
  })
  assert(cancellationValidation.valid, 'Canceled unstarted suggestion cannot be safely reissued')

  const replacementBoard = nextRound.matches.map(match => ({
    team_a: [...match.team_a] as [string, string],
    team_b: [...match.team_b] as [string, string],
  }))
  const replacementId = nextRound.resting[0]
  replacementBoard[0].team_a[0] = replacementId
  const replacementValidation = validatePlannedBoard({ matches: replacementBoard, players: projected.state.players })
  assert(replacementValidation.valid, 'Manual replacement produced an invalid board')

  const worstPlayerQuality = [...base.result.debt]
    .map(([playerId, debt]) => ({
      player_id: playerId,
      quality_debt: Number(debt.toFixed(3)),
      matches: base.result.state.players.get(playerId)?.matches_played ?? 0,
    }))
    .sort((left, right) => right.quality_debt - left.quality_debt || left.player_id.localeCompare(right.player_id))
    .slice(0, 5)

  return {
    input: { source: inputLabel, players: initialState.players.size, courts, rounds: roundCount, prefix_rounds: prefixLength },
    base: {
      summary: aggregate(base.result),
      worst_player_quality: worstPlayerQuality,
      invariants: base.invariants,
      runtime_ms: Math.round(base.timings.total_ms),
    },
    scenarios: {
      no_mutation_resume: {
        changed_visible_matches: noMutationChurn,
        runtime_ms: Math.round(resumed.timings.total_ms),
        invariants: resumed.invariants,
      },
      checkout: {
        player_id: checkoutId,
        unavailable_selections: selectedIds(checkoutPlan.schedule).filter(id => id === checkoutId).length,
        changed_future_matches: changedMatches(suffix, checkoutPlan.schedule),
        active_match_count_range: activeMatchRange(checkoutPlan.tail.result.state),
        changed_nearest_visible_matches: checkoutRepair.changedMatchIndexes.length,
        runtime_ms: Math.round(checkoutPlan.tail.timings.total_ms),
      },
      opted_rest: {
        player_id: optedRestId,
        immediate_selections: selectedIds([optedRestRound]).filter(id => id === optedRestId).length,
        changed_nearest_visible_matches: optedRestRepair.changedMatchIndexes.length,
        board_full: optedRestRound.matches.length === courts,
      },
      late_arrival: {
        player_id: lateId,
        appearances_after_arrival: lateAppearances,
        changed_nearest_visible_matches: changedMatches(suffix.slice(0, 1), latePlan.schedule.slice(0, 1)),
        active_match_count_range: activeMatchRange(latePlan.tail.result.state),
        runtime_ms: Math.round(latePlan.tail.timings.total_ms),
      },
      rolling_slow_court: {
        busy_players: busyIds.size,
        blocked_matches: rollingValidation.invalidMatchIndexes,
        immediately_consumable_matches: consumableMatches.length,
        busy_double_books_emitted: 0,
      },
      out_of_order_completion: {
        busy_players: outOfOrderBusyIds.size,
        blocked_matches: outOfOrderValidation.invalidMatchIndexes,
        immediately_consumable_matches: outOfOrderConsumable.length,
        busy_double_books_emitted: 0,
      },
      cancellation: {
        reissued_lineup_changed: 0,
        reissued_lineup_valid: cancellationValidation.valid,
      },
      manual_replacement: {
        replacement_player_id: replacementId,
        valid: replacementValidation.valid,
      },
    },
  }
}

function main() {
  const directory = process.argv[2]
  if (!directory) {
    throw new Error('Usage: npx tsx scripts/diagnostics/simulate-precomputed-mutations.ts <session-data-directory>')
  }
  const players = JSON.parse(readFileSync(join(directory, 'players.json'), 'utf8')) as RawPlayer[]
  const profiles = JSON.parse(readFileSync(join(directory, 'player_profiles.json'), 'utf8')) as RawProfile[]
  const liveMatches = JSON.parse(readFileSync(join(directory, 'live_matches.json'), 'utf8')) as Array<{
    status: string
    court_idx?: number | null
    cycle_no?: number | null
    round_no?: number | null
  }>
  const completed = liveMatches.filter(match => match.status === 'completed')
  const courts = Math.max(...completed.map(match => Number(match.court_idx ?? 0))) + 1
  const roundCount = new Set(completed.map(match => Number(match.cycle_no ?? match.round_no ?? 0))).size
  const initialState = buildInitialState(players, profiles, courts)
  console.log(JSON.stringify(runMutationSimulation(initialState, roundCount, courts, directory), null, 2))
}

const invokedPath = process.argv[1]?.replaceAll('\\', '/') ?? ''
if (invokedPath.endsWith('/simulate-precomputed-mutations.ts')) main()
