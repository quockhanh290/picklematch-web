import { buildPlanPromotionPayloads } from '../../../lib/next-round-suggester/planner/promotion'
import { createPlayers, createState } from '../helpers/factories'

describe('initial plan board promotion', () => {
  it('builds a complete persisted board with plan identity and quality metadata', () => {
    const players = createPlayers(8)
    players.forEach((player, index) => { player.pvna = 2 + index * 0.1 })
    const state = createState({ players, courts: 2, pvnaTolerance: 0.5 })
    const payloads = buildPlanPromotionPayloads({
      round: {
        round_no: 1,
        resting_ids: [],
        matches: [
          { team_a: ['p01', 'p04'], team_b: ['p02', 'p03'] },
          { team_a: ['p05', 'p08'], team_b: ['p06', 'p07'] },
        ],
      },
      state,
      courtCount: 2,
      pvnaTolerance: 0.5,
      planJobId: 'job-1',
      planVersionId: 'plan-1',
    })

    expect(payloads).toHaveLength(2)
    expect(payloads.map(payload => payload.court_idx)).toEqual([0, 1])
    expect(payloads.every(payload => payload.round_no === 0)).toBe(true)
    expect(payloads.every(payload => payload.preview_source === 'session_plan')).toBe(true)
    expect(payloads.every(payload => payload.plan_job_id === 'job-1')).toBe(true)
    expect(payloads.every(payload => payload.plan_version_id === 'plan-1')).toBe(true)
    expect(payloads.every(payload => payload.approval_required === false)).toBe(true)
  })

  it('refuses incomplete or duplicate-player plan boards', () => {
    const state = createState({ players: createPlayers(8), courts: 2 })
    const base = {
      state,
      courtCount: 2,
      pvnaTolerance: 0.5,
      planJobId: 'job-1',
      planVersionId: 'plan-1',
    }

    expect(buildPlanPromotionPayloads({
      ...base,
      round: {
        round_no: 1,
        resting_ids: [],
        matches: [{ team_a: ['p01', 'p02'], team_b: ['p03', 'p04'] }],
      },
    })).toEqual([])
    expect(buildPlanPromotionPayloads({
      ...base,
      round: {
        round_no: 1,
        resting_ids: [],
        matches: [
          { team_a: ['p01', 'p02'], team_b: ['p03', 'p04'] },
          { team_a: ['p01', 'p06'], team_b: ['p07', 'p08'] },
        ],
      },
    })).toEqual([])
  })
})
