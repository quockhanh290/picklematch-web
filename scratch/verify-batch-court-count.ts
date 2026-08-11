// BUG #22: the batch loop checked the wall clock before each court and stopped once the budget ran low,
// so identical input filled a different number of courts depending on machine speed — and a host cannot
// tell a court that was dropped from one that could not be filled.
//
// Usage: npx tsx scratch/verify-batch-court-count.ts slow 200
//
// Measured on this file, 6 courts requested, 32 players:
//
//   clock step   before fix   after fix
//      100ms          6           6
//      200ms          4           6      <- courts silently dropped
//      300ms          0           0      <- a single clock read costs more than a court's whole slice;
//                                           no budget policy fills anything here
//
// Lives in scratch rather than tests/ deliberately. Under jest the same mocking has no discriminating
// window at all — 10-150ms fills six courts with or without the fix, and 200ms collapses to one either
// way, because that environment reads the clock a different number of times. A jest test would have
// passed with the fix reverted, which certifies nothing.
const MODE = process.argv[2] ?? 'real'
if (MODE === 'frozen') performance.now = () => 1_000_000
if (MODE === 'slow') {
  const step = Number(process.argv[3] ?? 500)
  let t = 1_000_000
  performance.now = () => { t += step; return t }
}

import { buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview'
import { createPlayer, createState } from '../tests/next-round-suggester/helpers/factories'

const players = Array.from({ length: 32 }, (_, i) =>
  createPlayer(`P${i + 1}`, { pvna: 2.5 + (i % 10) * 0.2 }))
const state = createState({ courts: 6, pvnaTolerance: 0.5, players })

const out = buildSuggestedMatchPayloads({
  count: 6,
  sessionId: state.session_id,
  courtCount: 6,
  state,
  rows: { liveMatchRows: [], liveStateVersion: null },
  completingLiveMatchIds: new Set(),
  fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
  fairnessWarnings: [],
  playersById: new Map([...state.players.keys()].map(id => [id, { name: id }])) as never,
  pvnaTolerance: 0.5,
  options: { ignoreCapacityLock: true, rollingHorizon: false, rollingPlanTarget: null },
} as never)

console.log('payloads:', out.length)
console.log('warnings of first:', out[0]?.warnings)
