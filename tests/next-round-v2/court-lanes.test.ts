import { buildCourtLaneModels } from '../../features/host/session-detail/next-round-v2/court-lanes'

type TestMatch = {
  id: string
  court_idx: number | null
  sequence_no: number
}

function match(id: string, courtIdx: number, sequenceNo = courtIdx): TestMatch {
  return {
    id,
    court_idx: courtIdx,
    sequence_no: sequenceNo,
  }
}

describe('buildCourtLaneModels', () => {
  it('keeps each suggested match in its fixed court lane', () => {
    const lanes = buildCourtLaneModels({
      courtCount: 3,
      liveMatches: [],
      suggestedMatches: [
        match('preview-0', 0),
        match('preview-1', 1),
        match('preview-2', 2),
      ],
    })

    expect(lanes.map(lane => lane.courtIdx)).toEqual([0, 1, 2])
    expect(lanes.map(lane => lane.suggestedMatch?.id)).toEqual(['preview-0', 'preview-1', 'preview-2'])
    expect(lanes.every(lane => lane.liveMatch === null)).toBe(true)
  })

  it('prefers a live match over a suggested match on the same court', () => {
    const lanes = buildCourtLaneModels({
      courtCount: 3,
      liveMatches: [match('live-1', 1)],
      suggestedMatches: [
        match('preview-0', 0),
        match('stale-preview-1', 1),
        match('preview-2', 2),
      ],
    })

    expect(lanes[0]).toMatchObject({ courtIdx: 0, liveMatch: null, suggestedMatch: { id: 'preview-0' } })
    expect(lanes[1]).toMatchObject({ courtIdx: 1, liveMatch: { id: 'live-1' }, suggestedMatch: null })
    expect(lanes[2]).toMatchObject({ courtIdx: 2, liveMatch: null, suggestedMatch: { id: 'preview-2' } })
  })

  it('lets a completing match hold the lane until a replacement suggestion exists', () => {
    const completingIds = new Set(['completed-live-1'])
    const waitingLane = buildCourtLaneModels({
      courtCount: 2,
      liveMatches: [match('completed-live-1', 1)],
      suggestedMatches: [],
      liveYieldsToSuggested: liveMatch => completingIds.has(liveMatch.id),
    })

    expect(waitingLane[1]).toMatchObject({
      courtIdx: 1,
      liveMatch: { id: 'completed-live-1' },
      suggestedMatch: null,
    })

    const filledLane = buildCourtLaneModels({
      courtCount: 2,
      liveMatches: [match('completed-live-1', 1)],
      suggestedMatches: [match('new-preview-1', 1)],
      liveYieldsToSuggested: liveMatch => completingIds.has(liveMatch.id),
    })

    expect(filledLane[1]).toMatchObject({
      courtIdx: 1,
      liveMatch: null,
      suggestedMatch: { id: 'new-preview-1' },
    })
  })
})
