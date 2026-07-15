import { getNextLiveRoundByCourt, reconstructLiveRounds } from '../../../lib/next-round-suggester/live-rounds'
import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'

function liveMatch(
  id: string,
  sequenceNo: number,
  roundNo: number | null,
  courtIdx: number,
  status: SessionLiveMatchRow['status'] = 'completed',
  cycleNo?: number | null,
): SessionLiveMatchRow {
  return {
    id,
    session_id: 'session-test',
    sequence_no: sequenceNo,
    round_no: roundNo,
    cycle_no: cycleNo,
    court_idx: courtIdx,
    status,
    team_a: [`${id}-a`, `${id}-b`],
    team_b: [`${id}-c`, `${id}-d`],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: '2026-07-10T00:00:00.000Z',
    started_at: null,
    ended_at: null,
  }
}

describe('reconstructLiveRounds', () => {
  it('prefers canonical cycle identity over dirty legacy round numbers', () => {
    const result = reconstructLiveRounds([
      liveMatch('m1', 1, 0, 0, 'completed', 0),
      liveMatch('m2', 2, 0, 1, 'completed', 0),
      liveMatch('m3', 3, 0, 0, 'completed', 1),
    ], 2)

    expect(result.canonicalCycleNoAvailable).toBe(true)
    expect(result.persistedRoundNoReliable).toBe(true)
    expect([...result.roundByMatchId.values()]).toEqual([0, 0, 1])
  })

  it('does not mix partial canonical data with legacy rows', () => {
    const result = reconstructLiveRounds([
      liveMatch('m1', 1, 0, 0, 'completed', 4),
      liveMatch('m2', 2, 0, 1),
      liveMatch('m3', 3, 0, 0),
    ], 2)

    expect(result.canonicalCycleNoAvailable).toBe(false)
    expect(result.persistedRoundNoReliable).toBe(false)
    expect([...result.roundByMatchId.values()]).toEqual([0, 0, 1])
  })

  it('keeps valid persisted round numbers', () => {
    const result = reconstructLiveRounds([
      liveMatch('m1', 1, 3, 0),
      liveMatch('m2', 2, 3, 1),
      liveMatch('m3', 3, 4, 0),
    ], 2)

    expect(result.persistedRoundNoReliable).toBe(true)
    expect([...result.roundByMatchId.values()]).toEqual([3, 3, 4])
  })

  it('reconstructs rounds by sequence when a persisted round repeats a court', () => {
    const result = reconstructLiveRounds([
      liveMatch('m1', 1, 3, 0),
      liveMatch('m2', 2, 3, 1),
      liveMatch('m3', 3, 3, 0),
      liveMatch('m4', 4, 4, 1),
    ], 2)

    expect(result.persistedRoundNoReliable).toBe(false)
    expect([...result.roundByMatchId.values()]).toEqual([0, 0, 1, 1])
  })

  it('does not let cancelled matches consume reconstructed round slots', () => {
    const result = reconstructLiveRounds([
      liveMatch('m1', 1, null, 0),
      liveMatch('cancelled', 2, null, 1, 'cancelled'),
      liveMatch('m2', 3, null, 1),
      liveMatch('m3', 4, null, 0),
    ], 2)

    expect(result.matches.map(match => match.id)).toEqual(['m1', 'm2', 'm3'])
    expect([...result.roundByMatchId.values()]).toEqual([0, 0, 1])
  })
})

describe('getNextLiveRoundByCourt', () => {
  it('targets each rolling court immediately after its own latest completion', () => {
    const rows = [
      liveMatch('a', 0, 0, 0, 'completed', 0),
      liveMatch('b', 1, 0, 1, 'completed', 0),
      liveMatch('c', 2, 1, 0, 'completed', 1),
    ]
    expect(Object.fromEntries(getNextLiveRoundByCourt(rows, 2, [0, 1]))).toEqual({
      0: 2,
      1: 1,
    })
  })

  it('uses the projected round for a court without completed history', () => {
    expect(Object.fromEntries(getNextLiveRoundByCourt([], 2, [0, 1]))).toEqual({
      0: 0,
      1: 0,
    })
  })
})
