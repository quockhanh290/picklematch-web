// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { GenderPreference, PlayerSessionState, SessionState, Team } from './types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getEffectivePvna } from './state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getAvoidPenalty, AVOID_PARTNER_PENALTY } from './avoid.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { RECENT_REPEAT_PENALTY_WINDOW } from './score.ts'

export type QualityCostWeights = {
  balanceTie: number; balanceOver: number; intraTie: number; intraOver: number;
  repeat2: number; repeat3: number; repeatStep: number; opponentFactor: number;
  genderPartner: number; genderOpponent: number; groupReward: number; groupCap: number; avoidOpponent: number;
}
// Calibrated via scripts/diagnostics/quality-cost-sim.ts (Task 6 A/B sweep, see that file's header for
// the before/after table) + the 5 intent-check scenarios in tests/.../quality-cost.test.ts. Shapes are
// fixed; only balanceOver/repeat2/repeat3/repeatStep moved from the Task 1 illustrative starting values.
export const DEFAULT_QUALITY_COST_WEIGHTS: QualityCostWeights = {
  balanceTie: 0.1, balanceOver: 1.6, intraTie: 0.1, intraOver: 4.0,
  repeat2: 1.0, repeat3: 3.6, repeatStep: 2.4, opponentFactor: 0.7,
  genderPartner: 0.4, genderOpponent: 0.2, groupReward: 0.3, groupCap: 0.6, avoidOpponent: 4.0,
}
const HARD_INTRA = 1.0

export type QualityCostResult = { cost: number; gap: number; maxProjectedMeeting: number }

// Balance tolerance is a threshold, not a price. Soft costs (gender preference, repeats, group bonus)
// may only order lineups WITHIN the same tolerance status — they can never buy a lineup past it.
//
// Expressed as a barrier on the cost scale rather than a gate, for two reasons. It survives being
// summed across courts, so a board with fewer over-tolerance courts beats one with more whatever the
// soft costs say. And it is self-relaxing: when every candidate is over tolerance they all carry the
// same barrier and cost decides again, so this can never leave a court unseated. That is why it takes
// no "allow overflow" escape hatch — reading the legacy relaxation options here would tie the cost
// model back to the 8-stage ladder it is meant to replace.
export const OVER_TOLERANCE_BARRIER = 1e6

export function lineupRankingCost(result: QualityCostResult, tolerance: number): number {
  return result.gap > tolerance ? result.cost + OVER_TOLERANCE_BARRIER : result.cost
}

const sameGroup = (x: PlayerSessionState, y: PlayerSessionState) =>
  x.group_id != null && x.group_id === y.group_id

// Escalating meeting curve: projected meeting m (1 = fresh). m>=4 grows linearly.
function meetCurve(m: number, w: QualityCostWeights) {
  if (m <= 1) return 0
  if (m === 2) return w.repeat2
  if (m === 3) return w.repeat3
  return w.repeat3 + w.repeatStep * (m - 3)
}

// Recency-weighted prior meeting count within the window (recent meetings count more).
// Reuses the same window as score.ts; a meeting last round ~= 1.0, older decays.
function recentMeetings(state: SessionState, xId: string, yId: string, kind: 'partner' | 'opp'): number {
  const roundNo = state.current_round
  let weighted = 0
  for (const round of state.rounds) {
    if (round.status !== 'completed') continue
    // Same clamp score.ts applies: round_no counts cycles on one court, so a completed round can carry
    // a higher number than the court being judged. Discarding it as "the future" priced a meeting that
    // finished minutes ago on a faster court at the stale floor instead of full weight — measured at
    // 0.31 against 0.73 for the identical pairing from a slower court.
    const d = Math.max(1, roundNo - round.round_no)
    if (d > RECENT_REPEAT_PENALTY_WINDOW) continue
    const decay = d <= 1 ? 1 : d === 2 ? 0.65 : 0.35
    for (const m of round.matches) {
      const pairs = kind === 'partner'
        ? [[m.team_a[0], m.team_a[1]], [m.team_b[0], m.team_b[1]]]
        : m.team_a.flatMap(a => m.team_b.map(b => [a, b]))
      if (pairs.some(([p, q]) => (p === xId && q === yId) || (p === yId && q === xId))) weighted += decay
    }
  }
  return weighted
}

function prefMatchesGender(pref: GenderPreference, player: PlayerSessionState | undefined): boolean {
  if (pref === 'any') return true
  if (!player?.gender) return true
  return player.gender === pref
}

function getPartnerGenderCost(
  player: PlayerSessionState,
  partner: PlayerSessionState | undefined,
  genderPartnerWeight: number,
): number {
  if (prefMatchesGender(player.partner_gender_pref, partner)) return 0
  const sameGroupPair = Boolean(player.group_id && player.group_id === partner?.group_id)
  return sameGroupPair ? genderPartnerWeight * 0.5 : genderPartnerWeight
}

// Ported from score.ts:genderPenalty, reweighted by w.genderPartner / w.genderOpponent (soft, lowest tier).
function genderPref(teamA: Team, teamB: Team, state: SessionState, w: QualityCostWeights): number {
  const players = new Map<string, { partnerId: string; opponentIds: string[] }>([
    [teamA[0], { partnerId: teamA[1], opponentIds: teamB }],
    [teamA[1], { partnerId: teamA[0], opponentIds: teamB }],
    [teamB[0], { partnerId: teamB[1], opponentIds: teamA }],
    [teamB[1], { partnerId: teamB[0], opponentIds: teamA }],
  ])
  let cost = 0

  for (const [playerId, relations] of players) {
    const player = state.players.get(playerId)
    if (!player) continue

    const partner = state.players.get(relations.partnerId)
    cost += getPartnerGenderCost(player, partner, w.genderPartner)

    if (player.opponent_gender_pref !== 'any') {
      for (const opponentId of relations.opponentIds) {
        const opponent = state.players.get(opponentId)
        if (!prefMatchesGender(player.opponent_gender_pref, opponent)) {
          cost += w.genderOpponent
        }
      }
    }
  }

  return cost
}

export function computeQualityCost(
  teamA: Team, teamB: Team, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): QualityCostResult {
  const w = { ...DEFAULT_QUALITY_COST_WEIGHTS, ...(opts.weights ?? {}) }
  const P = (id: string) => state.players.get(id)!
  const pv = (id: string) => getEffectivePvna(P(id))
  const [a0, a1] = teamA, [b0, b1] = teamB

  const gap = Math.abs(pv(a0) + pv(a1) - pv(b0) - pv(b1))
  const iA = Math.abs(pv(a0) - pv(a1)), iB = Math.abs(pv(b0) - pv(b1))
  const over = Math.max(0, gap - opts.tolerance)
  const oIA = Math.max(0, iA - HARD_INTRA), oIB = Math.max(0, iB - HARD_INTRA)
  let cost = w.balanceTie * gap + w.balanceOver * over * over
    + w.intraTie * (iA + iB) + w.intraOver * (oIA * oIA + oIB * oIB)

  let maxMeeting = 1
  const addRepeat = (xId: string, yId: string, kind: 'partner' | 'opp', factor: number) => {
    if (sameGroup(P(xId), P(yId))) return
    const allTime = kind === 'partner'
      ? (P(xId).partner_counts.get(yId) ?? 0)
      : (P(xId).opponent_counts.get(yId) ?? 0)
    const projected = allTime + 1
    maxMeeting = Math.max(maxMeeting, projected)
    // recency multiplier: recent meetings weigh full, older ones fade (min 0.4 so a repeat is never free)
    const recency = allTime === 0 ? 1 : Math.max(0.4, recentMeetings(state, xId, yId, kind) / allTime || 0.4)
    cost += factor * meetCurve(projected, w) * recency
  }
  addRepeat(a0, a1, 'partner', 1); addRepeat(b0, b1, 'partner', 1)
  for (const x of teamA) for (const y of teamB) addRepeat(x, y, 'opp', w.opponentFactor)

  // gender pref (soft, lowest tier)
  cost += genderPref(teamA, teamB, state, w)

  // group reward (mild, capped below balance)
  const groupPairs = (sameGroup(P(a0), P(a1)) ? 1 : 0) + (sameGroup(P(b0), P(b1)) ? 1 : 0)
  cost -= Math.min(w.groupCap, w.groupReward * groupPairs)

  // avoid-opponent (heavy soft); avoid-partner is a hard invariant handled by the caller (scoreMatch)
  const avoidOpp = [[a0, b0], [a0, b1], [a1, b0], [a1, b1]]
    .filter(([x, y]) => getAvoidPenalty(P(x), P(y), 'opponent') > 0).length
  cost += w.avoidOpponent * avoidOpp

  return { cost, gap, maxProjectedMeeting: maxMeeting }
}

export type Foursome = [string, string, string, string]

// The 3 distinct ways to split 4 players into two pairs. Fixed order = deterministic tie-break.
const SPLIT_INDICES: readonly [readonly [number, number], readonly [number, number]][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

export function bestSplitForFoursome(
  four: Foursome, state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights> },
): { cost: number; gap: number; overTol: boolean; team_a: Team; team_b: Team } {
  const P = (id: string) => state.players.get(id)!
  type Ranked = { rank: number; cost: number; gap: number; overTol: boolean; team_a: Team; team_b: Team }
  let best: Ranked | null = null
  for (const [sa, sb] of SPLIT_INDICES) {
    const team_a: Team = [four[sa[0]], four[sa[1]]]
    const team_b: Team = [four[sb[0]], four[sb[1]]]
    // Hard block: avoid pairs as partners — mirrors scoreMatch's feasibility floor (score.ts) so
    // bestSplitForFoursome/jointRepartition inherit the same hard invariant as the greedy path.
    const isInfeasible =
      getAvoidPenalty(P(team_a[0]), P(team_a[1]), 'partner') === AVOID_PARTNER_PENALTY ||
      getAvoidPenalty(P(team_b[0]), P(team_b[1]), 'partner') === AVOID_PARTNER_PENALTY
    const qc = computeQualityCost(team_a, team_b, state, opts)
    // Infeasible splits rank worst, so a feasible split always wins.
    const rank = isInfeasible ? Infinity : lineupRankingCost(qc, opts.tolerance)
    const overTol = isInfeasible ? true : qc.gap > opts.tolerance
    if (best === null || rank < best.rank) {
      best = { rank, cost: isInfeasible ? Infinity : qc.cost, gap: qc.gap, overTol, team_a, team_b }
    }
  }
  const { rank: _rank, ...winner } = best!
  return winner
}

export type JointSplit = { court_idx: number; team_a: Team; team_b: Team }
export const JOINT_MAX_ITERATIONS = 4000

export function jointRepartition(
  courts: { court_idx: number; four: Foursome }[], state: SessionState,
  opts: { tolerance: number; weights?: Partial<QualityCostWeights>; maxIterations?: number },
): { splits: JointSplit[]; changed: boolean; totalCostBefore: number; totalCostAfter: number } {
  const maxIterations = opts.maxIterations ?? JOINT_MAX_ITERATIONS
  const work = courts.map(c => [...c.four] as string[])
  const split = work.map(four => bestSplitForFoursome(four as Foursome, state, opts))
  const overCount = (items: typeof split) => items.reduce((n, s) => n + (s.overTol ? 1 : 0), 0)
  const totalCostBefore = split.reduce((sum, c) => sum + c.cost, 0)
  const seedOver = overCount(split)
  let total = totalCostBefore
  // Converged-result guard: the per-swap acceptance is the ORIGINAL free cost-only hill-climb, so the
  // search can freely traverse transient over-tolerance states (a 2-swap sequence to a strictly-better
  // all-within-tol board is not blocked by an intermediate that crosses tolerance). The over-tol
  // guarantee is enforced on the CONVERGED result instead: we snapshot the lowest-cost board seen whose
  // global over-count is <= the (clean) seed's, and return that snapshot rather than the raw converged
  // split. Seed is always a candidate, so totalCostAfter <= totalCostBefore and over-count never rises.
  let bestOver = seedOver
  let bestCost = totalCostBefore
  let bestTeams = split.map(s => ({ team_a: s.team_a, team_b: s.team_b }))
  let improved = true
  let iters = 0
  while (improved && iters < maxIterations) {
    improved = false
    iters += 1
    for (let ci = 0; ci < work.length && !improved; ci += 1) {
      for (let cj = ci + 1; cj < work.length && !improved; cj += 1) {
        for (let pi = 0; pi < 4 && !improved; pi += 1) {
          for (let pj = 0; pj < 4 && !improved; pj += 1) {
            const tmp = work[ci][pi]; work[ci][pi] = work[cj][pj]; work[cj][pj] = tmp
            const nci = bestSplitForFoursome(work[ci] as Foursome, state, opts)
            const ncj = bestSplitForFoursome(work[cj] as Foursome, state, opts)
            const oldCost = split[ci].cost + split[cj].cost
            const newCost = nci.cost + ncj.cost
            const delta = newCost - oldCost
            if (delta < -1e-6) {
              split[ci] = nci; split[cj] = ncj; total += delta; improved = true
              // Snapshot the best clean-enough board (over-count <= seed). Accepted swaps strictly lower
              // total, so the latest clean-enough board is also the lowest-cost one seen so far.
              const curOver = overCount(split)
              if (curOver <= seedOver && (curOver < bestOver || (curOver === bestOver && total < bestCost - 1e-9))) {
                bestOver = curOver
                bestCost = total
                bestTeams = split.map(s => ({ team_a: s.team_a, team_b: s.team_b }))
              }
            } else {
              const undo = work[ci][pi]; work[ci][pi] = work[cj][pj]; work[cj][pj] = undo
            }
          }
        }
      }
    }
  }
  const splits: JointSplit[] = courts.map((c, i) => ({
    court_idx: c.court_idx, team_a: bestTeams[i].team_a, team_b: bestTeams[i].team_b,
  }))
  // totalCostAfter <= totalCostBefore always (seed is a snapshot candidate); `changed` can be true with
  // equal cost only when the returned board dropped the global over-tol count below the seed's.
  const changed = bestOver < seedOver || (bestOver === seedOver && bestCost < totalCostBefore - 1e-9)
  return { splits, changed, totalCostBefore, totalCostAfter: bestCost }
}
