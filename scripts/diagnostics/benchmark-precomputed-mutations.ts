import { performance } from 'node:perf_hooks'

import { buildInitialState, type RawPlayer, type RawProfile } from './evaluate-session-quality-counterfactual'
import { runMutationSimulation } from './simulate-precomputed-mutations'

const SCENARIOS = [
  { players: 24, courts: 4, rounds: 6 },
  { players: 28, courts: 6, rounds: 6 },
  { players: 32, courts: 6, rounds: 8 },
  { players: 36, courts: 6, rounds: 6 },
]

function syntheticRoster(playerCount: number) {
  const players: RawPlayer[] = []
  const profiles: RawProfile[] = []
  for (let index = 0; index < playerCount; index += 1) {
    const id = `p${String(index + 1).padStart(2, '0')}`
    const pvna = Number((2.5 + (((index * 37) % 101) / 100) * 3).toFixed(2))
    players.push({
      player_id: id,
      session_id: `mutation-matrix-${playerCount}`,
      checked_in_at: new Date(0).toISOString(),
      checked_out_at: null,
      effective_pvna: pvna,
    })
    profiles.push({
      id,
      name: id,
      pvna,
      gender: index % 2 === 0 ? 'male' : 'female',
      partner_gender_pref: 'any',
      opponent_gender_pref: 'any',
    })
  }
  return { players, profiles }
}

function main() {
  const startedAt = performance.now()
  const results = SCENARIOS.map(scenario => {
    const roster = syntheticRoster(scenario.players)
    const state = buildInitialState(roster.players, roster.profiles, scenario.courts)
    const result = runMutationSimulation(
      state,
      scenario.rounds,
      scenario.courts,
      `synthetic-${scenario.players}-${scenario.courts}-${scenario.rounds}`,
    )
    return {
      ...scenario,
      base_runtime_ms: result.base.runtime_ms,
      base_invariants: result.base.invariants,
      base_quality: {
        team_gap_over_1: result.base.summary.team_gap_over_1,
        intra_gap_over_2: result.base.summary.intra_gap_over_2,
        partner_repeats: result.base.summary.partner_repeats,
        max_quality_debt: Number(result.base.summary.player_quality_debt_max.toFixed(3)),
      },
      no_mutation_churn: result.scenarios.no_mutation_resume.changed_visible_matches,
      checkout: {
        unavailable_selections: result.scenarios.checkout.unavailable_selections,
        nearest_visible_changes: result.scenarios.checkout.changed_nearest_visible_matches,
      },
      opted_rest: {
        immediate_selections: result.scenarios.opted_rest.immediate_selections,
        nearest_visible_changes: result.scenarios.opted_rest.changed_nearest_visible_matches,
      },
      late_arrival: {
        appearances: result.scenarios.late_arrival.appearances_after_arrival,
        nearest_visible_changes: result.scenarios.late_arrival.changed_nearest_visible_matches,
      },
      slow_court_double_books: result.scenarios.rolling_slow_court.busy_double_books_emitted,
      out_of_order_double_books: result.scenarios.out_of_order_completion.busy_double_books_emitted,
      cancellation_reissue_valid: result.scenarios.cancellation.reissued_lineup_valid,
      manual_replacement_valid: result.scenarios.manual_replacement.valid,
    }
  })

  console.log(JSON.stringify({
    scenario_count: results.length,
    total_wall_ms: Math.round(performance.now() - startedAt),
    results,
  }, null, 2))
}

main()
