// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import { getEffectivePvna } from './state.ts'
import type {
  SessionState,
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
} from './types.ts'
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
import type { SuggestedMatchPayload } from './live-preview.ts'

export function getPayloadIntraTeamGap(payload: SuggestedMatchPayload, state: SessionState) {
  const gap = (team: [string, string]) => Math.abs(
    (state.players.get(team[0]) ? getEffectivePvna(state.players.get(team[0])!) : 0)
      - (state.players.get(team[1]) ? getEffectivePvna(state.players.get(team[1])!) : 0),
  )
  return Math.max(gap(payload.team_a), gap(payload.team_b))
}

export function getPayloadPairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`
}

export function hasAvoidedPartnerPair(payloads: SuggestedMatchPayload[], state: SessionState) {
  const avoidPairs = new Set((state.config.avoid_pairs ?? []).map(pair =>
    getPayloadPairKey(pair.player_a, pair.player_b)
  ))
  if (avoidPairs.size === 0) return false
  return payloads.some(payload =>
    avoidPairs.has(getPayloadPairKey(payload.team_a[0], payload.team_a[1]))
    || avoidPairs.has(getPayloadPairKey(payload.team_b[0], payload.team_b[1]))
  )
}

export function getPayloadMaxHistoricalPairCount(payload: SuggestedMatchPayload, state: SessionState) {
  const partnerCounts = [
    state.players.get(payload.team_a[0])?.partner_counts.get(payload.team_a[1]) ?? 0,
    state.players.get(payload.team_b[0])?.partner_counts.get(payload.team_b[1]) ?? 0,
  ]
  const opponentCounts = payload.team_a.flatMap(left =>
    payload.team_b.map(right =>
      state.players.get(left)?.opponent_counts.get(right) ?? 0
    )
  )
  return {
    partner: Math.max(0, ...partnerCounts),
    opponent: Math.max(0, ...opponentCounts),
  }
}

export function getPayloadProjectedMaxMeeting(payload: SuggestedMatchPayload, state: SessionState) {
  const counts = getPayloadMaxHistoricalPairCount(payload, state)
  return Math.max(counts.partner, counts.opponent) + 1
}
