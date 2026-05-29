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
      n_players: 12,
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

  it('prefers 3 courts for 16 players balanced because rotation is healthier', () => {
    const result = calculateOptimalCourts({
      n_players: 16,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.courts).toBe(3)
    expect(result.recommended.play_ratio).toBe(0.75)
    expect(result.recommended.quality_notes[0]).toContain('Rotation phu hop')
  })

  it('prefers 4 courts for 24 players balanced because rotation is healthier', () => {
    const result = calculateOptimalCourts({
      n_players: 24,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.courts).toBe(4)
    expect(result.recommended.play_ratio).toBe(0.67)
  })

  it('prefers 6 courts for 33 players balanced after dynamic pace target', () => {
    const result = calculateOptimalCourts({
      n_players: 33,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.courts).toBe(6)
  })

  it('prefers 7 courts for 40 players balanced after dynamic pace target', () => {
    const result = calculateOptimalCourts({
      n_players: 40,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.courts).toBe(7)
  })

  it('adds actionable warnings for small long sessions', () => {
    const result = calculateOptimalCourts({
      n_players: 8,
      session_duration_min: 120,
      match_duration_min: 15,
      preset: 'balanced',
    })

    const warning = result.setup_warnings.find((item) => item.type === 'small_group_long_session')
    expect(warning).toBeDefined()
    expect(warning?.alternatives.map((item) => item.action)).toEqual(
      expect.arrayContaining(['set_duration', 'set_preset', 'accept_tradeoff']),
    )
    expect(warning?.alternatives.find((item) => item.action === 'set_duration')?.duration_min).toBe(90)
  })

  it('marks repeat pressure on small long setups with concrete alternatives', () => {
    const result = calculateOptimalCourts({
      n_players: 8,
      session_duration_min: 150,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.repeat_pressure.risk).toBe('extreme')
    const warning = result.setup_warnings.find((item) => item.type === 'repeat_pressure')
    expect(warning).toBeDefined()
    expect(warning?.why).toContain('áp lực đối thủ')
    expect(warning?.alternatives.map((item) => item.action)).toEqual(
      expect.arrayContaining(['set_duration', 'set_preset', 'accept_tradeoff']),
    )
  })

  it('keeps repeat pressure low for roomier medium setups', () => {
    const result = calculateOptimalCourts({
      n_players: 24,
      session_duration_min: 90,
      match_duration_min: 15,
      preset: 'balanced',
    })

    expect(result.recommended.repeat_pressure.risk).not.toBe('extreme')
    expect(result.setup_warnings.some((item) => item.type === 'repeat_pressure')).toBe(false)
  })

  it('adds a set-courts alternative when target matches are not reached', () => {
    const result = calculateOptimalCourts({
      n_players: 20,
      session_duration_min: 60,
      match_duration_min: 15,
      preset: 'balanced',
    })

    const warning = result.setup_warnings.find((item) => item.type === 'target_unreachable')
    expect(warning).toBeDefined()
    expect(warning?.alternatives.some((item) => item.action === 'set_courts')).toBe(true)
  })

  it('computes min max and rest estimates', () => {
    const option = buildCourtOption(2, 9, 8)

    expect(option.avg_matches_per_player).toBe(7.1)
    expect(option.min_matches_per_player).toBe(7)
    expect(option.max_matches_per_player).toBe(8)
    expect(option.resting_per_round).toBe(1)
    expect(option.estimated_rest_per_player).toBe(0.9)
    expect(option.play_ratio).toBe(0.89)
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
