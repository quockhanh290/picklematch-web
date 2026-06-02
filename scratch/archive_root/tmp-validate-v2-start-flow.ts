import { createRealSessionPlayers } from './tests/next-round-suggester/simulation/real-session-fixture'
import { createState } from './tests/next-round-suggester/helpers/factories'
import {
  applyFairnessAdjustment,
  correctForFairness,
} from './lib/next-round-suggester/fairness/corrector'
import { buildSwappedAlternative } from './lib/next-round-suggester/manual-swap'
import { suggestNextRound } from './lib/next-round-suggester/suggest'
import type { Match, SessionState, SuggestionAlternative } from './lib/next-round-suggester/types'

type StartPayload = {
  suggestion_idx?: number
  manual?: Match[]
  courts?: number
  pvna_tolerance?: number
}

type StartResult =
  | { ok: true; matches: Match[]; resting: string[]; decisionMode: string }
  | { ok: false; status: number; error: string }

function withSetup(state: SessionState, payload: StartPayload): SessionState {
  return {
    ...state,
    config: {
      ...state.config,
      courts: typeof payload.courts === 'number' ? payload.courts : state.config.courts,
      pvna_tolerance:
        typeof payload.pvna_tolerance === 'number'
          ? payload.pvna_tolerance
          : state.config.pvna_tolerance,
    },
  }
}

function runServerStart(baseState: SessionState, payload: StartPayload): StartResult {
  const state = withSetup(baseState, payload)

  if (state.rounds.some((round) => round.status === 'active')) {
    return { ok: false, status: 409, error: 'A round is already active' }
  }

  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  const manual = Array.isArray(payload.manual) ? payload.manual : null
  const suggestionIdx = typeof payload.suggestion_idx === 'number' ? payload.suggestion_idx : 0

  if (manual) {
    if (manual.length > state.config.courts) {
      return { ok: false, status: 400, error: 'Manual matches exceed court count' }
    }

    const playedIds = new Set(manual.flatMap((match) => [...match.team_a, ...match.team_b]))
    if (playedIds.size !== manual.length * 4) {
      return { ok: false, status: 400, error: 'A player can only be assigned once per round' }
    }

    const presentIds = new Set(
      [...state.players.values()]
        .filter((player) => player.checked_out_at === null)
        .map((player) => player.player_id),
    )

    if ([...playedIds].some((playerId) => !presentIds.has(playerId))) {
      return { ok: false, status: 400, error: 'Manual matches must use checked-in players' }
    }

    const resting = [...state.players.values()]
      .filter((player) => player.checked_out_at === null && !playedIds.has(player.player_id))
      .map((player) => player.player_id)
      .sort()

    const suggestion = suggestNextRound(adjustedState, {
      tier_overrides: adjustment.tier_overrides,
    })
    const alternative = suggestion.alternatives[suggestionIdx]
    return {
      ok: true,
      matches: manual,
      resting,
      decisionMode:
        alternative && matchesEqual(manual, alternative.matches)
          ? 'host_selected_alternative'
          : 'host_manual_matches',
    }
  }

  const suggestion = suggestNextRound(adjustedState, {
    tier_overrides: adjustment.tier_overrides,
  })
  const alternative = suggestion.alternatives[suggestionIdx]
  if (!alternative) {
    return { ok: false, status: 409, error: 'No suggestion available' }
  }

  return {
    ok: true,
    matches: alternative.matches,
    resting: alternative.resting,
    decisionMode: 'engine_suggestion',
  }
}

function localAlternative(
  baseState: SessionState,
  setup: Pick<StartPayload, 'courts' | 'pvna_tolerance'>,
  index: number,
): { state: SessionState; alternative: SuggestionAlternative } {
  const state = withSetup(baseState, setup)
  const adjustment = correctForFairness(state)
  const adjusted = applyFairnessAdjustment(state, adjustment)
  const suggestion = suggestNextRound(adjusted, { tier_overrides: adjustment.tier_overrides })
  const alternative = suggestion.alternatives[index] ?? suggestion.alternatives[0]
  if (!alternative) throw new Error('No local alternative')
  return { state: adjusted, alternative }
}

function matchesEqual(left: Match[], right: Match[]) {
  if (left.length !== right.length) return false
  const leftKeys = left.map(matchKey).sort()
  const rightKeys = right.map(matchKey).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}

function matchKey(match: Match) {
  return JSON.stringify({
    court_idx: match.court_idx,
    team_a: [...match.team_a].sort(),
    team_b: [...match.team_b].sort(),
  })
}

function assertCase(name: string, condition: unknown, detail?: string) {
  if (!condition) {
    throw new Error(`${name}: FAIL${detail ? ` - ${detail}` : ''}`)
  }
  console.log(`${name}: PASS${detail ? ` - ${detail}` : ''}`)
}

function firstPlaying(alternative: SuggestionAlternative) {
  return alternative.matches[0]?.team_a[0]
}

function main() {
  const basePlayers = createRealSessionPlayers({ includePending: true })
  const baseState = createState({
    players: basePlayers,
    courts: 5,
    pvnaTolerance: 0.5,
    currentRound: 1,
  })

  const normalLocal = localAlternative(baseState, { courts: 5, pvna_tolerance: 0.5 }, 0)
  const normalStart = runServerStart(baseState, {
    suggestion_idx: 0,
    courts: 5,
    pvna_tolerance: 0.5,
  })
  assertCase('case1 normal ALT has no manual and matches server recompute', normalStart.ok)
  assertCase(
    'case1 normal ALT equality',
    normalStart.ok && matchesEqual(normalStart.matches, normalLocal.alternative.matches),
    normalStart.ok ? `matches=${normalStart.matches.length}` : undefined,
  )

  const setupLocal = localAlternative(baseState, { courts: 6, pvna_tolerance: 0.8 }, 1)
  const setupStart = runServerStart(baseState, {
    suggestion_idx: 1,
    courts: 6,
    pvna_tolerance: 0.8,
  })
  assertCase('case2 setup override starts', setupStart.ok)
  assertCase(
    'case2 setup override equality',
    setupStart.ok && matchesEqual(setupStart.matches, setupLocal.alternative.matches),
    setupStart.ok ? `matches=${setupStart.matches.length}` : undefined,
  )
  assertCase(
    'case2 setup override respects courts',
    setupStart.ok && setupStart.matches.length <= 6,
  )

  const swapFrom = firstPlaying(normalLocal.alternative)
  const swapTo = normalLocal.alternative.resting[0]
  if (!swapFrom || !swapTo) throw new Error('No swap candidate in baseline fixture')
  const swapped = buildSwappedAlternative(normalLocal.alternative, normalLocal.state, swapFrom, swapTo)
  if (!swapped.alternative) throw new Error(swapped.error ?? 'Swap failed')
  const manualStart = runServerStart(baseState, {
    suggestion_idx: 0,
    manual: swapped.alternative.matches,
    courts: 5,
    pvna_tolerance: 0.5,
  })
  assertCase('case3 manual swap starts', manualStart.ok)
  assertCase(
    'case3 manual swap commits manual matches',
    manualStart.ok && matchesEqual(manualStart.matches, swapped.alternative.matches),
    manualStart.ok ? manualStart.decisionMode : undefined,
  )

  const stalePlayer = firstPlaying(normalLocal.alternative)
  if (!stalePlayer) throw new Error('No stale player candidate')
  const stalePlayers = basePlayers.map((player) =>
    player.player_id === stalePlayer
      ? { ...player, checked_out_at: new Date('2026-05-15T13:00:00.000Z') }
      : player,
  )
  const staleState = createState({
    players: stalePlayers,
    courts: 5,
    pvnaTolerance: 0.5,
    currentRound: 1,
  })
  const staleManual = runServerStart(staleState, {
    suggestion_idx: 0,
    manual: normalLocal.alternative.matches,
    courts: 5,
    pvna_tolerance: 0.5,
  })
  assertCase(
    'case4 stale manual checkout rejected',
    !staleManual.ok && staleManual.status === 400,
    !staleManual.ok ? staleManual.error : undefined,
  )

  const staleNormal = runServerStart(staleState, {
    suggestion_idx: 0,
    courts: 5,
    pvna_tolerance: 0.5,
  })
  assertCase('case4 stale normal recomputes', staleNormal.ok)
  assertCase(
    'case4 stale normal excludes checked-out player',
    staleNormal.ok &&
      !staleNormal.matches
        .flatMap((match) => [...match.team_a, ...match.team_b])
        .includes(stalePlayer),
    stalePlayer,
  )

  const activeState: SessionState = {
    ...baseState,
    rounds: [
      {
        session_id: baseState.session_id,
        round_no: baseState.current_round,
        status: 'active',
        matches: normalLocal.alternative.matches,
        resting: normalLocal.alternative.resting,
        started_at: new Date('2026-05-15T13:00:00.000Z'),
        ended_at: null,
      },
    ],
  }
  const activeStart = runServerStart(activeState, {
    suggestion_idx: 0,
    courts: 5,
    pvna_tolerance: 0.5,
  })
  assertCase(
    'case5 active round rejected',
    !activeStart.ok && activeStart.status === 409,
    !activeStart.ok ? activeStart.error : undefined,
  )
}

main()
