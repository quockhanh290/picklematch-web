import { buildRollingPlanTarget } from '../../../lib/next-round-suggester/planner/rolling-target'

const players = Array.from({ length: 8 }, (_, index) => ({
  player_id: `p${index + 1}`,
  pvna: 3,
  matches_played: 0,
  rounds_available: 0,
  consecutive_rest: 0,
  consecutive_play: 0,
  partner_counts: [],
  opponent_counts: [],
}))

describe('rolling session target envelope', () => {
  it('derives checkpoint fairness, debt, diversity, repeat, and streak targets', () => {
    const target = buildRollingPlanTarget({
      planVersionId: 'plan-1',
      baselinePlayers: players,
      plannedRounds: [
        round(1, ['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6', 'p7', 'p8']),
        round(2, ['p5', 'p6'], ['p7', 'p8'], ['p1', 'p2', 'p3', 'p4']),
        round(3, ['p1', 'p3'], ['p2', 'p4'], ['p5', 'p6', 'p7', 'p8']),
        round(4, ['p5', 'p7'], ['p6', 'p8'], ['p1', 'p2', 'p3', 'p4']),
      ],
      pvnaTolerance: 0.5,
    })

    expect(target?.checkpoints?.map(item => ({
      ratio: item.progress_ratio,
      rounds: item.completed_plan_rounds,
      appearances: item.target_total_appearances,
    }))).toEqual([
      { ratio: 0.25, rounds: 1, appearances: 4 },
      { ratio: 0.5, rounds: 2, appearances: 8 },
      { ratio: 0.75, rounds: 3, appearances: 12 },
      { ratio: 1, rounds: 4, appearances: 16 },
    ])
    expect(target?.players?.p1).toEqual({
      matches: 2,
      rests: 2,
      quality_debt: 0,
      partner_diversity: 2,
      opponent_diversity: 3,
      partner_repeat_exposure: 0,
      opponent_repeat_exposure: 1,
      max_consecutive_rest: 1,
      max_consecutive_play: 1,
    })
    expect(target?.preferred_team_gap).toBe(0)
    expect(target?.preferred_intra_team_gap).toBe(0)
  })
})

function round(
  roundNo: number,
  teamA: [string, string],
  teamB: [string, string],
  resting: string[],
) {
  return {
    round_no: roundNo,
    matches: [{ team_a: teamA, team_b: teamB }],
    resting,
  }
}
