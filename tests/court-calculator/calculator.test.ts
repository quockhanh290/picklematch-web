import { buildCourtOption, calculateOptimalCourts, checkFeasibility } from '../../lib/court-calculator'

describe('court calculator', () => {
  it('recommends 2 courts for 9 players 120min balanced', () => {
    const result = calculateOptimalCourts({
      n_players: 9,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.courts).toBe(2)
    expect(result.recommended.feasibility).toBe('optimal')
  })

  it('marks target warning when play-more target cannot be reached', () => {
    const result = calculateOptimalCourts({
      n_players: 8,
      session_duration_min: 60,
      match_duration_min: 15,
      preset: 'play_more',
    })

    expect(result.recommended.courts).toBe(2)
    expect(result.recommended.warnings.length).toBeGreaterThan(0)
  })

  it('does not generate infeasible 2-court option for 6 players', () => {
    const result = calculateOptimalCourts({
      n_players: 6,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'play_more',
    })

    expect(result.alternatives.find((option) => option.courts === 2)).toBeUndefined()
    expect(result.recommended.courts).toBe(1)
  })

  it('handles minimum input', () => {
    const result = calculateOptimalCourts({
      n_players: 4,
      session_duration_min: 60,
      match_duration_min: 15,
      preset: 'relaxed',
    })

    expect(result.recommended.courts).toBe(1)
    expect(result.recommended.avg_matches_per_player).toBe(4)
  })

  it('handles many players with short time', () => {
    const result = calculateOptimalCourts({
      n_players: 20,
      session_duration_min: 45,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(Boolean(result.recommended)).toBe(true)
    expect(result.recommended.total_rounds).toBe(3)
  })

  it('computes min max and rest estimates', () => {
    const option = buildCourtOption(2, 9, 8)

    expect(option.avg_matches_per_player).toBe(7.1)
    expect(option.min_matches_per_player).toBe(7)
    expect(option.max_matches_per_player).toBe(8)
    expect(option.resting_per_round).toBe(1)
    expect(option.estimated_rest_per_player).toBe(0.9)
  })

  it('marks oversupply when time is too short for enough matches', () => {
    const result = checkFeasibility(1, 4, 1)

    expect(result.feasibility).toBe('oversupply')
  })

  it('marks tight when player count is high relative to slots', () => {
    const result = checkFeasibility(1, 10, 8)

    expect(result.feasibility).toBe('tight')
  })

  it('marks infeasible when slots exceed players', () => {
    const result = checkFeasibility(2, 6, 8)

    expect(result.feasibility).toBe('infeasible')
  })
})
