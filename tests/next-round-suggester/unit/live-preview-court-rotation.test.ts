import { buildSuggestedMatchPayloads } from '../../../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../helpers/factories'
import type { PlayerSessionState } from '../../../lib/next-round-suggester/types'

// Production request 828b7010 asked for six courts and its selection_debug came back as
// [0, 1, 2, 3, 3, 3]: six iterations, three of them spent on court 3, and courts 4 and 5 never
// attempted once. A court is marked handled only on the seating path (queuedCourtIdxs.add runs after
// the payload is built), so a court that fails stays in the open list and the next iteration picks it
// again. It only shows up when the caller passes no explicit court list — that request had
// requested_court_idxs = [].
//
// Retrying is not worthless: each iteration gets a larger slice of the batch budget than the last
// (measured 350 -> 442 -> 582 -> 821 -> 900ms), so a court can fail on a thin slice and seat on a fat
// one. But it has to queue behind courts that have had no turn at all. In that request courts 4 and 5
// had MORE eligible players than court 3 (9 and 5 against 4), because eligibility follows each court's
// own round — the two courts starved by the retries were the likelier ones to fill.
describe('court rotation across a batch', () => {
  // Four players who can pair freely, plus a group who all avoid each other as partners. Avoid carries
  // an Infinity partner penalty, so no court can ever seat that group. They still count towards
  // availableForBatch, so the batch is promised more iterations than the pool can fill and keeps going
  // after the first failure — which is what makes the court choice observable.
  const attemptedCourts = (toxicCount: number) => {
    const clean = Array.from({ length: 4 }, (_, i) => createPlayer(`clean-${i}`, { pvna: 3 + i * 0.05 }))
    const toxic = Array.from({ length: toxicCount }, (_, i) => createPlayer(`toxic-${i}`, { pvna: 3 + i * 0.05 }))
    for (const player of toxic) {
      (player as PlayerSessionState).avoid_ids = new Set(
        toxic.filter(other => other !== player).map(other => other.player_id),
      )
    }
    const state = createState({ courts: 6, pvnaTolerance: 0.5, players: [...clean, ...toxic] })

    const debugOut: { court_idx: number }[] = []
    buildSuggestedMatchPayloads({
      count: 6,
      sessionId: state.session_id,
      courtCount: 6,
      state,
      rows: { liveMatchRows: [], liveStateVersion: 1 },
      completingLiveMatchIds: new Set(),
      fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
      fairnessWarnings: [],
      playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])),
      pvnaTolerance: 0.5,
      debugOut: debugOut as never,
    })
    return debugOut.map(entry => entry.court_idx)
  }

  it('gives every open court a turn before retrying one that failed', () => {
    const attempts = attemptedCourts(8)

    expect(attempts.length).toBeGreaterThan(1)
    expect(attempts).toEqual([...new Set(attempts)])
  })

  it('keeps rotating as the batch grows rather than piling onto one court', () => {
    const attempts = attemptedCourts(16)

    expect(attempts.length).toBeGreaterThan(2)
    expect(new Set(attempts).size).toBe(attempts.length)
  })
})
