import {
  createMatch,
  createPlayer,
  createState,
  setOpponentRepeats,
  setPartnerRepeats,
} from '../helpers/factories'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector'

describe('Detector', () => {
  it('returns empty array before round 3', () => {
    const state = createState({ currentRound: 2 })

    expect(detectFairnessIssues(state)).toEqual([])
  })

  it('detects match count imbalance', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 5 }),
        createPlayer('p2', { matches_played: 1 }),
        createPlayer('p3', { matches_played: 5 }),
        createPlayer('p4', { matches_played: 5 }),
      ],
    })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).toContain(
      'match_count_imbalance',
    )
  })

  it('warns when match count range exceeds the expected one-match spread', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 3 }),
        createPlayer('p2', { matches_played: 3 }),
        createPlayer('p3', { matches_played: 2 }),
        createPlayer('p4', { matches_played: 2 }),
        createPlayer('p5', { matches_played: 1 }),
      ],
    })

    const warning = detectFairnessIssues(state).find((item) => item.type === 'match_count_imbalance')

    expect(warning?.message).toContain('muc hop ly la 1')
  })

  it('does not warn when range 1 is expected from fractional match distribution', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 3 }),
        createPlayer('p2', { matches_played: 3 }),
        createPlayer('p3', { matches_played: 2 }),
        createPlayer('p4', { matches_played: 2 }),
        createPlayer('p5', { matches_played: 2 }),
      ],
    })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).not.toContain(
      'match_count_imbalance',
    )
  })

  it('detects underplayed players', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 5 }),
        createPlayer('p2', { matches_played: 1 }),
        createPlayer('p3', { matches_played: 5 }),
        createPlayer('p4', { matches_played: 5 }),
      ],
    })

    const warning = detectFairnessIssues(state).find((item) => item.type === 'underplayed')

    expect(warning?.affected_players).toEqual(['p2'])
  })

  it('does not warn about underplayed players who already checked out', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { matches_played: 5 }),
        createPlayer('p2', {
          matches_played: 1,
          checked_out_at: new Date('2026-05-14T13:00:00.000Z'),
        }),
        createPlayer('p3', { matches_played: 5 }),
        createPlayer('p4', { matches_played: 5 }),
      ],
    })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).not.toContain('underplayed')
  })

  it('detects rest violations as critical', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { consecutive_rest: 2 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })

    const warning = detectFairnessIssues(state).find((item) => item.type === 'rest_violation')

    expect(warning?.severity).toBe('critical')
    expect(warning?.affected_players).toEqual(['p1'])
  })

  it('does not keep rest warning after a historical rest streak has been corrected', () => {
    const state = createState({
      currentRound: 3,
      players: [
        createPlayer('p1', { consecutive_rest: 0 }),
        createPlayer('p2'),
        createPlayer('p3'),
        createPlayer('p4'),
      ],
    })
    state.rounds = [round(0, ['p1']), round(1, ['p1']), round(2, [])]

    expect(detectFairnessIssues(state).map((warning) => warning.type)).not.toContain('rest_violation')
  })

  it('detects repeated partners', () => {
    const p1 = createPlayer('p1', { matches_played: 3 })
    const p2 = createPlayer('p2', { matches_played: 3 })
    setPartnerRepeats(p1, p2, 3)
    const state = createState({ currentRound: 4, players: [p1, p2] })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).toContain('partner_repeat')
  })

  it('detects repeated opponents', () => {
    const p1 = createPlayer('p1', { matches_played: 3 })
    const p2 = createPlayer('p2', { matches_played: 3 })
    setOpponentRepeats(p1, p2, 3)
    const state = createState({ currentRound: 4, players: [p1, p2] })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).toContain('opponent_repeat')
  })

  it('detects opponent repeat burden on a player', () => {
    const p1 = createPlayer('p1', { matches_played: 4 })
    const p2 = createPlayer('p2', { matches_played: 4 })
    const p3 = createPlayer('p3', { matches_played: 4 })
    const p4 = createPlayer('p4', { matches_played: 4 })
    setOpponentRepeats(p1, p2, 2)
    setOpponentRepeats(p1, p3, 2)
    setOpponentRepeats(p1, p4, 2)
    const state = createState({ currentRound: 4, players: [p1, p2, p3, p4] })

    const warning = detectFairnessIssues(state).find((item) => item.type === 'opponent_repeat_burden')

    expect(warning?.severity).toBe('info')
    expect(warning?.affected_players).toEqual(['p1'])
  })

  it('does not warn about repeated partners when the repeated partner checked out', () => {
    const p1 = createPlayer('p1', { matches_played: 3 })
    const p2 = createPlayer('p2', {
      matches_played: 3,
      checked_out_at: new Date('2026-05-14T13:00:00.000Z'),
    })
    setPartnerRepeats(p1, p2, 3)
    const state = createState({ currentRound: 4, players: [p1, p2, createPlayer('p3'), createPlayer('p4')] })

    expect(detectFairnessIssues(state).map((warning) => warning.type)).not.toContain('partner_repeat')
  })
})

function round(roundNo: number, resting: string[]) {
  return {
    session_id: 'session-test',
    round_no: roundNo,
    status: 'completed' as const,
    matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
    resting,
    started_at: new Date('2026-05-14T12:00:00.000Z'),
    ended_at: new Date('2026-05-14T12:10:00.000Z'),
  }
}
