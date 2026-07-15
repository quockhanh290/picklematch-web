// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { SessionState } from '../types.ts'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Set) return [...value].sort().map(stableValue)
  if (value instanceof Map) {
    return [...value.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, nested]) => [key, stableValue(nested)])
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

export function stablePlannerJson(value: unknown) {
  return JSON.stringify(stableValue(value))
}

export function buildPlanningRosterIdentity(state: SessionState) {
  return [...state.players.values()]
    .sort((left, right) => left.player_id.localeCompare(right.player_id))
    .map(player => ({
      player_id: player.player_id,
      checked_in_at: player.checked_in_at.toISOString(),
      checked_out: player.checked_out_at !== null,
      opted_rest: player.opted_rest,
      pvna: player.pvna,
      effective_pvna: player.effective_pvna ?? null,
      group_id: player.group_id,
      gender: player.gender,
      partner_gender_pref: player.partner_gender_pref,
      opponent_gender_pref: player.opponent_gender_pref,
      avoid_ids: [...(player.avoid_ids ?? [])].sort(),
    }))
}

export function buildPlanningConfigIdentity(state: SessionState) {
  return {
    courts: state.config.courts,
    pvna_tolerance: state.config.pvna_tolerance,
    planned_total_rounds: state.config.planned_total_rounds ?? null,
    court_preset: state.config.court_preset ?? null,
    weights: state.config.weights,
    avoid_pairs: (state.config.avoid_pairs ?? [])
      .map(pair => ({
        player_a: pair.player_a < pair.player_b ? pair.player_a : pair.player_b,
        player_b: pair.player_a < pair.player_b ? pair.player_b : pair.player_a,
        reason: pair.reason ?? null,
      }))
      .sort((left, right) =>
        left.player_a.localeCompare(right.player_a)
        || left.player_b.localeCompare(right.player_b)
        || String(left.reason).localeCompare(String(right.reason)),
      ),
  }
}
