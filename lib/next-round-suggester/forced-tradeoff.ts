// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState, Team } from './types.ts'
// @ts-ignore
import { getEffectivePvna } from './state.ts'
// @ts-ignore
import { getProjectedRepeatSummary } from './score.ts'
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

export function buildTradeoffEndpoints(
  poolIds: string[], state: SessionState, tolerance: number,
): ForcedTradeoff {
  if (poolIds.length < 4) return { isForced: false, clean: null }
  const cost = (lu: TradeoffLineup) => computeQualityCost(lu.team_a, lu.team_b, state, { tolerance }).cost
  const all: TradeoffLineup[] = []
  const ids = poolIds
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      for (let k = j + 1; k < ids.length; k += 1)
        for (let l = k + 1; l < ids.length; l += 1)
          all.push(...candidateLineups([ids[i], ids[j], ids[k], ids[l]], state))
  if (all.length === 0) return { isForced: false, clean: null }
  const clean = all.filter(lu => lu.gap <= tolerance && lu.maxMeeting < 3)
  if (clean.length > 0) {
    const best = clean.reduce((m, lu) => (cost(lu) < cost(m) ? lu : m))
    return { isForced: false, clean: best }
  }
  // lexicographic pickers with computeQualityCost tie-break
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
