import { bestTeamSplit } from '../../../lib/next-round-suggester/pair'
import { scoreMatch } from '../../../lib/next-round-suggester/score'
import { detectGenderConflicts, suggestNextRound } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState } from '../helpers/factories'
import { genderPreferenceScenario } from '../helpers/scenarios'

describe('gender preference scenarios', () => {
  it('respects partner gender preferences when feasible', () => {
    const result = suggestNextRound(genderPreferenceScenario())
    const match = result.alternatives[0].matches[0]

    expect(match.team_a).toEqual(['p01', 'p02'])
    expect(match.team_b).toEqual(['p03', 'p04'])
  })

  it('warns when gender preferences are unsatisfiable', () => {
    const warnings = detectGenderConflicts([
      createPlayer('p1', { gender: 'F', partner_gender_pref: 'F' }),
      createPlayer('p2', { gender: 'F', partner_gender_pref: 'F' }),
      createPlayer('p3', { gender: 'M', partner_gender_pref: 'F' }),
      createPlayer('p4', { gender: 'M', partner_gender_pref: 'F' }),
      createPlayer('p5', { gender: 'M', partner_gender_pref: 'F' }),
    ])

    expect(warnings).toContain('5 người muốn partner nữ nhưng chỉ có 2 nữ')
  })

  it('does not hard-reject due to gender mismatch', () => {
    const state = createState({
      players: [
        createPlayer('p1', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p2', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p3', { gender: 'M', partner_gender_pref: 'F' }),
        createPlayer('p4', { gender: 'M', partner_gender_pref: 'F' }),
      ],
    })

    expect(Number.isFinite(scoreMatch(['p1', 'p2'], ['p3', 'p4'], state).score)).toBe(true)
    expect(bestTeamSplit([...state.players.values()], state)).not.toBeNull()
  })
})
