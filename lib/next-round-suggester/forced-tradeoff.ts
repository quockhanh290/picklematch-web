// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState, Team } from './types.ts'
// @ts-ignore
import { getEffectivePvna } from './state.ts'
// @ts-ignore
import { getProjectedRepeatSummary, scoreMatch } from './score.ts'
// @ts-ignore
import { computeQualityCost } from './quality-cost.ts'
// @ts-ignore
import { getAvoidPenalty, AVOID_PARTNER_PENALTY } from './avoid.ts'

export type TradeoffLineup = { team_a: Team; team_b: Team; gap: number; maxMeeting: number }
export type ForcedTradeoff =
  | { isForced: false; clean: TradeoffLineup | null }
  | { isForced: true; acceptRepeat: TradeoffLineup; acceptImbalance: TradeoffLineup }

const SPLITS: readonly [readonly [number, number], readonly [number, number]][] = [
  [[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]],
]

function candidateLineups(four: string[], state: SessionState): TradeoffLineup[] {
  const pv = (id: string) => getEffectivePvna(state.players.get(id)!)
  const P = (id: string) => state.players.get(id)!
  const out: TradeoffLineup[] = []
  for (const [sa, sb] of SPLITS) {
    const team_a: Team = [four[sa[0]], four[sa[1]]]
    const team_b: Team = [four[sb[0]], four[sb[1]]]
    if (getAvoidPenalty(P(team_a[0]), P(team_a[1]), 'partner') === AVOID_PARTNER_PENALTY) continue
    if (getAvoidPenalty(P(team_b[0]), P(team_b[1]), 'partner') === AVOID_PARTNER_PENALTY) continue
    const gap = Math.abs(pv(team_a[0]) + pv(team_a[1]) - pv(team_b[0]) - pv(team_b[1]))
    const rep = getProjectedRepeatSummary(team_a, team_b, state)
    const maxMeeting = Math.max(rep.max_partner_pair_count, rep.max_opponent_pair_count)
    out.push({ team_a, team_b, gap, maxMeeting })
  }
  return out
}

// A pool this large is near-guaranteed to contain a clean foursome (empirically, forced-tradeoff
// pools stay small — a handful of stragglers on an odd court). Skip the C(n,4)x3 enumeration above
// this size rather than pay an O(n^4) cost for a case that fails soft to "not forced" either way.
const FORCED_TRADEOFF_MAX_POOL = 28

export function buildTradeoffEndpoints(
  poolIds: string[], state: SessionState, tolerance: number,
): ForcedTradeoff {
  if (poolIds.length < 4) return { isForced: false, clean: null }
  if (poolIds.length > FORCED_TRADEOFF_MAX_POOL) return { isForced: false, clean: null }
  const cost = (lu: TradeoffLineup) => computeQualityCost(lu.team_a, lu.team_b, state, { tolerance }).cost
  const all: TradeoffLineup[] = []
  const ids = poolIds
  // Single pass: collect every candidate into `all` (needed for the Pareto endpoints below), but
  // return the instant a clean lineup turns up — callers only ever check isForced/clean existence,
  // never which clean lineup was chosen, so there's no need to keep enumerating for a min-cost pick.
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1) {
          const lineups = candidateLineups([ids[i], ids[j], ids[k], ids[l]], state)
          for (const lu of lineups) {
            all.push(lu)
            if (lu.gap <= tolerance && lu.maxMeeting < 3) return { isForced: false, clean: lu }
          }
        }
  if (all.length === 0) return { isForced: false, clean: null }
  // No clean lineup exists anywhere in the pool — build the two Pareto endpoints via lexicographic
  // pickers, each with a computeQualityCost tie-break.
  const lexMin = (primary: (lu: TradeoffLineup) => number, secondary: (lu: TradeoffLineup) => number) =>
    all.reduce((m, lu) => {
      if (primary(lu) !== primary(m)) return primary(lu) < primary(m) ? lu : m
      if (secondary(lu) !== secondary(m)) return secondary(lu) < secondary(m) ? lu : m
      return cost(lu) < cost(m) ? lu : m
    })
  const acceptRepeat = lexMin(lu => lu.gap, lu => lu.maxMeeting)
  const acceptImbalance = lexMin(lu => lu.maxMeeting, lu => lu.gap)
  return { isForced: true, acceptRepeat, acceptImbalance }
}

// The single freshest lineup over the pool: lexicographic min(maxMeeting, then gap), computeQualityCost
// tie-break. Used as the "accept-imbalance / swap to a fresher lineup" alternative to a degraded seated
// lineup. Unlike buildTradeoffEndpoints (which short-circuits on any clean lineup), this always scans the
// full pool for the min-repeat candidate. Returns null if pool < 4 or over the size cap.
export function buildFreshestLineup(
  poolIds: string[], state: SessionState, tolerance: number,
): TradeoffLineup | null {
  if (poolIds.length < 4 || poolIds.length > FORCED_TRADEOFF_MAX_POOL) return null
  const cost = (lu: TradeoffLineup) => computeQualityCost(lu.team_a, lu.team_b, state, { tolerance }).cost
  let best: TradeoffLineup | null = null
  const ids = poolIds
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1)
          for (const lu of candidateLineups([ids[i], ids[j], ids[k], ids[l]], state)) {
            if (best === null) { best = lu; continue }
            if (lu.maxMeeting !== best.maxMeeting) { if (lu.maxMeeting < best.maxMeeting) best = lu; continue }
            if (lu.gap !== best.gap) { if (lu.gap < best.gap) best = lu; continue }
            if (cost(lu) < cost(best)) best = lu
          }
  return best
}

export type MinCostFoursome = {
  ids: [string, string, string, string]
  team_a: Team; team_b: Team
  cost: number; maxMeeting: number; gap: number
}

// Deterministic total order over candidate lineups: cost → maxMeeting → gap → pairing string.
// The pairing (team_a|team_b) final tie-break keys on the actual split chosen, not the unordered
// subset, ensuring distinct splits of the same 4-subset that tie on cost/maxMeeting/gap
// compare deterministically. Zero dependence on iteration or insertion order.
function foursomeLessThan(a: MinCostFoursome, b: MinCostFoursome): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost
  if (a.maxMeeting !== b.maxMeeting) return a.maxMeeting < b.maxMeeting
  if (a.gap !== b.gap) return a.gap < b.gap
  const aPairing = `${a.team_a.join(',')}|${a.team_b.join(',')}`
  const bPairing = `${b.team_a.join(',')}|${b.team_b.join(',')}`
  return aPairing < bPairing
}

// The min-quality-cost foursome over the pool, respecting a fairness hard-filter (requiredIds must all
// be in the chosen four) and avoid-pairs (via candidateLineups, which drops avoid-partner splits).
// Pure — no Date.now/Math.random, no makeAlternative. Returns null for pool < 4, pool >
// FORCED_TRADEOFF_MAX_POOL, or when no subset contains every required id.
export function findMinCostFoursome(
  poolIds: string[], requiredIds: Set<string>, state: SessionState, tolerance: number,
): MinCostFoursome | null {
  if (poolIds.length < 4 || poolIds.length > FORCED_TRADEOFF_MAX_POOL) return null
  const required = [...requiredIds]
  const ids = poolIds
  let best: MinCostFoursome | null = null
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1) {
          const four: [string, string, string, string] = [ids[i], ids[j], ids[k], ids[l]]
          if (required.length > 0 && !required.every(id => four.includes(id))) continue
          for (const lu of candidateLineups(four, state)) {
            // Rank with whichever model the session's flag selects. Determinism (the exhaustive scan)
            // and the scoring model are separate concerns: every session should get the deterministic
            // scan, but a session outside the quality-cost allowlist must still be ranked by the legacy
            // model, or the kill-switch does not actually switch anything off. scoreMatch already
            // dispatches on the flag, and carries the tolerance barrier on its cost branch.
            const scored = scoreMatch(lu.team_a, lu.team_b, state, { tolerance })
            const cost = typeof scored === 'number' ? scored : scored.score
            const cand: MinCostFoursome = {
              ids: four, team_a: lu.team_a, team_b: lu.team_b, cost, maxMeeting: lu.maxMeeting, gap: lu.gap,
            }
            if (best === null || foursomeLessThan(cand, best)) best = cand
          }
        }
  return best
}

export type WaitRescueOption = { court_idx: number; started_at: string | null }

export function simulateWaitWouldClean(
  poolIds: string[],
  liveCourts: { court_idx: number; player_ids: string[]; started_at: string | null }[],
  state: SessionState, tolerance: number,
): WaitRescueOption[] {
  const poolSet = new Set(poolIds)
  const qualifying: WaitRescueOption[] = []
  for (const court of liveCourts) {
    const enlarged = [...poolIds, ...court.player_ids.filter(id => !poolSet.has(id))]
    const res = buildTradeoffEndpoints(enlarged, state, tolerance)
    if (res.isForced === false && res.clean) qualifying.push({ court_idx: court.court_idx, started_at: court.started_at })
  }
  return qualifying.sort((a, b) => {
    const ta = a.started_at ? Date.parse(a.started_at) : Infinity
    const tb = b.started_at ? Date.parse(b.started_at) : Infinity
    return ta - tb || a.court_idx - b.court_idx
  })
}
