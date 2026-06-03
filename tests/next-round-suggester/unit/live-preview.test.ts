import {
  buildLiveTradeoffChoices,
  repairIntraTeamWarningClusters,
} from '../../../lib/next-round-suggester/live-preview'
import type { SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { createPlayer, createState } from '../helpers/factories'

function alternative(teamA: [string, string], teamB: [string, string], pvnaDiff: number): SuggestionAlternative {
  return {
    matches: [{
      court_idx: 0,
      team_a: teamA,
      team_b: teamB,
      score: pvnaDiff,
      stats: {
        pvna_diff: pvnaDiff,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
        consecutive_play_penalty: 0,
      },
    }],
    resting: [],
    score: pvnaDiff,
    warnings: [],
    stats: {
      pvna_diff: pvnaDiff,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

describe('buildLiveTradeoffChoices', () => {
  it('does not show tradeoff choices when displayed options are all within caps', () => {
    const players = [
      createPlayer('p1', { pvna: 3.0 }),
      createPlayer('p2', { pvna: 3.1 }),
      createPlayer('p3', { pvna: 3.2 }),
      createPlayer('p4', { pvna: 3.3 }),
      createPlayer('p5', { pvna: 3.4 }),
      createPlayer('p6', { pvna: 3.5 }),
    ]
    const state = createState({ players, pvnaTolerance: 0.5 })

    const choices = buildLiveTradeoffChoices([
      alternative(['p1', 'p2'], ['p3', 'p4'], 0.4),
      alternative(['p1', 'p3'], ['p2', 'p5'], 0.5),
      alternative(['p2', 'p3'], ['p4', 'p6'], 0.3),
    ], state, 0.5)

    expect(choices).toBeNull()
  })
})

describe('repairIntraTeamWarningClusters', () => {
  function payload(courtIdx: number, teamA: [string, string], teamB: [string, string]) {
    return {
      court_idx: courtIdx,
      team_a: teamA,
      team_b: teamB,
      resting: [],
      round_no: 0,
      preview_live_state_version: 1,
      preview_countable_match_count: 0,
      warnings: ['INTRA_TEAM_GAP_RELAXED'],
      tradeoffs: [],
      approval_required: false,
      configured_pvna_tolerance: 0.5,
      effective_pvna_tolerance: 0.5,
      fairness_reasons: [],
      fairness_reason_details: [],
      tradeoff_choices: undefined,
      recommended_tradeoff_choice: undefined,
    }
  }

  it('repairs a warning cluster when the pooled players can make clean matches', () => {
    const players = [
      createPlayer('ngtr', { pvna: 3.39 }),
      createPlayer('ngomai', { pvna: 2.52 }),
      createPlayer('volinh', { pvna: 2.45 }),
      createPlayer('hbao', { pvna: 3.42 }),
      createPlayer('vviet', { pvna: 3.65 }),
      createPlayer('ngohuong', { pvna: 2.96 }),
      createPlayer('vquynh', { pvna: 2.83 }),
      createPlayer('hquan', { pvna: 3.80 }),
    ]
    const state = createState({ players, pvnaTolerance: 0.5 })

    const repaired = repairIntraTeamWarningClusters([
      payload(4, ['ngtr', 'ngomai'], ['volinh', 'hbao']),
      payload(5, ['vviet', 'ngohuong'], ['vquynh', 'hquan']),
    ], state, 0.5)

    expect(repaired).toHaveLength(2)
    expect(repaired.flatMap(match => [...match.team_a, ...match.team_b]).sort()).toEqual(
      players.map(player => player.player_id).sort(),
    )
    expect(repaired.some(match => match.warnings?.includes('INTRA_TEAM_GAP_RELAXED'))).toBe(false)
    expect(repaired.every(match => {
      const teamA = match.team_a.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
      const teamB = match.team_b.reduce((sum, playerId) => sum + (state.players.get(playerId)?.pvna ?? 0), 0)
      return Math.abs(teamA - teamB) <= 0.5
    })).toBe(true)
  })

  it('keeps an unrepairable single warning match but adds same-player tradeoff choices', () => {
    const players = [
      createPlayer('tp', { pvna: 4.85 }),
      createPlayer('ny', { pvna: 3.88 }),
      createPlayer('vt', { pvna: 4.58 }),
      createPlayer('lt', { pvna: 4.14 }),
    ]
    const state = createState({ players, pvnaTolerance: 0.5 })

    const repaired = repairIntraTeamWarningClusters([
      payload(3, ['tp', 'ny'], ['vt', 'lt']),
    ], state, 0.5)

    expect(repaired[0].team_a).toEqual(['tp', 'ny'])
    expect(repaired[0].team_b).toEqual(['vt', 'lt'])
    expect(repaired[0].warnings).toContain('INTRA_TEAM_GAP_RELAXED')
    expect(repaired[0].tradeoff_choices?.length).toBeGreaterThan(1)
    expect(repaired[0].tradeoff_choices?.some(choice => choice.metrics.pvna_over_by > 0)).toBe(true)
    expect(repaired[0].tradeoff_choices?.some(choice => choice.metrics.intra_team_over_by > 0)).toBe(true)
  })
})
