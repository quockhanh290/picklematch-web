import {
  filterRollingInvariantAlternatives,
  getActiveRollingInvariantTarget,
  getRollingInvariantProtectedIds,
} from '../../../lib/next-round-suggester/planner/rolling-invariants'
import type {
  RollingPlanPlayerTarget,
  RollingPlanTarget,
} from '../../../lib/next-round-suggester/planner/rolling-horizon'
import type { SuggestionAlternative } from '../../../lib/next-round-suggester/types'
import { createPlayers, createState } from '../helpers/factories'

function playerTarget(matches: number): RollingPlanPlayerTarget {
  return {
    matches,
    rests: 0,
    quality_debt: 0,
    partner_diversity: 0,
    opponent_diversity: 0,
    partner_repeat_exposure: 0,
    opponent_repeat_exposure: 0,
    max_consecutive_rest: 1,
    max_consecutive_play: 2,
  }
}

function alternative(ids: [string, string, string, string]): SuggestionAlternative {
  return {
    matches: [{
      court_idx: 0,
      team_a: [ids[0], ids[1]],
      team_b: [ids[2], ids[3]],
      score: 0,
      stats: {
        pvna_diff: 0,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
        consecutive_play_penalty: 0,
      },
    }],
    resting: [],
    score: 0,
    warnings: [],
    stats: {
      pvna_diff: 0,
      partner_repeats: 0,
      opponent_repeats: 0,
      group_bonus: 0,
      gender_pref_penalty: 0,
      consecutive_play_penalty: 0,
    },
  }
}

describe('rolling invariant contract', () => {
  it('uses the next unfinished checkpoint and expires after the final target', () => {
    const players = createPlayers(8)
    const state = createState({ players, courts: 1 })
    const firstPlayers = Object.fromEntries(players.map((player, index) => [
      player.player_id,
      playerTarget(index < 4 ? 1 : 0),
    ]))
    const finalPlayers = Object.fromEntries(players.map(player => [
      player.player_id,
      playerTarget(1),
    ]))
    const target: RollingPlanTarget = {
      target_matches_by_player: Object.fromEntries(players.map(player => [player.player_id, 1])),
      players: finalPlayers,
      checkpoints: [{
        progress_ratio: 0.5,
        completed_plan_rounds: 1,
        target_total_appearances: 4,
        players: firstPlayers,
      }],
    }

    expect(getActiveRollingInvariantTarget(state, target)?.target_total_appearances).toBe(4)
    players.slice(0, 4).forEach(player => {
      state.players.get(player.player_id)!.matches_played = 1
    })
    expect(getActiveRollingInvariantTarget(state, target)?.target_total_appearances).toBe(8)
    players.slice(4).forEach(player => {
      state.players.get(player.player_id)!.matches_played = 1
    })
    expect(getActiveRollingInvariantTarget(state, target)).toBeNull()
  })

  it('protects capped players and filters alternatives that exceed their quota', () => {
    const players = createPlayers(8)
    players.slice(0, 4).forEach(player => { player.matches_played = 1 })
    const state = createState({ players, courts: 1 })
    const targets = Object.fromEntries(players.map(player => [
      player.player_id,
      playerTarget(1),
    ]))
    const target: RollingPlanTarget = {
      target_matches_by_player: Object.fromEntries(players.map(player => [player.player_id, 1])),
      players: targets,
    }
    const capped = alternative(['p01', 'p02', 'p03', 'p04'])
    const available = alternative(['p05', 'p06', 'p07', 'p08'])

    expect(getRollingInvariantProtectedIds(state, target)).toEqual(
      new Set(['p01', 'p02', 'p03', 'p04']),
    )
    expect(filterRollingInvariantAlternatives({
      alternatives: [capped, available],
      state,
      planTarget: target,
    })).toEqual([available])
  })

  it('rejects a candidate that omits a hard rest-required player', () => {
    const state = createState({ players: createPlayers(8), courts: 1 })
    const missesRequired = alternative(['p01', 'p02', 'p03', 'p04'])
    const includesRequired = alternative(['p01', 'p02', 'p03', 'p08'])

    expect(filterRollingInvariantAlternatives({
      alternatives: [missesRequired, includesRequired],
      state,
      requiredPlayerIds: new Set(['p08']),
    })).toEqual([includesRequired])
  })
})
