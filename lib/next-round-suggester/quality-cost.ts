// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { GenderPreference, PlayerSessionState, SessionState, Team } from './types.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getEffectivePvna } from './state.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getAvoidPenalty } from './avoid.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { RECENT_REPEAT_PENALTY_WINDOW } from './score.ts'

export type QualityCostWeights = {
  balanceTie: number; balanceOver: number; intraTie: number; intraOver: number;
  repeat2: number; repeat3: number; repeatStep: number; opponentFactor: number;
  genderPartner: number; genderOpponent: number; groupReward: number; groupCap: number; avoidOpponent: number;
}
// Illustrative starting values — a later calibration task tunes magnitudes; shapes are fixed.
export const DEFAULT_QUALITY_COST_WEIGHTS: QualityCostWeights = {
  balanceTie: 0.1, balanceOver: 1.3, intraTie: 0.1, intraOver: 1.0,
  repeat2: 0.8, repeat3: 2.5, repeatStep: 2.0, opponentFactor: 0.7,
  genderPartner: 0.4, genderOpponent: 0.2, groupReward: 0.3, groupCap: 0.6, avoidOpponent: 4.0,
}
const HARD_INTRA = 1.0

export type QualityCostResult = { cost: number; gap: number; maxProjectedMeeting: number }

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
    const d = roundNo - round.round_no
    if (d <= 0 || d > RECENT_REPEAT_PENALTY_WINDOW) continue
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
