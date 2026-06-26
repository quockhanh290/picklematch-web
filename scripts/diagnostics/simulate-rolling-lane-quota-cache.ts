import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

import { calculateOptimalCourts, type CourtPreset } from '@/lib/court-calculator'
import { Tier } from '@/lib/next-round-suggester/classify'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { computeOpponentRepeatBurden, computePartnerRepeatBurden } from '@/lib/next-round-suggester/fairness/metrics'
import { buildProjectedStateAfterCompletedLiveRound, buildProjectedStateAfterLiveMatch } from '@/lib/next-round-suggester/live-preview'
import { getRecentRepeatCost } from '@/lib/next-round-suggester/score'
import { mapRowsToSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextMatch } from '@/lib/next-round-suggester/suggest'
import type {
  Match,
  PlayerSessionState,
  SessionLiveMatchRow,
  SessionPlayerPreferenceRow,
  SessionPlayerStateRow,
  SessionState,
  SuggestionAlternative,
} from '@/lib/next-round-suggester/types'

type Variant =
  | 'current_live'
  | 'rolling_quota_cached'
  | 'guarded_soft_quota_cached'
  | 'guarded_soft_quota_intra_tuned'
  | 'guarded_soft_quota_intra_capped'
  | 'guarded_soft_quota_conditional_deep'
  | 'profile_intra_first'
  | 'profile_early_intra_guard'
  | 'profile_pvna_first'
  | 'profile_recent_first'

const sessionId = process.argv[2]
if (!sessionId) throw new Error('Usage: tsx scratch/simulate-rolling-lane-quota-cache.ts <session-id> --rounds=8')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Missing Supabase env')

function argValue(name: string, fallback: string) {
  const prefix = `${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

const roundsToSimulate = Math.max(1, Number(argValue('--rounds', '8')))
const maxAlternatives = Math.max(1, Number(argValue('--max-alternatives', '40')))
const deepAlternatives = Math.max(maxAlternatives, Number(argValue('--deep-alternatives', '120')))
const courtPreset = argValue('--court-preset', 'balanced') as CourtPreset
const sessionDurationMin = Math.max(1, Number(argValue('--session-duration-min', '120')))
const matchDurationMin = Math.max(1, Number(argValue('--match-duration-min', '15')))
const pvnaTolerance = Number(argValue('--pvna-tolerance', '0.5'))
const courtCountArg = argValue('--courts', '')
const speedPattern = argValue('--speed-pattern', 'fast2')
const maxLaneLeadRounds = Math.max(0, Number(argValue('--max-lane-lead-rounds', '1')))
const summaryOnly = process.argv.includes('--summary-only')
const metricsOnly = process.argv.includes('--metrics-only')
const gridProfiles = process.argv.includes('--grid-profiles')

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(values: number[]) {
  return {
    avg: round(avg(values)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: round(Math.max(0, ...values)),
  }
}

function bucket(values: number[]) {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(([a], [b]) => a - b)
}

function cloneInitialState(baseState: SessionState): SessionState {
  return {
    ...baseState,
    players: new Map([...baseState.players.entries()].map(([id, player]) => [id, {
      ...player,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      partner_counts: new Map(),
      opponent_counts: new Map(),
      opted_rest: false,
    }])),
    rounds: [],
    current_round: 0,
  }
}

function teamPvna(team: [string, string], state: SessionState) {
  return (state.players.get(team[0])?.pvna ?? 0) + (state.players.get(team[1])?.pvna ?? 0)
}

function intraGap(match: Match, state: SessionState) {
  const gap = (team: [string, string]) => Math.abs(
    (state.players.get(team[0])?.pvna ?? 0) - (state.players.get(team[1])?.pvna ?? 0),
  )
  return Math.max(gap(match.team_a), gap(match.team_b))
}

function matchIds(match: Match) {
  return [...match.team_a, ...match.team_b]
}

function liveBusyIds(live: Array<{ match: Match; endAt: number }>, nowTime: number) {
  return new Set(live.filter(item => item.endAt > nowTime).flatMap(item => matchIds(item.match)))
}

function courtDurations(courts: number) {
  if (speedPattern === 'fast1') {
    return Array.from({ length: courts }, (_, court) => court === 0 ? 8 : 18)
  }
  if (speedPattern === 'fast2') {
    return Array.from({ length: courts }, (_, court) => court < 2 ? 8 : court === 2 ? 12 : 18)
  }
  if (speedPattern === 'staggered') {
    return Array.from({ length: courts }, (_, court) => 8 + court * 2)
  }
  return Array.from({ length: courts }, () => matchDurationMin)
}

function makeLiveRow(state: SessionState, match: Match, sequenceNo: number, roundNo: number, courtIdx: number): SessionLiveMatchRow {
  return {
    id: `sim-${sequenceNo}`,
    session_id: state.session_id,
    sequence_no: sequenceNo,
    round_no: roundNo,
    court_idx: courtIdx,
    status: 'completed',
    team_a: match.team_a,
    team_b: match.team_b,
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }
}

function getQuotaControls(state: SessionState, totalPlayers: number, nextMatchIndex: number, busyIds: Set<string>) {
  const activePlayers = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest && !busyIds.has(player.player_id))
  const slotsAfter = nextMatchIndex * 4
  const targetMinAfter = Math.floor(slotsAfter / Math.max(1, totalPlayers))
  const targetMaxAfter = Math.ceil(slotsAfter / Math.max(1, totalPlayers))
  const underTarget = activePlayers
    .filter(player => player.matches_played < targetMinAfter)
    .sort((a, b) =>
      a.matches_played - b.matches_played ||
      b.consecutive_rest - a.consecutive_rest ||
      a.last_played_round - b.last_played_round ||
      a.player_id.localeCompare(b.player_id),
    )
  const capped = activePlayers
    .filter(player => player.matches_played >= targetMaxAfter)
    .map(player => player.player_id)
  const availableAfterCap = activePlayers.filter(player => !capped.includes(player.player_id))
  const excludedIds = availableAfterCap.length >= 4 ? new Set(capped) : new Set<string>()
  const requiredIds = underTarget
    .filter(player => !excludedIds.has(player.player_id))
    .slice(0, 4)
    .map(player => player.player_id)

  return {
    targetMinAfter,
    targetMaxAfter,
    excludedIds,
    requiredIds,
  }
}

function projectedCountViolation(alternative: SuggestionAlternative, state: SessionState, targetMax: number, targetMin: number) {
  const selected = new Set(alternative.matches.flatMap(match => matchIds(match)))
  let over = 0
  let under = 0
  for (const player of state.players.values()) {
    if (player.checked_out_at !== null || player.opted_rest) continue
    const projected = player.matches_played + (selected.has(player.player_id) ? 1 : 0)
    over += Math.max(0, projected - targetMax)
    under += Math.max(0, targetMin - projected)
  }
  return { over, under, total: over * 100 + under }
}

function alternativeRecent(alternative: SuggestionAlternative, state: SessionState, roundNo: number) {
  return alternative.matches.reduce((sum, match) => sum + getRecentRepeatCost(match.team_a, match.team_b, state, roundNo).total, 0)
}

function chooseQuotaAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  return [...alternatives].sort((a, b) => {
    const quotaA = projectedCountViolation(a, state, targetMax, targetMin)
    const quotaB = projectedCountViolation(b, state, targetMax, targetMin)
    if (quotaA.total !== quotaB.total) return quotaA.total - quotaB.total
    const tradeoffA = a.tradeoffs?.length ?? 0
    const tradeoffB = b.tradeoffs?.length ?? 0
    if (tradeoffA !== tradeoffB) return tradeoffA - tradeoffB
    const recentA = alternativeRecent(a, state, roundNo)
    const recentB = alternativeRecent(b, state, roundNo)
    if (recentA !== recentB) return recentA - recentB
    const matchA = a.matches[0]
    const matchB = b.matches[0]
    const pvnaA = matchA ? Math.abs(teamPvna(matchA.team_a, state) - teamPvna(matchA.team_b, state)) : 999
    const pvnaB = matchB ? Math.abs(teamPvna(matchB.team_a, state) - teamPvna(matchB.team_b, state)) : 999
    if (pvnaA !== pvnaB) return pvnaA - pvnaB
    const intraA = matchA ? intraGap(matchA, state) : 999
    const intraB = matchB ? intraGap(matchB, state) : 999
    return intraA - intraB
  })[0] ?? null
}

function chooseGuardedSoftQuotaAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  const scored = alternatives
    .map((alternative) => {
      const quota = projectedCountViolation(alternative, state, targetMax, targetMin)
      const match = alternative.matches[0]
      const pvnaGap = match ? Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)) : 999
      const intra = match ? intraGap(match, state) : 999
      const recent = alternativeRecent(alternative, state, roundNo)
      const pvnaOver = Math.max(0, pvnaGap - state.config.pvna_tolerance)
      const intraOver = Math.max(0, intra - 0.75)
      const tradeoffs = alternative.tradeoffs?.length ?? 0
      return {
        alternative,
        pvnaGap,
        intra,
        recent,
        quota,
        score:
          pvnaOver * 90 +
          intraOver * 12 +
          Math.min(recent, 120) * 0.9 +
          quota.over * 35 +
          quota.under * 5 +
          tradeoffs * 20,
      }
    })

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= state.config.pvna_tolerance + 0.25 &&
    item.recent < 40,
  )
  const pool = cleanEnough.length > 0 ? cleanEnough : scored
  return [...pool].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.quota.total !== b.quota.total) return a.quota.total - b.quota.total
    if (a.recent !== b.recent) return a.recent - b.recent
    if (a.pvnaGap !== b.pvnaGap) return a.pvnaGap - b.pvnaGap
    return a.intra - b.intra
  })[0]?.alternative ?? null
}

function intraGuardPenalty(intra: number) {
  if (intra <= 0.75) return 0
  if (intra <= 1.1) return (intra - 0.75) * 8
  if (intra <= 1.5) return 3 + (intra - 1.1) * 25
  return 13 + (intra - 1.5) * 80
}

function chooseGuardedSoftQuotaIntraTunedAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  const scored = alternatives
    .map((alternative) => {
      const quota = projectedCountViolation(alternative, state, targetMax, targetMin)
      const match = alternative.matches[0]
      const pvnaGap = match ? Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)) : 999
      const intra = match ? intraGap(match, state) : 999
      const recent = alternativeRecent(alternative, state, roundNo)
      const pvnaOver = Math.max(0, pvnaGap - state.config.pvna_tolerance)
      const tradeoffs = alternative.tradeoffs?.length ?? 0
      return {
        alternative,
        pvnaGap,
        intra,
        recent,
        quota,
        score:
          pvnaOver * 95 +
          intraGuardPenalty(intra) +
          Math.min(recent, 120) * 1.05 +
          quota.over * 40 +
          quota.under * 6 +
          tradeoffs * 20,
      }
    })

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= state.config.pvna_tolerance + 0.25 &&
    item.recent < 40 &&
    item.intra <= 1.5,
  )
  const intraPreferred = cleanEnough.filter(item => item.intra <= 1.1)
  const pool = intraPreferred.length > 0
    ? intraPreferred
    : cleanEnough.length > 0
      ? cleanEnough
      : scored

  return [...pool].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.quota.total !== b.quota.total) return a.quota.total - b.quota.total
    if (a.recent !== b.recent) return a.recent - b.recent
    if (a.pvnaGap !== b.pvnaGap) return a.pvnaGap - b.pvnaGap
    return a.intra - b.intra
  })[0]?.alternative ?? null
}

function chooseGuardedSoftQuotaIntraCappedAlternative(
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  const scored = alternatives
    .map((alternative) => {
      const quota = projectedCountViolation(alternative, state, targetMax, targetMin)
      const match = alternative.matches[0]
      const pvnaGap = match ? Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)) : 999
      const intra = match ? intraGap(match, state) : 999
      const recent = alternativeRecent(alternative, state, roundNo)
      const pvnaOver = Math.max(0, pvnaGap - state.config.pvna_tolerance)
      const intraOver = Math.max(0, intra - 0.75)
      const tradeoffs = alternative.tradeoffs?.length ?? 0
      const highIntra = intra > 1.5
      const veryHighIntra = intra > 2
      return {
        alternative,
        pvnaGap,
        pvnaOver,
        intra,
        recent,
        quota,
        highIntra,
        veryHighIntra,
        score:
          pvnaOver * 100 +
          intraOver * 18 +
          Math.min(recent, 120) * 1 +
          quota.over * 40 +
          quota.under * 6 +
          tradeoffs * 20 +
          (highIntra ? 45 : 0) +
          (veryHighIntra ? 90 : 0),
      }
    })

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= state.config.pvna_tolerance + 0.25 &&
    item.recent < 40,
  )
  const basePool = cleanEnough.length > 0 ? cleanEnough : scored
  const noHighIntra = basePool.filter(item => item.intra <= 1.5)
  const noVeryHighIntra = basePool.filter(item => item.intra <= 2)
  const pool = noHighIntra.length > 0
    ? noHighIntra
    : noVeryHighIntra.length > 0
      ? noVeryHighIntra
      : basePool

  return [...pool].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.quota.total !== b.quota.total) return a.quota.total - b.quota.total
    if (a.recent !== b.recent) return a.recent - b.recent
    if (a.pvnaGap !== b.pvnaGap) return a.pvnaGap - b.pvnaGap
    return a.intra - b.intra
  })[0]?.alternative ?? null
}

function choosePriorityProfileAlternative(
  profile: Extract<Variant, 'profile_intra_first' | 'profile_early_intra_guard' | 'profile_pvna_first' | 'profile_recent_first'>,
  alternatives: SuggestionAlternative[],
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  const earlyRound = roundNo < 3
  const scored = alternatives.map((alternative) => {
    const quota = projectedCountViolation(alternative, state, targetMax, targetMin)
    const match = alternative.matches[0]
    const pvnaGap = match ? Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state)) : 999
    const intra = match ? intraGap(match, state) : 999
    const recent = alternativeRecent(alternative, state, roundNo)
    const pvnaOver = Math.max(0, pvnaGap - state.config.pvna_tolerance)
    const intraOver = Math.max(0, intra - 0.75)
    const earlyHardIntraPenalty = earlyRound && intra > 1 ? (intra - 1) * 160 : 0
    const earlyVeryHardIntraPenalty = earlyRound && intra > 1.5 ? 220 : 0
    const weights = {
      profile_intra_first: { pvna: 90, intra: 95, recent: 0.8, quotaOver: 45, quotaUnder: 7 },
      profile_early_intra_guard: { pvna: 95, intra: earlyRound ? 85 : 20, recent: 0.95, quotaOver: 45, quotaUnder: 7 },
      profile_pvna_first: { pvna: 150, intra: 18, recent: 0.9, quotaOver: 40, quotaUnder: 6 },
      profile_recent_first: { pvna: 90, intra: 18, recent: 1.8, quotaOver: 40, quotaUnder: 6 },
    }[profile]
    return {
      alternative,
      pvnaGap,
      intra,
      recent,
      quota,
      score:
        pvnaOver * weights.pvna +
        intraOver * weights.intra +
        Math.min(recent, 160) * weights.recent +
        quota.over * weights.quotaOver +
        quota.under * weights.quotaUnder +
        (alternative.tradeoffs?.length ?? 0) * 20 +
        (profile === 'profile_early_intra_guard' ? earlyHardIntraPenalty + earlyVeryHardIntraPenalty : 0),
    }
  })

  const cleanEnough = scored.filter(item =>
    item.pvnaGap <= state.config.pvna_tolerance + 0.25 &&
    item.recent < 40 &&
    (profile !== 'profile_early_intra_guard' || !earlyRound || item.intra <= 1.5),
  )
  const pool = cleanEnough.length > 0 ? cleanEnough : scored
  return [...pool].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.quota.total !== b.quota.total) return a.quota.total - b.quota.total
    if (a.recent !== b.recent) return a.recent - b.recent
    if (a.pvnaGap !== b.pvnaGap) return a.pvnaGap - b.pvnaGap
    return a.intra - b.intra
  })[0]?.alternative ?? null
}

function hasSuggestionPressure(
  alternative: SuggestionAlternative | null | undefined,
  state: SessionState,
  roundNo: number,
  targetMax: number,
  targetMin: number,
) {
  const match = alternative?.matches[0]
  if (!alternative || !match) return true
  const pvnaGap = Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state))
  const intra = intraGap(match, state)
  const recent = alternativeRecent(alternative, state, roundNo)
  const quota = projectedCountViolation(alternative, state, targetMax, targetMin)
  return (
    pvnaGap > state.config.pvna_tolerance ||
    intra > 1.5 ||
    recent > 20 ||
    quota.over > 0 ||
    quota.under > 0
  )
}

type CachedCard = {
  match: Match
  alternative: SuggestionAlternative
  roundNo: number
  targetMinAfter: number | null
  targetMaxAfter: number | null
}

function cardIsValid(card: CachedCard, busyIds: Set<string>) {
  return matchIds(card.match).every(playerId => !busyIds.has(playerId))
}

function suggestOne(
  variant: Variant,
  state: SessionState,
  busyIds: Set<string>,
  courtIdx: number,
  sequenceNo: number,
  courts: number,
) {
  const roundNo = Math.floor(sequenceNo / courts)
  const nextMatchIndex = sequenceNo + 1
  const adjustment = correctForFairness(state)
  const adjustedState = applyFairnessAdjustment(state, adjustment)
  let effectiveBusyIds = new Set(busyIds)
  let tierOverrides: Record<string, Tier> = adjustment.tier_overrides
  let targetMinAfter: number | null = null
  let targetMaxAfter: number | null = null

  if (variant === 'rolling_quota_cached') {
    const quota = getQuotaControls(adjustedState, state.players.size, nextMatchIndex, busyIds)
    targetMinAfter = quota.targetMinAfter
    targetMaxAfter = quota.targetMaxAfter
    effectiveBusyIds = new Set([...busyIds, ...quota.excludedIds])
    tierOverrides = {
      ...adjustment.tier_overrides,
      ...Object.fromEntries(quota.requiredIds.map(id => [id, Tier.MUST_PLAY])),
    }
  }

  const startedAt = performance.now()
  const result = suggestNextMatch(adjustedState, {
    busy_player_ids: effectiveBusyIds,
    court_idx: courtIdx,
    tier_overrides: tierOverrides,
    max_alternatives: maxAlternatives,
  })
  const elapsedMs = performance.now() - startedAt
  let extraElapsedMs = 0
  let alternative = result.alternatives[0]
  if (variant === 'rolling_quota_cached' && targetMinAfter !== null && targetMaxAfter !== null) {
    alternative = chooseQuotaAlternative(result.alternatives, adjustedState, roundNo, targetMaxAfter, targetMinAfter)
  } else if (
    variant === 'guarded_soft_quota_cached' ||
    variant === 'guarded_soft_quota_intra_tuned' ||
    variant === 'guarded_soft_quota_intra_capped' ||
    variant === 'guarded_soft_quota_conditional_deep' ||
    variant === 'profile_intra_first' ||
    variant === 'profile_early_intra_guard' ||
    variant === 'profile_pvna_first' ||
    variant === 'profile_recent_first'
  ) {
    const quota = getQuotaControls(adjustedState, state.players.size, nextMatchIndex, busyIds)
    targetMinAfter = quota.targetMinAfter
    targetMaxAfter = quota.targetMaxAfter
    alternative = variant === 'guarded_soft_quota_intra_tuned'
      ? chooseGuardedSoftQuotaIntraTunedAlternative(
        result.alternatives,
        adjustedState,
        roundNo,
        quota.targetMaxAfter,
        quota.targetMinAfter,
      )
      : variant === 'guarded_soft_quota_intra_capped'
        ? chooseGuardedSoftQuotaIntraCappedAlternative(
          result.alternatives,
          adjustedState,
          roundNo,
          quota.targetMaxAfter,
          quota.targetMinAfter,
        )
      : (
        variant === 'profile_intra_first' ||
        variant === 'profile_early_intra_guard' ||
        variant === 'profile_pvna_first' ||
        variant === 'profile_recent_first'
      )
        ? choosePriorityProfileAlternative(
          variant,
          result.alternatives,
          adjustedState,
          roundNo,
          quota.targetMaxAfter,
          quota.targetMinAfter,
        )
      : chooseGuardedSoftQuotaAlternative(
        result.alternatives,
        adjustedState,
        roundNo,
        quota.targetMaxAfter,
        quota.targetMinAfter,
      )

    if (
      variant === 'guarded_soft_quota_conditional_deep' &&
      maxAlternatives < deepAlternatives &&
      hasSuggestionPressure(alternative, adjustedState, roundNo, quota.targetMaxAfter, quota.targetMinAfter)
    ) {
      const deepStartedAt = performance.now()
      const deepResult = suggestNextMatch(adjustedState, {
        busy_player_ids: effectiveBusyIds,
        court_idx: courtIdx,
        tier_overrides: tierOverrides,
        max_alternatives: deepAlternatives,
      })
      const deepElapsedMs = performance.now() - deepStartedAt
      const deepAlternative = chooseGuardedSoftQuotaAlternative(
        deepResult.alternatives,
        adjustedState,
        roundNo,
        quota.targetMaxAfter,
        quota.targetMinAfter,
      )
      extraElapsedMs += deepElapsedMs
      if (deepAlternative) alternative = deepAlternative
    }
  }
  const match = alternative?.matches[0]
  if (!alternative || !match) {
    throw new Error(`${variant}: no suggestion at sequence ${sequenceNo}, court ${courtIdx}`)
  }

  return {
    card: { match, alternative, roundNo, targetMinAfter, targetMaxAfter } satisfies CachedCard,
    elapsedMs: elapsedMs + extraElapsedMs,
  }
}

function runVariant(variant: Variant, baseState: SessionState, rounds: number, courts: number) {
  let state = cloneInitialState(baseState)
  const durations = courtDurations(courts)
  const totalMatches = rounds * courts
  const courtAvailableAt = Array.from({ length: courts }, () => 0)
  const live: Array<{ match: Match; courtIdx: number; roundNo: number; endAt: number }> = []
  const playerIdsByRound = new Map<number, Set<string>>()
  const completedRoundRest = new Set<number>()
  const queue: CachedCard[] = []
  const rows: Array<{
    sequenceNo: number
    roundNo: number
    courtIdx: number
    at: number
    pvna: number
    intra: number
    recent: number
    targetMinAfter: number | null
    targetMaxAfter: number | null
    cacheHit: boolean
  }> = []
  const timings: number[] = []
  const cacheStats = { hit: 0, miss: 0, stale: 0, planned: 0 }
  const leadGuardStats = { waits: 0, waitTime: 0 }

  let sequenceNo = 0
  while (sequenceNo < totalMatches) {
    const nextAt = Math.min(...courtAvailableAt)
    const freeCourts = courtAvailableAt
      .map((time, courtIdx) => ({ time, courtIdx }))
      .filter(item => item.time === nextAt)
      .map(item => item.courtIdx)

    for (const courtIdx of freeCourts) {
      if (sequenceNo >= totalMatches) break
      const busyIds = liveBusyIds(live, nextAt)
      const nextRoundNo = Math.floor(sequenceNo / courts)
      const liveRoundNos = live
        .filter(item => item.endAt > nextAt)
        .map(item => item.roundNo)
      const minLiveRoundNo = liveRoundNos.length > 0 ? Math.min(...liveRoundNos) : nextRoundNo
      if (
        (
          variant === 'guarded_soft_quota_cached' ||
          variant === 'guarded_soft_quota_intra_tuned' ||
          variant === 'guarded_soft_quota_intra_capped' ||
          variant === 'guarded_soft_quota_conditional_deep' ||
          variant === 'profile_intra_first' ||
          variant === 'profile_early_intra_guard' ||
          variant === 'profile_pvna_first' ||
          variant === 'profile_recent_first'
        ) &&
        liveRoundNos.length > 0 &&
        nextRoundNo > minLiveRoundNo + maxLaneLeadRounds
      ) {
        const waitUntil = Math.min(...live.filter(item => item.endAt > nextAt).map(item => item.endAt))
        courtAvailableAt[courtIdx] = waitUntil
        leadGuardStats.waits += 1
        leadGuardStats.waitTime += waitUntil - nextAt
        continue
      }
      let card: CachedCard | null = null
      let cacheHit = false

      while (queue.length > 0 && !card) {
        const next = queue.shift()!
        if (cardIsValid(next, busyIds)) {
          card = next
          cacheHit = true
          cacheStats.hit += 1
        } else {
          cacheStats.stale += 1
        }
      }

      if (!card) {
        cacheStats.miss += 1
        const planCount = Math.max(1, freeCourts.length)
        const planned: CachedCard[] = []
        let planningState = state
        let planningBusy = new Set(busyIds)
        for (let i = 0; i < planCount && sequenceNo + i < totalMatches; i += 1) {
          const plannedCourtIdx = freeCourts[Math.min(i, freeCourts.length - 1)] ?? courtIdx
          const suggested = suggestOne(variant, planningState, planningBusy, plannedCourtIdx, sequenceNo + i, courts)
          timings.push(suggested.elapsedMs)
          planned.push(suggested.card)
          cacheStats.planned += 1
          matchIds(suggested.card.match).forEach(playerId => planningBusy.add(playerId))
          planningState = buildProjectedStateAfterLiveMatch(
            planningState,
            makeLiveRow(planningState, suggested.card.match, sequenceNo + i, suggested.card.roundNo, plannedCourtIdx),
            suggested.card.roundNo,
          )
        }
        card = planned.shift() ?? null
        queue.push(...planned)
      }

      if (!card) throw new Error(`${variant}: no card after planning at sequence ${sequenceNo}`)

      const match = { ...card.match, court_idx: courtIdx }
      const row = makeLiveRow(state, match, sequenceNo, card.roundNo, courtIdx)
      const roundPlayers = playerIdsByRound.get(card.roundNo) ?? new Set<string>()
      matchIds(match).forEach(playerId => roundPlayers.add(playerId))
      playerIdsByRound.set(card.roundNo, roundPlayers)

      rows.push({
        sequenceNo,
        roundNo: card.roundNo,
        courtIdx,
        at: nextAt,
        pvna: round(Math.abs(teamPvna(match.team_a, state) - teamPvna(match.team_b, state))),
        intra: round(intraGap(match, state)),
        recent: round(getRecentRepeatCost(match.team_a, match.team_b, state, card.roundNo).total),
        targetMinAfter: card.targetMinAfter,
        targetMaxAfter: card.targetMaxAfter,
        cacheHit,
      })

      state = buildProjectedStateAfterLiveMatch(state, row, card.roundNo)
      live.push({ match, courtIdx, roundNo: card.roundNo, endAt: nextAt + durations[courtIdx] })
      courtAvailableAt[courtIdx] = nextAt + durations[courtIdx]
      sequenceNo += 1

      if ((sequenceNo % courts) === 0 && !completedRoundRest.has(card.roundNo)) {
        state = buildProjectedStateAfterCompletedLiveRound(state, playerIdsByRound.get(card.roundNo) ?? new Set<string>())
        completedRoundRest.add(card.roundNo)
      }
    }
  }

  const activeCounts = [...state.players.values()]
    .filter(player => player.checked_out_at === null && !player.opted_rest)
    .map(player => player.matches_played)
  const pvna = rows.map(row => row.pvna)
  const intra = rows.map(row => row.intra)
  const recent = rows.map(row => row.recent)
  const partnerBurden = computePartnerRepeatBurden(state)
  const opponentBurden = computeOpponentRepeatBurden(state)
  const laneAhead = Math.max(...rows.map(row => row.roundNo)) - Math.min(...rows.filter(row => row.sequenceNo >= courts).map(row => row.roundNo))

  return {
    variant,
    speedPattern,
    durations,
    matches: rows.length,
    playerDistribution: {
      min: Math.min(...activeCounts),
      max: Math.max(...activeCounts),
      range: Math.max(...activeCounts) - Math.min(...activeCounts),
      avg: round(avg(activeCounts)),
      bucket: bucket(activeCounts),
    },
    quality: {
      pvna: summarize(pvna),
      pvnaOverCap: pvna.filter(value => value > baseState.config.pvna_tolerance).length,
      intra: summarize(intra),
      intraOverPreferred: intra.filter(value => value > 0.75).length,
      intraOverHard: intra.filter(value => value > 1).length,
      recent: summarize(recent),
      recentCostMatches: recent.filter(value => value > 0).length,
      maxRepeatedPartnersPerPlayer: partnerBurden.max_repeated_partners,
      maxRepeatedOpponentsPerPlayer: opponentBurden.max_repeated_opponents,
    },
    timing: {
      avgMs: round(avg(timings)),
      p95Ms: round(percentile(timings, 95)),
      maxMs: round(Math.max(0, ...timings)),
      suggestCalls: timings.length,
    },
    cache: cacheStats,
    leadGuard: {
      ...leadGuardStats,
      waitTime: round(leadGuardStats.waitTime),
    },
    laneSkew: {
      maxAssignedRound: Math.max(...rows.map(row => row.roundNo)),
      maxCourt0LeadOverSlowestAtEnd: laneAhead,
      first20: rows.slice(0, 20).map(row => ({
        seq: row.sequenceNo,
        t: row.at,
        court: row.courtIdx + 1,
        round: row.roundNo + 1,
        cacheHit: row.cacheHit,
      })),
    },
    worstPvna: [...rows].sort((a, b) => b.pvna - a.pvna).slice(0, 8),
    worstIntra: [...rows].sort((a, b) => b.intra - a.intra).slice(0, 8),
    intraOverHardRows: rows
      .filter(row => row.intra > 1)
      .sort((a, b) => a.sequenceNo - b.sequenceNo),
    worstRecent: [...rows].sort((a, b) => b.recent - a.recent).slice(0, 8),
  }
}

async function main() {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as any },
  })
  const signIn = await client.auth.signInWithPassword({
    email: process.env.HOST_EMAIL ?? 'host@test.com',
    password: process.env.HOST_PASSWORD ?? '123456',
  })
  if (signIn.error) throw signIn.error

  const [playersRes, preferenceRes] = await Promise.all([
    client
      .from('session_player_state')
      .select('session_id, player_id, group_id, checked_in_at, checked_out_at, matches_played, last_played_round, consecutive_rest, consecutive_play, opted_rest, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('checked_in_at', { ascending: true }),
    client
      .from('session_players')
      .select('player_id, created_at, metadata, players(pvna, current_elo, elo, gender, partner_gender_pref, opponent_gender_pref)')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  if (playersRes.error) throw playersRes.error
  if (preferenceRes.error) throw preferenceRes.error

  const stateRows = (playersRes.data ?? []) as SessionPlayerStateRow[]
  const preferenceRows = (preferenceRes.data ?? []) as SessionPlayerPreferenceRow[]
  const playerRows = (stateRows.length > 0
    ? stateRows
    : (preferenceRes.data ?? []).map((row: any) => ({
      session_id: sessionId,
      player_id: row.player_id,
      group_id: null,
      checked_in_at: row.created_at ?? new Date().toISOString(),
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
      players: row.players,
      session_players: {
        status: 'confirmed',
        check_in_status: 'present',
        metadata: row.metadata ?? null,
      },
    }))).map(row => ({
      ...row,
      checked_out_at: null,
      matches_played: 0,
      last_played_round: -1,
      consecutive_rest: 0,
      consecutive_play: 0,
      opted_rest: false,
    }))

  const courtCalculator = calculateOptimalCourts({
    n_players: playerRows.length,
    session_duration_min: sessionDurationMin,
    match_duration_min: matchDurationMin,
    preset: courtPreset,
  })
  const courts = Math.max(1, Number(courtCountArg || courtCalculator.recommended.courts))
  const baseState = mapRowsToSessionState({
    sessionId,
    playerRows,
    pairRows: [],
    roundRows: [],
    preferenceRows,
    courts,
    pvnaTolerance,
  })

  const current = runVariant('current_live', baseState, roundsToSimulate, courts)

  const pickGrid = (variant: ReturnType<typeof runVariant>) => ({
    range: variant.playerDistribution.range,
    minMax: `${variant.playerDistribution.min}-${variant.playerDistribution.max}`,
    pvnaP95: variant.quality.pvna.p95,
    pvnaOverCap: variant.quality.pvnaOverCap,
    intraP95: variant.quality.intra.p95,
    intraOverHard: variant.quality.intraOverHard,
    recentP95: variant.quality.recent.p95,
    recentMax: variant.quality.recent.max,
    maxPartnerRepeats: variant.quality.maxRepeatedPartnersPerPlayer,
    maxOpponentRepeats: variant.quality.maxRepeatedOpponentsPerPlayer,
    avgMs: variant.timing.avgMs,
    p95Ms: variant.timing.p95Ms,
  })

  if (gridProfiles) {
    const guarded = runVariant('guarded_soft_quota_cached', baseState, roundsToSimulate, courts)
    const profiles = {
      current: pickGrid(current),
      guarded_old: pickGrid(guarded),
      intra_first: pickGrid(runVariant('profile_intra_first', baseState, roundsToSimulate, courts)),
      early_intra_guard: pickGrid(runVariant('profile_early_intra_guard', baseState, roundsToSimulate, courts)),
      pvna_first: pickGrid(runVariant('profile_pvna_first', baseState, roundsToSimulate, courts)),
      recent_first: pickGrid(runVariant('profile_recent_first', baseState, roundsToSimulate, courts)),
    }
    console.log(JSON.stringify({
      sessionId,
      rounds: roundsToSimulate,
      courts,
      players: playerRows.length,
      profiles,
    }, null, 2))
    return
  }

  const rollingQuota = runVariant('rolling_quota_cached', baseState, roundsToSimulate, courts)
  const guardedSoftQuota = runVariant('guarded_soft_quota_cached', baseState, roundsToSimulate, courts)
  const guardedSoftQuotaIntraTuned = runVariant('guarded_soft_quota_intra_tuned', baseState, roundsToSimulate, courts)
  const guardedSoftQuotaIntraCapped = runVariant('guarded_soft_quota_intra_capped', baseState, roundsToSimulate, courts)
  const guardedSoftQuotaConditionalDeep = runVariant('guarded_soft_quota_conditional_deep', baseState, roundsToSimulate, courts)

  const report = {
    sessionId,
    rounds: roundsToSimulate,
    courts,
    players: playerRows.length,
    maxAlternatives,
    speedPattern,
    maxLaneLeadRounds,
    courtReasoning: courtCalculator.reasoning,
    current,
    rollingQuota,
    guardedSoftQuota,
    guardedSoftQuotaIntraTuned,
    guardedSoftQuotaIntraCapped,
    guardedSoftQuotaConditionalDeep,
    delta: {
      matchRange: rollingQuota.playerDistribution.range - current.playerDistribution.range,
      pvnaAvg: round(rollingQuota.quality.pvna.avg - current.quality.pvna.avg),
      pvnaP95: round(rollingQuota.quality.pvna.p95 - current.quality.pvna.p95),
      pvnaOverCap: rollingQuota.quality.pvnaOverCap - current.quality.pvnaOverCap,
      intraAvg: round(rollingQuota.quality.intra.avg - current.quality.intra.avg),
      intraP95: round(rollingQuota.quality.intra.p95 - current.quality.intra.p95),
      intraOverPreferred: rollingQuota.quality.intraOverPreferred - current.quality.intraOverPreferred,
      recentAvg: round(rollingQuota.quality.recent.avg - current.quality.recent.avg),
      recentP95: round(rollingQuota.quality.recent.p95 - current.quality.recent.p95),
    },
    guardedDelta: {
      matchRange: guardedSoftQuota.playerDistribution.range - current.playerDistribution.range,
      pvnaAvg: round(guardedSoftQuota.quality.pvna.avg - current.quality.pvna.avg),
      pvnaP95: round(guardedSoftQuota.quality.pvna.p95 - current.quality.pvna.p95),
      pvnaOverCap: guardedSoftQuota.quality.pvnaOverCap - current.quality.pvnaOverCap,
      intraAvg: round(guardedSoftQuota.quality.intra.avg - current.quality.intra.avg),
      intraP95: round(guardedSoftQuota.quality.intra.p95 - current.quality.intra.p95),
      intraOverPreferred: guardedSoftQuota.quality.intraOverPreferred - current.quality.intraOverPreferred,
      recentAvg: round(guardedSoftQuota.quality.recent.avg - current.quality.recent.avg),
      recentP95: round(guardedSoftQuota.quality.recent.p95 - current.quality.recent.p95),
      waits: guardedSoftQuota.leadGuard.waits,
      waitTime: guardedSoftQuota.leadGuard.waitTime,
    },
    intraTunedDelta: {
      matchRange: guardedSoftQuotaIntraTuned.playerDistribution.range - current.playerDistribution.range,
      pvnaAvg: round(guardedSoftQuotaIntraTuned.quality.pvna.avg - current.quality.pvna.avg),
      pvnaP95: round(guardedSoftQuotaIntraTuned.quality.pvna.p95 - current.quality.pvna.p95),
      pvnaOverCap: guardedSoftQuotaIntraTuned.quality.pvnaOverCap - current.quality.pvnaOverCap,
      intraAvg: round(guardedSoftQuotaIntraTuned.quality.intra.avg - current.quality.intra.avg),
      intraP95: round(guardedSoftQuotaIntraTuned.quality.intra.p95 - current.quality.intra.p95),
      intraOverPreferred: guardedSoftQuotaIntraTuned.quality.intraOverPreferred - current.quality.intraOverPreferred,
      recentAvg: round(guardedSoftQuotaIntraTuned.quality.recent.avg - current.quality.recent.avg),
      recentP95: round(guardedSoftQuotaIntraTuned.quality.recent.p95 - current.quality.recent.p95),
      waits: guardedSoftQuotaIntraTuned.leadGuard.waits,
      waitTime: guardedSoftQuotaIntraTuned.leadGuard.waitTime,
    },
    intraCappedDelta: {
      matchRange: guardedSoftQuotaIntraCapped.playerDistribution.range - current.playerDistribution.range,
      pvnaAvg: round(guardedSoftQuotaIntraCapped.quality.pvna.avg - current.quality.pvna.avg),
      pvnaP95: round(guardedSoftQuotaIntraCapped.quality.pvna.p95 - current.quality.pvna.p95),
      pvnaOverCap: guardedSoftQuotaIntraCapped.quality.pvnaOverCap - current.quality.pvnaOverCap,
      intraAvg: round(guardedSoftQuotaIntraCapped.quality.intra.avg - current.quality.intra.avg),
      intraP95: round(guardedSoftQuotaIntraCapped.quality.intra.p95 - current.quality.intra.p95),
      intraOverPreferred: guardedSoftQuotaIntraCapped.quality.intraOverPreferred - current.quality.intraOverPreferred,
      recentAvg: round(guardedSoftQuotaIntraCapped.quality.recent.avg - current.quality.recent.avg),
      recentP95: round(guardedSoftQuotaIntraCapped.quality.recent.p95 - current.quality.recent.p95),
      waits: guardedSoftQuotaIntraCapped.leadGuard.waits,
      waitTime: guardedSoftQuotaIntraCapped.leadGuard.waitTime,
    },
    conditionalDeepDelta: {
      matchRange: guardedSoftQuotaConditionalDeep.playerDistribution.range - current.playerDistribution.range,
      pvnaAvg: round(guardedSoftQuotaConditionalDeep.quality.pvna.avg - current.quality.pvna.avg),
      pvnaP95: round(guardedSoftQuotaConditionalDeep.quality.pvna.p95 - current.quality.pvna.p95),
      pvnaOverCap: guardedSoftQuotaConditionalDeep.quality.pvnaOverCap - current.quality.pvnaOverCap,
      intraAvg: round(guardedSoftQuotaConditionalDeep.quality.intra.avg - current.quality.intra.avg),
      intraP95: round(guardedSoftQuotaConditionalDeep.quality.intra.p95 - current.quality.intra.p95),
      intraOverPreferred: guardedSoftQuotaConditionalDeep.quality.intraOverPreferred - current.quality.intraOverPreferred,
      recentAvg: round(guardedSoftQuotaConditionalDeep.quality.recent.avg - current.quality.recent.avg),
      recentP95: round(guardedSoftQuotaConditionalDeep.quality.recent.p95 - current.quality.recent.p95),
      waits: guardedSoftQuotaConditionalDeep.leadGuard.waits,
      waitTime: guardedSoftQuotaConditionalDeep.leadGuard.waitTime,
    },
  }

  if (metricsOnly) {
    const pickMetrics = (variant: typeof current) => ({
      distribution: variant.playerDistribution,
      quality: variant.quality,
      timing: variant.timing,
      cache: variant.cache,
      leadGuard: variant.leadGuard,
      intraOverHardRows: variant.intraOverHardRows,
    })
    console.log(JSON.stringify({
      sessionId,
      rounds: roundsToSimulate,
      courts,
      players: playerRows.length,
      current: pickMetrics(current),
      guardedSoftQuota: pickMetrics(guardedSoftQuota),
      guardedSoftQuotaConditionalDeep: pickMetrics(guardedSoftQuotaConditionalDeep),
      guardedDelta: report.guardedDelta,
      conditionalDeepDelta: report.conditionalDeepDelta,
    }, null, 2))
    return
  }

  if (summaryOnly) {
    const pick = (variant: typeof current) => ({
      distribution: variant.playerDistribution,
      quality: variant.quality,
      timing: variant.timing,
      cache: variant.cache,
      leadGuard: variant.leadGuard,
      worstPvna: variant.worstPvna,
      worstIntra: variant.worstIntra,
      worstRecent: variant.worstRecent,
    })
    console.log(JSON.stringify({
      sessionId,
      rounds: roundsToSimulate,
      courts,
      players: playerRows.length,
      current: pick(current),
      guardedSoftQuota: pick(guardedSoftQuota),
      guardedSoftQuotaIntraTuned: pick(guardedSoftQuotaIntraTuned),
      guardedSoftQuotaIntraCapped: pick(guardedSoftQuotaIntraCapped),
      guardedSoftQuotaConditionalDeep: pick(guardedSoftQuotaConditionalDeep),
      guardedDelta: report.guardedDelta,
      intraTunedDelta: report.intraTunedDelta,
      intraCappedDelta: report.intraCappedDelta,
      conditionalDeepDelta: report.conditionalDeepDelta,
    }, null, 2))
    return
  }

  console.log(JSON.stringify(report, null, 2))
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
