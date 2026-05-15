import { Tier } from '../../../../../lib/next-round-suggester/classify'
import type { PlayerSessionState } from '../../../../../lib/next-round-suggester/types'
import { generateHTMLReport } from '../html-report'
import type { SimulationResult } from '../../runner'

describe('simulation HTML report', () => {
  it('renders required report sections and adjustment before/after scores', () => {
    const html = generateHTMLReport(makeResult())

    expect(html).toContain('Fairness Evolution')
    expect(html).toContain('Per Player Stats')
    expect(html).toContain('Pair History Heatmaps')
    expect(html).toContain('Round Details')
    expect(html).toContain('Engine Behavior')
    expect(html).toContain('Adjustment Timeline')
    expect(html).toContain('Before')
    expect(html).toContain('No adjust')
    expect(html).toContain('Adjusted')
    expect(html).toContain('A/B delta')
    expect(html).toContain('88')
    expect(html).toContain('89')
    expect(html).toContain('91')
    expect(html).toContain('PVNA')
    expect(html).toContain('Partner counts')
    expect(html).toContain('Opponent counts')
  })
})

function makeResult(): SimulationResult {
  const p1 = makePlayer('P1', 3.2)
  const p2 = makePlayer('P2', 3.4)
  p1.partner_counts.set('P2', 1)
  p1.opponent_counts.set('P2', 2)
  p2.partner_counts.set('P1', 1)
  p2.opponent_counts.set('P1', 2)

  return {
    config: {
      scenario_name: 'report_test',
      n_players: 2,
      courts: 1,
      rounds: 1,
      pvna_distribution: 'tight',
      gender_ratio: 0.5,
      gender_pref_rate: 0,
      group_count: 0,
      group_size_range: [2, 3],
      use_corrector: true,
      seed: 42,
    },
    rounds_completed: [
      {
        round_no: 1,
        matches: [{ court_idx: 0, team_a: ['P1', 'P2'], team_b: ['P3', 'P4'] }],
        resting: [],
        elapsed_ms: 12,
      },
    ],
    final_state: {
      session_id: 'report-test',
      current_round: 2,
      status: 'active',
      config: {
        courts: 1,
        pvna_tolerance: 0.35,
        weights: {
          pvna: 1,
          partner_repeat: 3,
          opponent_repeat: 1.5,
          group_bonus: 0.5,
          partner_gender_pref: 4,
          opponent_gender_pref: 2,
        },
      },
      players: new Map([
        ['P1', p1],
        ['P2', p2],
      ]),
      rounds: [],
    },
    fairness_score: {
      total: 91,
      breakdown: {
        match_count: 25,
        partner_diversity: 20,
        opponent_diversity: 15,
        rest: 20,
        gender_prefs: 11,
      },
      grade: 'excellent',
    },
    fairness_evolution: [{ round: 1, score: 91 }],
    per_player_stats: [
      {
        player_id: 'P1',
        matches_played: 1,
        unique_partners: 1,
        unique_opponents: 1,
        max_consecutive_rest: 0,
        rest_total: 0,
        partner_repeats: 0,
        opponent_repeats: 1,
      },
      {
        player_id: 'P2',
        matches_played: 1,
        unique_partners: 1,
        unique_opponents: 1,
        max_consecutive_rest: 0,
        rest_total: 0,
        partner_repeats: 0,
        opponent_repeats: 1,
      },
    ],
    adjustments_applied: [
      {
        round_no: 1,
        triggered_by_warnings: ['underplayed'],
        config_changes: {},
        tier_overrides: { P1: Tier.MUST_PLAY },
        fairness_score_before: 88,
        fairness_score_without_adjustment: 89,
        fairness_score_after: 91,
      },
    ],
    warnings_raised: [{ type: 'underplayed', count: 1 }],
    total_suggest_time_ms: 12,
    avg_suggest_time_ms: 12,
    max_suggest_time_ms: 12,
    invariant_violations: [],
  }
}

function makePlayer(playerId: string, pvna: number): PlayerSessionState {
  return {
    player_id: playerId,
    pvna: pvna,
    group_id: null,
    checked_in_at: new Date('2026-05-15T12:00:00.000Z'),
    checked_out_at: null,
    matches_played: 1,
    last_played_round: 1,
    consecutive_play: 1,
    consecutive_rest: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: null,
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
  }
}
