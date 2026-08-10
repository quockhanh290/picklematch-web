/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createServiceClient, getSessionId, handleCorsPreflight, jsonResponse, readJson, requireHost, writeSessionAuditEvent } from '../_shared/live-session.ts'
import { buildDegradedPreviewFieldsByCourtIdx, reattachDegradedPreviewFields } from '../_shared/preview-degraded-fields.ts'
import { correctForFairness } from '../../../lib/next-round-suggester/fairness/corrector.ts'
import { detectFairnessIssues } from '../../../lib/next-round-suggester/fairness/detector.ts'
import {
  buildFinalPreviewBoard,
  getPreviewMatchesToPersist,
  buildSuggestedMatchPayloads,
  computeMatchDegradedRescue,
  explainMatchOptimality,
  hasFulfilledPreviewBoardReplacements,
  improvesPreviewBoardPvna,
  needsEarlyFullBoardPvnaRescue,
  resolvePreviewPersistenceScope,
  shouldRunReplacementFullBoardRescue,
  LIVE_PREVIEW_ALGORITHM_VERSION,
} from '../../../lib/next-round-suggester/live-preview.ts'
import { mapRowsToSessionState } from '../../../lib/next-round-suggester/state.ts'
import { resolveQualityCostEnabledForSession } from '../../../lib/next-round-suggester/quality-cost-flag.ts'
import {
  plannedBoardEqualsLiveBoard,
  plannedMatchEqualsLiveMatch,
  plannedProgressMatches,
  resolvePlannedMatchAdvisory,
} from '../../../lib/next-round-suggester/planner/advisory.ts'
import {
  buildPlanningConfigIdentity,
  buildPlanningReplanIdentity,
  buildPlanningRosterIdentity,
  stablePlannerJson,
} from '../../../lib/next-round-suggester/planner/identity.ts'
import {
  buildPlanningFrontier,
} from '../../../lib/next-round-suggester/planner/frontier.ts'
import { getNextLiveRoundByCourt } from '../../../lib/next-round-suggester/live-rounds.ts'
import {
  selectConsumablePlannedRoundPool,
  selectConsumablePlannedRollingPool,
  shouldExpandPlanAdoption,
  type PlannedCourtConsumptionDecision,
} from '../../../lib/next-round-suggester/planner/consumption.ts'
import { validatePlannedBoard } from '../../../lib/next-round-suggester/planner/validation.ts'
import { buildRollingPlanTarget } from '../../../lib/next-round-suggester/planner/rolling-target.ts'
import type { RollingPlanTarget } from '../../../lib/next-round-suggester/planner/rolling-horizon.ts'
import {
  getActiveRollingInvariantTarget,
  getRollingInvariantProtectedIds,
} from '../../../lib/next-round-suggester/planner/rolling-invariants.ts'
import type {
  SessionState,
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
} from '../../../lib/next-round-suggester/types.ts'

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const REPLAY_SCHEMA_VERSION = 2
const EDGE_FUNCTION_NAME = 'session-live-matches-suggest'
const SLOW_SUGGEST_THRESHOLD_MS = 3_000
const PLAN_ADVISORY_ENGINE_VERSION = 'precomputed-v8-rolling-frontier'

function planRolloutEnabled(flag: string, sessionId: string) {
  if (Deno.env.get(flag) !== '1') return false
  const allowlist = (Deno.env.get('SESSION_PLAN_ROLLOUT_SESSION_IDS') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return allowlist.includes('*') || allowlist.includes(sessionId)
}

type SuggestTimingStage =
  | 'auth'
  | 'request_parse'
  | 'snapshot_load'
  | 'state_build'
  | 'fairness'
  | 'engine_search'
  | 'consistency_check'
  | 'persistence'
  | 'postprocess'

function roundedDuration(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

async function plannerIdentityHash(value: unknown) {
  const bytes = new TextEncoder().encode(stablePlannerJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

type PlanConsumptionContext = {
  enabled: boolean
  job_id: string | null
  plan_version_id: string | null
  planning_mutation_version: number | null
  accepted: Array<{
    court_idx: number
    live_round_no: number
    planned_round_no: number
    planned_match_idx: number
    team_a: [string, string]
    team_b: [string, string]
    resting: string[]
  }>
  decisions: PlannedCourtConsumptionDecision[]
  rolling_target: RollingPlanTarget | null
}

async function loadPlanConsumption(options: {
  supabase: { from: (table: string) => any }
  sessionId: string
  state: SessionState
  authoritativeLiveMatchRows: SessionLiveMatchRow[]
  courtCount: number
  targetCourtIdxs: number[]
  busyIds: ReadonlySet<string>
  replaceAllSuggestions: boolean
  rollingPolicyEnabled: boolean
  activeManualMutationKind?: string | null
}): Promise<PlanConsumptionContext> {
  const disabled: PlanConsumptionContext = {
    enabled: false,
    job_id: null,
    plan_version_id: null,
    planning_mutation_version: null,
    accepted: [],
    decisions: [],
    rolling_target: null,
  }
  if (!planRolloutEnabled('SESSION_PLAN_CONSUMPTION', options.sessionId) || options.targetCourtIdxs.length === 0) {
    return disabled
  }

  try {
    const [{ data: job, error: jobError }, { data: sessionVersion, error: sessionVersionError }] = await Promise.all([
      options.supabase
        .from('session_plan_jobs')
        .select('id, result_plan_version_id, roster_fingerprint, config_fingerprint, input_payload, planning_mutation_version')
        .eq('session_id', options.sessionId)
        .eq('status', 'completed')
        .eq('engine_version', PLAN_ADVISORY_ENGINE_VERSION)
        .not('result_plan_version_id', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      options.supabase
        .from('sessions')
        .select('planning_mutation_version')
        .eq('id', options.sessionId)
        .single(),
    ])
    if (jobError || sessionVersionError || !sessionVersion) return disabled

    const frontier = buildPlanningFrontier(options.state, options.authoritativeLiveMatchRows)
    const [rosterFingerprint, configFingerprint, frontierFingerprint] = await Promise.all([
      plannerIdentityHash(buildPlanningRosterIdentity(options.state)),
      plannerIdentityHash(buildPlanningConfigIdentity(options.state)),
      plannerIdentityHash(frontier.identity),
    ])
    const planningMutationVersion = Number(sessionVersion.planning_mutation_version ?? 0)
    const rosterIdentityMatches = job ? job.roster_fingerprint === rosterFingerprint : undefined
    const configIdentityMatches = job ? job.config_fingerprint === configFingerprint : undefined
    const planningVersionMatches = job
      ? Number(job.planning_mutation_version) === planningMutationVersion
      : undefined
    const frontierMatches = job
      ? job.input_payload?.planner?.frontier_fingerprint === frontierFingerprint
      : undefined

    const roundSourceRows = options.replaceAllSuggestions
      ? options.authoritativeLiveMatchRows.filter(match => match.status !== 'suggested')
      : options.authoritativeLiveMatchRows
    const liveRoundByCourt = getNextLiveRoundByCourt(
      roundSourceRows,
      options.courtCount,
      options.targetCourtIdxs,
    )
    const targetPlanRoundNos = [...new Set([...liveRoundByCourt.values()].map(roundNo => roundNo + 1))]
    const startingRound = Number(job?.input_payload?.planner?.starting_round)
    const baselineCommitments = Array.isArray(job?.input_payload?.fixed_commitments)
      ? job.input_payload.fixed_commitments
      : []
    const baselineCommitmentIds = new Set(baselineCommitments
      .map((commitment: any) => commitment?.id)
      .filter((id: unknown): id is string => typeof id === 'string'))
    const progressPlanRoundNos = Number.isFinite(startingRound)
      ? options.authoritativeLiveMatchRows
          .filter(match => (
            (match.status === 'live' || match.status === 'completed')
            && !baselineCommitmentIds.has(match.id)
            && Number(match.round_no) + 1 > startingRound
          ))
          .map(match => Number(match.round_no) + 1)
      : []
    const completedHistory = Number.isFinite(startingRound)
      ? options.state.rounds.filter(round =>
          round.status === 'completed'
          && round.round_no + 1 > startingRound
          && round.round_no + 1 <= options.state.current_round
        )
      : []
    const requestedPlanRoundNos = [...new Set([
      ...targetPlanRoundNos,
      ...completedHistory.map(round => round.round_no + 1),
      ...progressPlanRoundNos,
    ])]
    let roundRows: Array<{ round_no: number; matches: unknown; resting_ids: string[] }> = []
    if (job?.result_plan_version_id && requestedPlanRoundNos.length > 0) {
      const { data, error } = await options.supabase
        .from('session_plan_rounds')
        .select('round_no, matches, resting_ids')
        .eq('plan_version_id', job.result_plan_version_id)
        .order('round_no')
      if (error) return disabled
      roundRows = data ?? []
    }
    const plannedByRound = new Map(roundRows.map(row => [Number(row.round_no), {
      matches: Array.isArray(row.matches) ? row.matches : [],
      resting: Array.isArray(row.resting_ids) ? row.resting_ids.map(String) : [],
    }]))
    const baselinePlayers = Array.isArray(job?.input_payload?.state?.players)
      ? job.input_payload.state.players
      : []
    const rollingTarget: RollingPlanTarget | null = job?.result_plan_version_id
      ? buildRollingPlanTarget({
          planVersionId: job.result_plan_version_id,
          baselinePlayers,
          baselineRounds: Array.isArray(job.input_payload?.state?.rounds)
            ? job.input_payload.state.rounds
            : [],
          plannedRounds: [...plannedByRound].map(([roundNo, round]) => ({
            round_no: roundNo,
            matches: round.matches,
            resting: round.resting,
          })),
          pvnaByPlayer: new Map([...options.state.players].map(([id, player]) => [
            id,
            Number(player.effective_pvna ?? player.pvna),
          ])),
          pvnaTolerance: options.state.config.pvna_tolerance,
        })
      : null
    const historyMatches = job ? completedHistory.every(round => {
      const planned = plannedByRound.get(round.round_no + 1)?.matches
      return Array.isArray(planned) && plannedBoardEqualsLiveBoard(planned as any, round.matches)
    }) : undefined
    const progressMatches = job?.result_plan_version_id && Number.isFinite(startingRound)
      ? plannedProgressMatches({
          rows: options.authoritativeLiveMatchRows,
          baselineCommitments,
          startingRound,
          planVersionId: job.result_plan_version_id,
          plannedByRound: new Map([...plannedByRound].map(([roundNo, round]) => [
            roundNo,
            round.matches as Array<{ team_a: [string, string]; team_b: [string, string] }>,
          ])),
          allowRollingPlanRounds: options.rollingPolicyEnabled,
        })
      : undefined
    const effectiveFrontierMatches = frontierMatches === true || progressMatches === true
    const effectiveHistoryMatches = options.rollingPolicyEnabled
      ? progressMatches
      : historyMatches
    const targetCourtSet = new Set(options.targetCourtIdxs)
    const retainedSuggestedPlayerIds = new Set(options.authoritativeLiveMatchRows
      .filter(match => match.status === 'suggested' && !targetCourtSet.has(Number(match.court_idx)))
      .flatMap(match => [...match.team_a, ...match.team_b]))
    const consumedMatchIndexesByRound = new Map<number, Set<number>>()
    if (job?.result_plan_version_id) {
      for (const row of options.authoritativeLiveMatchRows) {
        if (row.status === 'cancelled') continue
        if (row.status === 'suggested' && targetCourtSet.has(Number(row.court_idx))) continue
        if (row.suggestion_metadata?.plan_version_id !== job.result_plan_version_id) continue
        const plannedRoundNo = Number(row.suggestion_metadata?.planned_round_no)
        if (!Number.isFinite(plannedRoundNo)) continue
        const matches = plannedByRound.get(plannedRoundNo)?.matches ?? []
        const used = consumedMatchIndexesByRound.get(plannedRoundNo) ?? new Set<number>()
        const matchIndex = matches.findIndex((match: any, index: number) => (
          !used.has(index) && plannedMatchEqualsLiveMatch(match, row)
        ))
        if (matchIndex < 0) continue
        used.add(matchIndex)
        consumedMatchIndexesByRound.set(plannedRoundNo, used)
      }
    }
    const activePlanRoundNo = options.rollingPolicyEnabled
      ? getActiveRollingInvariantTarget(options.state, rollingTarget)?.completed_plan_rounds ?? null
      : null
    const roundCandidates = options.targetCourtIdxs.map(courtIdx => {
      const liveRoundNo = liveRoundByCourt.get(courtIdx) ?? options.state.current_round
      const plannedRoundNo = activePlanRoundNo ?? liveRoundNo + 1
      const plannedRound = plannedByRound.get(plannedRoundNo)
      return {
        court_idx: courtIdx,
        live_round_no: liveRoundNo,
        planned_round_no: plannedRoundNo,
        matches: (plannedRound?.matches ?? []) as Array<{
          team_a: [string, string]
          team_b: [string, string]
        }>,
      }
    })
    const protectedIds = options.rollingPolicyEnabled
      ? getRollingInvariantProtectedIds(options.state, rollingTarget)
      : new Set<string>()
    const planBusyIds = new Set([...options.busyIds, ...protectedIds])
    const sharedSelectionOptions = {
      consumedMatchIndexesByRound,
      state: options.state,
      busyIds: planBusyIds,
      reservedIds: retainedSuggestedPlayerIds,
      rosterIdentityMatches,
      configIdentityMatches,
      historyMatches: effectiveHistoryMatches,
      planningVersionMatches,
      frontierMatches: job ? effectiveFrontierMatches : undefined,
      activeManualMutationKind: options.activeManualMutationKind,
    }
    const selected = options.rollingPolicyEnabled && activePlanRoundNo !== null
      ? selectConsumablePlannedRollingPool({
          ...sharedSelectionOptions,
          candidates: roundCandidates.map(candidate => ({
            court_idx: candidate.court_idx,
            live_round_no: candidate.live_round_no,
            preferred_planned_round_no: activePlanRoundNo,
            rounds: [...plannedByRound]
              .filter(([roundNo]) => roundNo >= activePlanRoundNo)
              .map(([roundNo, round]) => ({
                planned_round_no: roundNo,
                matches: round.matches as Array<{
                  team_a: [string, string]
                  team_b: [string, string]
                }>,
              })),
          })),
        })
      : selectConsumablePlannedRoundPool({
          ...sharedSelectionOptions,
          candidates: roundCandidates,
        })
    return {
      enabled: true,
      job_id: job?.id ?? null,
      plan_version_id: job?.result_plan_version_id ?? null,
      planning_mutation_version: planningMutationVersion,
      accepted: selected.accepted.flatMap(candidate => candidate.match ? [{
        court_idx: candidate.court_idx,
        live_round_no: candidate.live_round_no,
        planned_round_no: candidate.planned_round_no,
        planned_match_idx: candidate.planned_match_idx,
        team_a: candidate.match.team_a,
        team_b: candidate.match.team_b,
        resting: plannedByRound.get(candidate.planned_round_no)?.resting ?? [],
      }] : []),
      decisions: selected.decisions,
      rolling_target: rosterIdentityMatches === true
        && configIdentityMatches === true
        && planningVersionMatches === true
        && !options.activeManualMutationKind
        ? rollingTarget
        : null,
    }
  } catch (error) {
    console.warn('[suggest] plan consumption lookup failed; using live engine', {
      session_id: options.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return disabled
  }
}

async function writePlanAdvisoryShadow(options: {
  supabase: { from: (table: string) => any }
  sessionId: string
  actorId: string
  requestId: string
  clientRequestId: string | null
  state: SessionState
  liveStateVersion: number
  targetCourtIdxs: number[]
  finalPreviewBoard: Array<{
    court_idx?: number | null
    round_no?: number | null
    team_a?: string[]
    team_b?: string[]
  }>
  liveBusyIds: ReadonlySet<string>
  activeManualMutationKind?: string | null
  authoritativeLiveMatchRows: SessionLiveMatchRow[]
  authorization?: string | null
}) {
  try {
    const [
      { data: job, error: jobError },
      { data: sessionVersion, error: sessionVersionError },
    ] = await Promise.all([
      options.supabase
        .from('session_plan_jobs')
        .select('id, result_plan_version_id, roster_fingerprint, config_fingerprint, engine_version, input_payload, planning_mutation_version')
        .eq('session_id', options.sessionId)
        .eq('status', 'completed')
        .eq('engine_version', PLAN_ADVISORY_ENGINE_VERSION)
        .not('result_plan_version_id', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      options.supabase
        .from('sessions')
        .select('planning_mutation_version')
        .eq('id', options.sessionId)
        .single(),
    ])
    if (jobError) throw new Error(jobError.message)
    if (sessionVersionError) throw new Error(sessionVersionError.message)

    const advisoryFrontier = buildPlanningFrontier(options.state, options.authoritativeLiveMatchRows)
    const [rosterFingerprint, configFingerprint, frontierFingerprint] = await Promise.all([
      plannerIdentityHash(buildPlanningRosterIdentity(options.state)),
      plannerIdentityHash(buildPlanningConfigIdentity(options.state)),
      plannerIdentityHash(advisoryFrontier.identity),
    ])
    const rosterIdentityMatches = Boolean(job && job.roster_fingerprint === rosterFingerprint)
    const configIdentityMatches = Boolean(job && job.config_fingerprint === configFingerprint)
    const planningVersionMatches = Boolean(job
      && Number(job.planning_mutation_version) === Number(sessionVersion.planning_mutation_version))
    const frontierMatches = Boolean(job
      && job.input_payload?.planner?.frontier_fingerprint === frontierFingerprint)
    const liveByCourt = new Map(options.finalPreviewBoard
      .map(match => [Number(match.court_idx), match] as const)
      .filter(([courtIdx]) => Number.isFinite(courtIdx)))
    const requestedCourts = [...new Set([
      ...options.targetCourtIdxs,
      ...liveByCourt.keys(),
    ])].sort((left, right) => left - right)
    const targetRoundNos = requestedCourts.map(courtIdx => {
      const liveRoundNo = Number(liveByCourt.get(courtIdx)?.round_no)
      return Number.isFinite(liveRoundNo) ? liveRoundNo + 1 : options.state.current_round + 1
    })
    const startingRound = Number(job?.input_payload?.planner?.starting_round)
    const baselineCommitments = Array.isArray(job?.input_payload?.fixed_commitments)
      ? job.input_payload.fixed_commitments
      : []
    const baselineCommitmentIds = new Set(baselineCommitments
      .map((commitment: any) => commitment?.id)
      .filter((id: unknown): id is string => typeof id === 'string'))
    const progressPlanRoundNos = Number.isFinite(startingRound)
      ? options.authoritativeLiveMatchRows
          .filter(match => (
            (match.status === 'live' || match.status === 'completed')
            && !baselineCommitmentIds.has(match.id)
            && Number(match.round_no) + 1 > startingRound
          ))
          .map(match => Number(match.round_no) + 1)
      : []
    const completedHistory = Number.isFinite(startingRound)
      ? options.state.rounds.filter(round =>
          round.status === 'completed'
          && round.round_no + 1 > startingRound
          && round.round_no + 1 <= options.state.current_round
        )
      : []
    const roundNos = [...new Set([
      ...targetRoundNos,
      ...completedHistory.map(round => round.round_no + 1),
      ...progressPlanRoundNos,
    ])]

    let roundRows: Array<{ round_no: number; matches: unknown }> = []
    if (job?.result_plan_version_id && roundNos.length > 0) {
      const { data, error } = await options.supabase
        .from('session_plan_rounds')
        .select('round_no, matches')
        .eq('plan_version_id', job.result_plan_version_id)
        .in('round_no', roundNos)
      if (error) throw new Error(error.message)
      roundRows = data ?? []
    }
    const plannedByRound = new Map(roundRows.map(row => [Number(row.round_no), Array.isArray(row.matches) ? row.matches : []]))
    const historyMatches = completedHistory.every(round => {
      const planned = plannedByRound.get(round.round_no + 1)
      return Array.isArray(planned) && plannedBoardEqualsLiveBoard(planned as any, round.matches)
    })
    const progressMatches = job?.result_plan_version_id && Number.isFinite(startingRound)
      ? plannedProgressMatches({
          rows: options.authoritativeLiveMatchRows,
          baselineCommitments,
          startingRound,
          planVersionId: job.result_plan_version_id,
          plannedByRound: plannedByRound as Map<number, Array<{ team_a: [string, string]; team_b: [string, string] }>>,
        })
      : undefined
    const effectiveFrontierMatches = frontierMatches || progressMatches === true
    const targetCourtSet = new Set(requestedCourts)
    const lockedPlayerIds = new Set(options.finalPreviewBoard
      .filter(match => !targetCourtSet.has(Number(match.court_idx)))
      .flatMap(match => [...(match.team_a ?? []), ...(match.team_b ?? [])]))
    const decisions = requestedCourts.map(courtIdx => {
      const live = liveByCourt.get(courtIdx)
      const liveRoundNo = Number(live?.round_no)
      const plannedRoundNo = Number.isFinite(liveRoundNo) ? liveRoundNo + 1 : options.state.current_round + 1
      const plannedMatches = plannedByRound.get(plannedRoundNo) ?? []
      const planned = plannedMatches[courtIdx] && typeof plannedMatches[courtIdx] === 'object'
        ? plannedMatches[courtIdx] as { team_a: [string, string]; team_b: [string, string] }
        : null
      const advisory = resolvePlannedMatchAdvisory({
        plannedMatch: planned,
        state: options.state,
        busyIds: options.liveBusyIds,
        reservedIds: lockedPlayerIds,
        rosterIdentityMatches: job ? rosterIdentityMatches : undefined,
        configIdentityMatches: job ? configIdentityMatches : undefined,
        historyMatches: job ? historyMatches : undefined,
        planningVersionMatches: job ? planningVersionMatches : undefined,
        frontierMatches: job ? effectiveFrontierMatches : undefined,
        activeManualMutationKind: options.activeManualMutationKind,
      })
      return {
        court_idx: courtIdx,
        planned_round_no: plannedRoundNo,
        status: advisory.status,
        reasons: advisory.reasons,
        planned_match: planned,
        live_match: live ? { team_a: live.team_a ?? [], team_b: live.team_b ?? [] } : null,
        exact_match: plannedMatchEqualsLiveMatch(planned, live as any),
      }
    })

    await writeSessionAuditEvent(options.supabase, {
      sessionId: options.sessionId,
      eventType: 'session_plan_advisory_shadow',
      edgeFunction: EDGE_FUNCTION_NAME,
      requestId: options.requestId,
      clientRequestId: options.clientRequestId,
      actorId: options.actorId,
      requestPayload: {
        live_state_version: options.liveStateVersion,
        target_court_idxs: requestedCourts,
      },
      responsePayload: {
        plan_job_id: job?.id ?? null,
        plan_version_id: job?.result_plan_version_id ?? null,
        roster_identity_matches: job ? rosterIdentityMatches : null,
        config_identity_matches: job ? configIdentityMatches : null,
        history_matches: job ? historyMatches : null,
        planning_version_matches: job ? planningVersionMatches : null,
        frontier_matches: job ? frontierMatches : null,
        plan_progress_matches: job ? progressMatches ?? null : null,
        effective_frontier_matches: job ? effectiveFrontierMatches : null,
        counts: {
          usable: decisions.filter(decision => decision.status === 'usable').length,
          repair_required: decisions.filter(decision => decision.status === 'repair_required').length,
          fallback: decisions.filter(decision => decision.status === 'fallback').length,
          exact_match: decisions.filter(decision => decision.exact_match).length,
        },
      },
      detail: { decisions },
    })

    const shouldRequestReplan = !job
      || !rosterIdentityMatches
      || !configIdentityMatches
      || !historyMatches
      || !planningVersionMatches
      || !effectiveFrontierMatches
      || Boolean(options.activeManualMutationKind)
    if (shouldRequestReplan
      && options.authorization
      && planRolloutEnabled('SESSION_PLAN_AUTO_REPLAN', options.sessionId)) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
      if (supabaseUrl && anonKey) {
        const replanFingerprint = await plannerIdentityHash(buildPlanningReplanIdentity({
          roster_fingerprint: rosterFingerprint,
          config_fingerprint: configFingerprint,
          frontier_fingerprint: frontierFingerprint,
          planning_mutation_version: Number(sessionVersion.planning_mutation_version ?? 0),
          active_manual_mutation_kind: options.activeManualMutationKind,
        }))
        const response = await fetch(`${supabaseUrl}/functions/v1/session-plan-replan?session_id=${options.sessionId}`, {
          method: 'POST',
          headers: {
            Authorization: options.authorization,
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session_id: options.sessionId,
            frontier_fingerprint: replanFingerprint,
          }),
        })
        if (!response.ok && response.status !== 202) {
          console.warn('[suggest] session plan replan request failed', {
            session_id: options.sessionId,
            status: response.status,
          })
        }
      }
    }
  } catch (error) {
    console.warn('[suggest] session plan advisory shadow failed', {
      suggestion_request_id: options.requestId,
      session_id: options.sessionId,
      error: error instanceof Error ? error.message : String(error ?? 'Unknown advisory error'),
    })
  }
}

function classifySlowSuggest(timingMs: Record<SuggestTimingStage, number>) {
  const stages = Object.entries(timingMs) as [SuggestTimingStage, number][]
  const [slowStage, slowStageMs] = stages.reduce((slowest, current) =>
    current[1] > slowest[1] ? current : slowest
  )
  const slowReason = slowStage === 'engine_search'
    ? 'engine_search'
    : slowStage === 'snapshot_load' || slowStage === 'consistency_check' || slowStage === 'persistence'
      ? 'database_roundtrip'
      : slowStage === 'auth'
        ? 'auth_roundtrip'
        : 'edge_processing'
  return { slow_stage: slowStage, slow_stage_ms: slowStageMs, slow_reason: slowReason }
}

function getEngineBuildInfo() {
  return {
    function_name: EDGE_FUNCTION_NAME,
    replay_schema_version: REPLAY_SCHEMA_VERSION,
    build_label: 'live-suggest-session-audit-v2',
    algorithm_version: LIVE_PREVIEW_ALGORITHM_VERSION,
    git_sha: Deno.env.get('ENGINE_GIT_SHA')
      ?? Deno.env.get('GIT_COMMIT_SHA')
      ?? Deno.env.get('VERCEL_GIT_COMMIT_SHA')
      ?? null,
    deployment_id: Deno.env.get('DENO_DEPLOYMENT_ID') ?? null,
  }
}

function previewMatchId(match: any) {
  const courtIdx = Number(match?.court_idx ?? match?.sequence_no ?? 0)
  const teamA = Array.isArray(match?.team_a) ? match.team_a.map(String) : []
  const teamB = Array.isArray(match?.team_b) ? match.team_b.map(String) : []
  return `preview-${Number.isFinite(courtIdx) ? courtIdx : 0}-${teamA.join('-')}-${teamB.join('-')}`
}

function normalizeStartablePreviewMatch(match: any, {
  liveStateVersion,
  countableMatchCount,
  maxSequenceNo,
}: {
  liveStateVersion: number
  countableMatchCount: number
  maxSequenceNo: number
}) {
  const suggestionMetadata = match?.suggestion_metadata && typeof match.suggestion_metadata === 'object'
    ? match.suggestion_metadata
    : {}
  const teamA = Array.isArray(match?.team_a) ? match.team_a.map(String) : []
  const teamB = Array.isArray(match?.team_b) ? match.team_b.map(String) : []
  const courtIdx = Number(match?.court_idx ?? match?.sequence_no)
  if (teamA.length !== 2 || teamB.length !== 2 || !Number.isFinite(courtIdx)) return null
  return {
    ...suggestionMetadata,
    ...match,
    id: typeof match?.id === 'string' && match.id.length > 0 ? match.id : previewMatchId({ ...match, team_a: teamA, team_b: teamB, court_idx: courtIdx }),
    status: 'suggested',
    team_a: teamA,
    team_b: teamB,
    resting: Array.isArray(match?.resting) ? match.resting.map(String) : [],
    court_idx: courtIdx,
    sequence_no: Number.isFinite(Number(match?.sequence_no)) ? Number(match.sequence_no) : courtIdx,
    preview_source: match?.preview_source ?? 'edge_committed',
    preview_live_state_version: liveStateVersion,
    preview_countable_match_count: countableMatchCount,
    preview_max_sequence_no: maxSequenceNo,
    suggested_at: match?.suggested_at ?? new Date().toISOString(),
    started_at: null,
    ended_at: null,
  }
}

function isNonNullPreviewMatch<T>(match: T | null): match is T {
  return match !== null
}

Deno.serve(async (request) => {
  console.log('[suggest] engine-build AB-FIX3', new Date().toISOString())
  const corsResponse = handleCorsPreflight(request)
  if (corsResponse) return corsResponse

  const url = new URL(request.url)
  const sessionId = getSessionId(request)
  if (!sessionId) {
    return jsonResponse({ ok: false, error: 'Missing session id' }, 400)
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
  }
  const edgeRequestId = crypto.randomUUID()

  // Avoid pairs CRUD routes
  if (url.pathname.endsWith('/avoid-pairs')) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (request.method === 'POST') {
      const { player_a, player_b, reason } = await readJson(request) as Record<string, unknown>
      const [a, b] = [String(player_a), String(player_b)].sort()
      const { error } = await userClient
        .from('session_avoid_pairs')
        .upsert(
          { session_id: sessionId, player_a: a, player_b: b, reason: reason ?? null },
          { onConflict: 'session_id,player_a,player_b' },
        )
      if (error) return jsonResponse({ ok: false, error: error.message }, 500)
      await writeSessionAuditEvent(userClient, {
        sessionId,
        eventType: 'avoid_pair_upsert',
        edgeFunction: EDGE_FUNCTION_NAME,
        request,
        requestId: edgeRequestId,
        includeSnapshotAfter: true,
        requestPayload: {
          player_a: a,
          player_b: b,
          reason: reason ?? null,
        },
        responsePayload: { ok: true },
      })
      return jsonResponse({ ok: true }, 200)
    }

    if (request.method === 'DELETE') {
      const { player_a, player_b } = await readJson(request) as Record<string, unknown>
      const [a, b] = [String(player_a), String(player_b)].sort()
      const { error } = await userClient
        .from('session_avoid_pairs')
        .delete()
        .eq('session_id', sessionId)
        .eq('player_a', a)
        .eq('player_b', b)
      if (error) return jsonResponse({ ok: false, error: error.message }, 500)
      await writeSessionAuditEvent(userClient, {
        sessionId,
        eventType: 'avoid_pair_delete',
        edgeFunction: EDGE_FUNCTION_NAME,
        request,
        requestId: edgeRequestId,
        includeSnapshotAfter: true,
        requestPayload: {
          player_a: a,
          player_b: b,
        },
        responsePayload: { ok: true },
      })
      return jsonResponse({ ok: true }, 200)
    }

    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  // PVNA override route
  if (url.pathname.includes('/pvna-override')) {
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
    }
    const playerId = url.pathname.split('/').at(-2)
    if (!playerId) {
      return jsonResponse({ ok: false, error: 'Missing player_id' }, 400)
    }
    const { effective_pvna } = await readJson(request) as Record<string, unknown>
    if (effective_pvna !== null && effective_pvna !== undefined) {
      const numericPvna = Number(effective_pvna)
      if (!Number.isFinite(numericPvna) || numericPvna < 1.0 || numericPvna > 6.0) {
        return jsonResponse({ ok: false, error: 'effective_pvna must be between 1.0 and 6.0' }, 400)
      }
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await userClient
      .from('session_player_state')
      .update({ effective_pvna: effective_pvna ?? null })
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
    if (error) return jsonResponse({ ok: false, error: error.message }, 500)
    await writeSessionAuditEvent(userClient, {
      sessionId,
      eventType: 'roster_pvna_override',
      edgeFunction: EDGE_FUNCTION_NAME,
      request,
      requestId: edgeRequestId,
      includeSnapshotAfter: true,
      requestPayload: {
        player_id: playerId,
        effective_pvna: effective_pvna ?? null,
      },
      responsePayload: { ok: true },
    })
    return jsonResponse({ ok: true }, 200)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405)
  }

  const requestReceivedAt = new Date().toISOString()
  const requestStartedAt = performance.now()
  const suggestionRequestId = edgeRequestId
  const clientRequestId = request.headers.get('x-request-id')
    ?? request.headers.get('x-client-request-id')
    ?? null

  try {
    let stageStartedAt = performance.now()
    const auth = await requireHost(request, sessionId, 'session-live-matches-suggest')
    if (auth.error) return auth.error
    if (!auth.supabase) return jsonResponse({ ok: false, error: 'Unable to verify host access' }, 500)
    const timingMs = {} as Record<SuggestTimingStage, number>
    timingMs.auth = roundedDuration(stageStartedAt)

    stageStartedAt = performance.now()
    const body = await readJson(request)

    // Cold-start prewarm (fired when the host opens the next-round screen). Auth already ran
    // above; a light read warms the DB connection pool. No engine run, no writes — this just
    // boots the isolate + auth + DB so the host's FIRST real suggest of the session lands warm
    // instead of paying the ~1-2s cold-start tax (auth ~480ms + persistence ~320ms observed cold).
    if (body.warmup === true) {
      try {
        await auth.supabase.from('sessions').select('id').eq('id', sessionId).maybeSingle()
      } catch {
        // best-effort warm; a failed touch still leaves the isolate + auth warm
      }
      return jsonResponse({ ok: true, warmed: true })
    }

    if (!Array.isArray(body.player_rows)) {
      return jsonResponse({ ok: false, error: 'Missing player_rows' }, 400)
    }
    const requestLiveStateVersion = optionalNumber(body.live_state_version)
    if (requestLiveStateVersion === undefined) {
      return jsonResponse({ ok: false, error: 'Missing live_state_version' }, 400)
    }
    timingMs.request_parse = roundedDuration(stageStartedAt)
    const loadLiveStateVersion = async () => {
      const { data, error } = await auth.supabase
        .from('sessions')
        .select('live_state_version')
        .eq('id', sessionId)
        .single()
      if (error) throw new Error(`Could not verify live state version: ${error.message}`)
      return Number(data.live_state_version)
    }
    stageStartedAt = performance.now()
    const { data: authoritativeSnapshotData, error: authoritativeSnapshotError } = await auth.supabase.rpc(
      'get_live_session_snapshot_versioned',
      { p_session_id: sessionId },
    )
    if (authoritativeSnapshotError) {
      throw new Error(`Could not load authoritative live snapshot: ${authoritativeSnapshotError.message}`)
    }
    const authoritativeSnapshot = (authoritativeSnapshotData ?? {}) as {
      live_state_version?: unknown
      player_rows?: unknown[]
      pair_rows?: unknown[]
      round_rows?: unknown[]
      live_match_rows?: unknown[]
    }
    const versionBeforeSuggest = Number(authoritativeSnapshot.live_state_version)
    if (versionBeforeSuggest !== requestLiveStateVersion) {
      return jsonResponse({
        ok: false,
        error: 'PREVIEW_STATE_CHANGED',
        state_changed: true,
        request_live_state_version: requestLiveStateVersion,
        current_live_state_version: versionBeforeSuggest,
      }, 409)
    }
    timingMs.snapshot_load = roundedDuration(stageStartedAt)

    // 1. Reconstruct engine state from the authoritative DB snapshot.
    stageStartedAt = performance.now()
    const courtCount = optionalNumber(body.court_count) ?? 1
    const pvnaTolerance = optionalNumber(body.pvna_tolerance) ?? 0.5
    const plannedTotalRounds = optionalNumber(body.planned_total_rounds)
    const courtPreset = body.court_preset === 'balanced' || body.court_preset === 'play_more' || body.court_preset === 'relaxed'
      ? body.court_preset as 'balanced' | 'play_more' | 'relaxed'
      : undefined
    const currentCourts = optionalNumber(body.current_courts)
    const avoidPairs = Array.isArray(body.avoid_pairs) ? body.avoid_pairs : undefined
    const state = mapRowsToSessionState({
      sessionId,
      playerRows: (Array.isArray(authoritativeSnapshot.player_rows) ? authoritativeSnapshot.player_rows : []) as SessionPlayerStateRow[],
      pairRows: (Array.isArray(authoritativeSnapshot.pair_rows) ? authoritativeSnapshot.pair_rows : []) as SessionPairHistoryRow[],
      roundRows: (Array.isArray(authoritativeSnapshot.round_rows) ? authoritativeSnapshot.round_rows : []) as SessionRoundRow[],
      courts: courtCount,
      pvnaTolerance,
      extraConfig: {
        planned_total_rounds: plannedTotalRounds,
        court_preset: courtPreset,
        current_courts: currentCourts,
        avoid_pairs: avoidPairs,
      },
    })
    // Session-scoped quality-cost rollout: resolve once at the request boundary and carry it on config
    // so every engine gate (scoring + joint) reads the same per-session decision. Strict allowlist
    // (SESSION_QUALITY_COST_MODEL=1 AND SESSION_QUALITY_COST_SESSION_IDS lists the session or '*').
    state.config.quality_cost_enabled = resolveQualityCostEnabledForSession(sessionId)
    const completedRoundsCount = state.rounds.filter(round => round.status === 'completed').length
    timingMs.state_build = roundedDuration(stageStartedAt)
    if (plannedTotalRounds != null && completedRoundsCount >= plannedTotalRounds) {
      console.log('[suggest] target_rounds_reached', {
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        request_received_at: requestReceivedAt,
        planned_total_rounds: plannedTotalRounds,
        completed_rounds: completedRoundsCount,
      })
      return jsonResponse({
        ok: true,
        payloads: [],
        final_preview_board: [],
        warnings: ['TARGET_ROUNDS_REACHED'],
        should_end: true,
        live_state_version_used: requestLiveStateVersion,
        debug: {
          reason: 'TARGET_ROUNDS_REACHED',
          planned_total_rounds: plannedTotalRounds,
          completed_rounds: completedRoundsCount,
        },
      }, 200)
    }

    // 2. Compute fairness (pure functions, no DB)
    stageStartedAt = performance.now()
    const adjustment = correctForFairness(state)
    const warnings = detectFairnessIssues(state)
    timingMs.fairness = roundedDuration(stageStartedAt)

    // 3. Reconstruct request params
    const requestedCount = typeof body.count === 'number' ? body.count : 1
    const authoritativeLiveMatchRows = (Array.isArray(authoritativeSnapshot.live_match_rows)
      ? authoritativeSnapshot.live_match_rows
      : []) as SessionLiveMatchRow[]
    const liveStateVersion = requestLiveStateVersion
    const maxEdgePreviewCount = Math.min(courtCount, requestedCount)
    const preferAvailablePool = body.prefer_available_pool === true
    const count = Math.max(1, Math.min(requestedCount, maxEdgePreviewCount))
    const courtIdxs = Array.isArray(body.court_idxs)
      ? body.court_idxs
          .map((value: unknown) => optionalNumber(value))
          .filter((value: number | undefined): value is number => value !== undefined)
          .slice(0, count)
      : undefined
    const mode = body.mode === 'replace_courts' ? 'replace_courts' : 'full_board'
    const currentPreviewBoard = mode === 'full_board'
      ? []
      : Array.isArray(body.current_preview_board) ? body.current_preview_board : []
    const liveMatchRows = mode === 'full_board'
      ? authoritativeLiveMatchRows.filter(match => match.status !== 'suggested')
      : authoritativeLiveMatchRows
    const completingLiveMatchIds = new Set<string>(
      Array.isArray(body.completing_live_match_ids) ? body.completing_live_match_ids : []
    )
    console.log('[suggest] request_start', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      mode,
      requested_count: requestedCount,
      count,
      court_count: courtCount,
      live_state_version: liveStateVersion,
      prefer_available_pool: preferAvailablePool,
      completing_live_match_ids: [...completingLiveMatchIds],
    })

    const playersById = new Map<string, { name: string }>()
    if (Array.isArray(body.players)) {
      for (const p of body.players) {
        if (p && typeof p.id === 'string' && typeof p.name === 'string') {
          playersById.set(p.id, { name: p.name })
        }
      }
    }

    const liveBusyIds = new Set<string>(
      liveMatchRows
        .filter((match: any) => match.status === 'live' && !completingLiveMatchIds.has(match.id))
        .flatMap((match: any) => [...(match.team_a ?? []), ...(match.team_b ?? [])])
    )
    const occupiedCourtIdxs = new Set(
      liveMatchRows
        .filter((match: any) =>
          match?.status === 'live'
          && !completingLiveMatchIds.has(match.id)
          && match?.court_idx !== null
          && match?.court_idx !== undefined
        )
        .map((match: any) => Number(match.court_idx))
        .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    )
    const openCourtIdxs = Array.from({ length: courtCount }, (_, idx) => idx)
      .filter(idx => !occupiedCourtIdxs.has(idx))
    const explicitTargetCourtIdxs = (courtIdxs ?? [])
      .filter(idx => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    const partialFullBoardRequest = mode === 'full_board'
      && explicitTargetCourtIdxs.length === 0
      && count < openCourtIdxs.length
    let targetCourtIdxs = mode === 'replace_courts'
      ? explicitTargetCourtIdxs
      : partialFullBoardRequest
        ? []
        : openCourtIdxs
    const replaceAllSuggestions = mode === 'full_board' && explicitTargetCourtIdxs.length === 0
    const rollingPolicyEnabled = planRolloutEnabled('SESSION_PLAN_ROLLING_POLICY', sessionId)
    // rollingHorizon = the async "completed lane returns to the pool" model. It is
    // independent of plan-consumption: the noop-steering bug that got plan disabled
    // lives in rollingPlanTarget (kept gated on rollingPolicyEnabled below), NOT here.
    // Without this, a disabled plan also disables rolling → the engine falls back to
    // strict logical-round accounting and leaves lanes empty even with idle players.
    // Default ON for all sessions. Kill-switch: set secret SESSION_ROLLING_HORIZON=0.
    const rollingHorizonEnabled = Deno.env.get('SESSION_ROLLING_HORIZON') !== '0'
    // Default ON for all sessions. Kill-switch: set secret SESSION_BLOWOUT_RESCUE=0 to disable instantly.
    const blowoutRescueEnabled = Deno.env.get('SESSION_BLOWOUT_RESCUE') !== '0'
    const activeManualMutationKind = authoritativeLiveMatchRows
      .filter(match => (
        match.status === 'suggested' || match.status === 'live'
      ) && match.suggestion_metadata?.manual_override === true)
      .map(match => String(match.suggestion_metadata?.manual_mutation_kind ?? 'manual_lineup_changed'))
      .at(-1) ?? null

    // 4. Run suggestion algorithm
    const serviceClient = createServiceClient()
    let planConsumption = await loadPlanConsumption({
      supabase: serviceClient,
      sessionId,
      state,
      authoritativeLiveMatchRows,
      courtCount,
      targetCourtIdxs: preferAvailablePool ? [] : targetCourtIdxs,
      busyIds: liveBusyIds,
      replaceAllSuggestions,
      rollingPolicyEnabled,
      activeManualMutationKind,
    })
    if (shouldExpandPlanAdoption({
      planVersionId: planConsumption.plan_version_id,
      targetCourtIdxs,
      openCourtIdxs,
      rows: authoritativeLiveMatchRows,
    })) {
      targetCourtIdxs = [...openCourtIdxs]
      planConsumption = await loadPlanConsumption({
        supabase: serviceClient,
        sessionId,
        state,
        authoritativeLiveMatchRows,
        courtCount,
        targetCourtIdxs,
        busyIds: liveBusyIds,
        replaceAllSuggestions: true,
        rollingPolicyEnabled,
        activeManualMutationKind,
      })
    }
    const backgroundWrites: Promise<unknown>[] = []
    const verifyDumpEnabled = Deno.env.get('VERIFY_DUMP') === '1'
    const decisionSource = preferAvailablePool ? 'host_replacement' : 'engine_auto'
    const verifyDumps: import('../../../lib/next-round-suggester/live-preview.ts').IncompleteDump[] = []
    const instrumentEvents: { event: string; detail: string; court_count?: number; available?: number }[] = []
    const onIncompleteDump = verifyDumpEnabled
      ? (dump: import('../../../lib/next-round-suggester/live-preview.ts').IncompleteDump) => {
          verifyDumps.push(dump)
        }
      : undefined
    const onInstrumentEvent = (event: { event: string; detail: string; court_count?: number; available?: number }) => {
      instrumentEvents.push({ ...event })
      const instrumentationWrite = serviceClient.from('engine_instrumentation').insert({
        session_id: sessionId,
        event: event.event,
        detail: event.detail,
        court_count: event.court_count ?? courtCount,
        available: event.available ?? null,
      }).then(({ error }) => {
        if (error) {
          console.warn('[suggest] engine_instrumentation insert failed', {
            suggestion_request_id: suggestionRequestId,
            session_id: sessionId,
            error: error.message,
          })
        }
      })
      backgroundWrites.push(Promise.resolve(instrumentationWrite))
    }
    const selectionDebug: any[] = []
    stageStartedAt = performance.now()
    const runEngine = (
      engineCount: number,
      engineCourtIdxs: number[] | undefined,
      engineLiveMatchRows: SessionLiveMatchRow[],
    ) => engineCount > 0
      ? buildSuggestedMatchPayloads({
          count: engineCount,
          sessionId,
          courtCount,
          state,
          rows: { liveMatchRows: engineLiveMatchRows, liveStateVersion },
          completingLiveMatchIds,
          fairnessAdjustment: adjustment,
          fairnessWarnings: warnings,
          playersById,
          pvnaTolerance,
          options: {
            ...(engineCourtIdxs && engineCourtIdxs.length > 0 ? { courtIdxs: engineCourtIdxs } : {}),
            ignoreCapacityLock: !preferAvailablePool,
            blowoutRescue: blowoutRescueEnabled,
            rollingHorizon: rollingHorizonEnabled,
            rollingPlanTarget: rollingPolicyEnabled ? planConsumption.rolling_target : null,
            onIncompleteDump,
            onInstrumentEvent,
          },
          debugOut: selectionDebug,
        })
      : []
    // Every open lane first consumes an available lineup from the active
    // session-wide plan checkpoint. The live engine fills only unresolved lanes.
    let consumedPlanCourts = [...planConsumption.accepted]
    const consumedCourtSet = new Set(consumedPlanCourts.map(item => item.court_idx))
    const unresolvedCourtIdxs = targetCourtIdxs.filter(courtIdx => !consumedCourtSet.has(courtIdx))
    const maxExistingSequence = liveMatchRows.reduce(
      (max, match) => Math.max(max, Number(match.sequence_no ?? -1)),
      -1,
    )
    const plannedPayloads = consumedPlanCourts.map((planned, index) => {
      const pvna = (playerId: string) => {
        const player = state.players.get(playerId)
        return Number(player?.effective_pvna ?? player?.pvna ?? 0)
      }
      const teamGap = Math.abs(
        pvna(planned.team_a[0]) + pvna(planned.team_a[1])
        - pvna(planned.team_b[0]) - pvna(planned.team_b[1]),
      )
      const overBy = Math.max(0, teamGap - pvnaTolerance)
      return {
        court_idx: planned.court_idx,
        team_a: planned.team_a,
        team_b: planned.team_b,
        resting: planned.resting,
        round_no: planned.live_round_no,
        warnings: overBy > 0 ? ['PVNA_TOLERANCE_RELAXED'] : [],
        tradeoffs: overBy > 0 ? [{ type: 'pvna_tolerance_relaxed' as const, severity: overBy, over_by: overBy }] : [],
        approval_required: overBy > 0,
        configured_pvna_tolerance: pvnaTolerance,
        effective_pvna_tolerance: Math.max(pvnaTolerance, teamGap),
        fairness_reasons: [],
        fairness_reason_details: [],
        preview_source: 'session_plan',
        plan_job_id: planConsumption.job_id,
        plan_version_id: planConsumption.plan_version_id,
        planned_round_no: planned.planned_round_no,
        planned_match_idx: planned.planned_match_idx,
        sequence_no: maxExistingSequence + index + 1,
      }
    })
    const targetCourtSetForHybrid = new Set(targetCourtIdxs)
    const plannedLockRows: SessionLiveMatchRow[] = plannedPayloads.map((payload, index) => ({
      id: `session-plan-lock-${payload.court_idx}-${index}`,
      session_id: sessionId,
      sequence_no: Number(payload.sequence_no),
      round_no: Number(payload.round_no),
      cycle_no: Number(payload.round_no),
      court_idx: Number(payload.court_idx),
      status: 'suggested',
      team_a: payload.team_a,
      team_b: payload.team_b,
      resting: payload.resting,
      score_a: 0,
      score_b: 0,
      suggested_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      suggestion_metadata: { preview_source: 'session_plan' },
    }))
    const hybridEngineRows = consumedPlanCourts.length > 0
      ? [
          ...liveMatchRows.filter(match => !(
            match.status === 'suggested'
            && targetCourtSetForHybrid.has(Number(match.court_idx))
          )),
          ...plannedLockRows,
        ]
      : liveMatchRows
    const enginePayloads = consumedPlanCourts.length > 0
      ? runEngine(unresolvedCourtIdxs.length, unresolvedCourtIdxs, hybridEngineRows)
      : runEngine(count, courtIdxs, liveMatchRows)
    let payloads = consumedPlanCourts.length > 0
      ? [...plannedPayloads, ...enginePayloads]
      : enginePayloads
    let board = buildFinalPreviewBoard({
      mode,
      payloads,
      currentPreviewBoard,
      replacementCourtIdxs: courtIdxs,
      courtCount,
    })
    if (consumedPlanCourts.length > 0) {
      const mergedTargetMatches = board.final_preview_board
        .filter(match => targetCourtSetForHybrid.has(Number(match.court_idx)))
      const mergedFilledCourts = new Set(mergedTargetMatches.map(match => Number(match.court_idx)))
      const retainedPlayerIds = new Set(authoritativeLiveMatchRows
        .filter(match => match.status === 'suggested' && !targetCourtSetForHybrid.has(Number(match.court_idx)))
        .flatMap(match => [...match.team_a, ...match.team_b]))
      const mergedValidation = validatePlannedBoard({
        matches: mergedTargetMatches.map(match => ({ team_a: match.team_a, team_b: match.team_b })),
        players: state.players,
        busyIds: liveBusyIds,
        reservedIds: retainedPlayerIds,
      })
      const hybridComplete = targetCourtIdxs.every(courtIdx => mergedFilledCourts.has(courtIdx))
      if (!mergedValidation.valid || !hybridComplete) {
        consumedPlanCourts = []
        payloads = runEngine(count, courtIdxs, liveMatchRows)
        board = buildFinalPreviewBoard({
          mode,
          payloads,
          currentPreviewBoard,
          replacementCourtIdxs: courtIdxs,
          courtCount,
        })
      }
    }
    let qualityRescueUsed = false
    const replacementBoardIncomplete = mode === 'replace_courts'
      && !hasFulfilledPreviewBoardReplacements(board, courtIdxs)
    const needsQualityRescue = mode === 'replace_courts'
      && needsEarlyFullBoardPvnaRescue(payloads, state, pvnaTolerance)
    const clientAllowsReplacementFullBoardRescue = mode === 'replace_courts'
      && body.allow_full_board_rescue === true
    const runReplacementFullBoardRescue = shouldRunReplacementFullBoardRescue({
      mode,
      clientAllowsRescue: clientAllowsReplacementFullBoardRescue,
      replacementBoardIncomplete,
      needsQualityRescue,
    })
    if (
      consumedPlanCourts.length === 0
      && runReplacementFullBoardRescue
    ) {
      const liveRowsWithoutRetainedPreviews = liveMatchRows.filter((match: any) => match?.status !== 'suggested')
      const fullBoardCount = Math.min(courtCount, openCourtIdxs.length)
      const rescuedPayloads = buildSuggestedMatchPayloads({
        count: fullBoardCount,
        sessionId,
        courtCount,
        state,
        rows: { liveMatchRows: liveRowsWithoutRetainedPreviews, liveStateVersion },
        completingLiveMatchIds,
        fairnessAdjustment: adjustment,
        fairnessWarnings: warnings,
        playersById,
        pvnaTolerance,
        options: { onIncompleteDump, onInstrumentEvent },
      })
      const rescuedBoard = buildFinalPreviewBoard({
        mode: 'full_board',
        payloads: rescuedPayloads,
        currentPreviewBoard: [],
        courtCount,
      })
      const fillsMoreCourts = rescuedBoard.final_preview_board.length > board.final_preview_board.length
      const improvesQualityWithoutLosingCourts = rescuedBoard.final_preview_board.length >= board.final_preview_board.length
        && improvesPreviewBoardPvna(rescuedPayloads, payloads, state, pvnaTolerance)
      if (fillsMoreCourts || (!replacementBoardIncomplete && improvesQualityWithoutLosingCourts)) {
        payloads = rescuedPayloads
        board = rescuedBoard
        qualityRescueUsed = true
      }
    }
    timingMs.engine_search = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    const currentCountableMatchCount = liveMatchRows.filter((match: any) =>
      match?.status !== 'cancelled' && match?.status !== 'suggested'
    ).length
    const currentMaxSequenceNo = liveMatchRows.reduce((max: number, m: any) =>
      Math.max(max, typeof m?.sequence_no === 'number' ? m.sequence_no : -1), -1)
    let finalPreviewBoard = board.final_preview_board
      .map(payload => normalizeStartablePreviewMatch(payload, {
        liveStateVersion,
        countableMatchCount: currentCountableMatchCount,
        maxSequenceNo: currentMaxSequenceNo,
      }))
      .filter(isNonNullPreviewMatch)
    const suggestedBusyIds = new Set<string>(
      liveMatchRows
        .filter((m: any) => m.status === 'suggested')
        .flatMap((m: any) => [...(m.team_a ?? []), ...(m.team_b ?? [])])
    )
    const allOccupiedIds = new Set<string>([
      ...liveBusyIds,
      ...suggestedBusyIds,
    ])
    const freeCount = [...state.players.values()].filter(
      (p: any) => p.checked_out_at === null && !p.opted_rest && !allOccupiedIds.has(p.player_id)
    ).length
    const playerLimitedCourts = Math.max(0, count - payloads.length)
    const maxCourtsWithEveryone = Math.floor((freeCount + liveBusyIds.size) / 4)
    const tempLimitedCourts = Math.min(playerLimitedCourts, Math.max(0, maxCourtsWithEveryone - payloads.length))
    const realLimitedCourts = playerLimitedCourts - tempLimitedCourts
    const finalFilledCourtIdxs = new Set(
      finalPreviewBoard
        .map((payload: any) => Number(payload.court_idx))
        .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
    )
    const finalMissingOpenCourts = Array.from({ length: courtCount }, (_, idx) => idx)
      .filter(idx => !occupiedCourtIdxs.has(idx) && !finalFilledCourtIdxs.has(idx))
    const missingTargetCourts = targetCourtIdxs.filter(idx => !finalFilledCourtIdxs.has(idx))
    const filledTargetCount = targetCourtIdxs.length > 0
      ? targetCourtIdxs.filter(idx => finalFilledCourtIdxs.has(idx)).length
      : Math.min(count, finalPreviewBoard.length)
    const targetExpectedCount = targetCourtIdxs.length > 0
      ? targetCourtIdxs.length
      : count
    const targetCountShortfall = Math.max(0, targetExpectedCount - filledTargetCount)
    timingMs.postprocess = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    if (finalPreviewBoard.length === 0 && targetCourtIdxs.length === 0) {
      const versionAfterSuggest = await loadLiveStateVersion()
      if (versionAfterSuggest !== requestLiveStateVersion) {
        return jsonResponse({
          ok: false,
          error: 'PREVIEW_STATE_CHANGED',
          state_changed: true,
          request_live_state_version: requestLiveStateVersion,
          current_live_state_version: versionAfterSuggest,
        }, 409)
      }
    }
    timingMs.consistency_check = roundedDuration(stageStartedAt)
    stageStartedAt = performance.now()
    let persistedPreviewVersion = liveStateVersion
    let persistedPreviewNoop = false
    // A replace_courts request that produced no lineup (e.g. the engine deferred on an
    // extreme tight pool) must NOT run persistence: doing so would cancel the court's
    // existing valid suggestion and insert nothing, leaving it blank/stuck. Retain the
    // current suggestion instead. full_board close-court paths still persist as before.
    const replaceCourtsProducedNothing = mode === 'replace_courts' && finalPreviewBoard.length === 0
    if ((finalPreviewBoard.length > 0 || targetCourtIdxs.length > 0) && !replaceCourtsProducedNothing) {
      const requestedPersistenceCourtIdxs = targetCourtIdxs.length > 0
        ? targetCourtIdxs
        : finalPreviewBoard
            .map((payload: any) => Number(payload.court_idx))
            .filter((idx: number) => Number.isFinite(idx) && idx >= 0 && idx < courtCount)
      const persistenceScope = resolvePreviewPersistenceScope({
        mode,
        qualityRescueUsed,
        requestedCourtIdxs: requestedPersistenceCourtIdxs,
        openCourtIdxs,
        replaceAllSuggestions,
      })
      const replaceCourtIdxs = persistenceScope.replace_court_idxs
      const matchesToPersist = getPreviewMatchesToPersist({
        mode: persistenceScope.mode,
        finalPreviewBoard,
        replacementCourtIdxs: replaceCourtIdxs,
      })
      // The persistence RPC only INSERTs 8 columns and drops degraded_reason/rescue_court_idxs/
      // match_explanations. Snapshot them here (pre-persist, still on the engine payload) so they
      // can be re-attached onto the post-persist board read back from the RPC response below.
      const prePersistDegradedFieldsByCourtIdx = buildDegradedPreviewFieldsByCourtIdx(matchesToPersist)
      const persistencePayload = {
          p_session_id: sessionId,
          p_expected_live_state_version: requestLiveStateVersion,
          p_matches: matchesToPersist,
          p_replace_court_idxs: replaceCourtIdxs,
          p_replace_all: persistenceScope.replace_all,
          p_audit_payload: {
            source: EDGE_FUNCTION_NAME,
            suggestion_request_id: suggestionRequestId,
            client_request_id: clientRequestId,
            mode,
            persistence_mode: persistenceScope.mode,
            quality_rescue_used: qualityRescueUsed,
            requested_count: requestedCount,
            count,
            court_count: courtCount,
            target_court_idxs: targetCourtIdxs,
            missing_target_courts: missingTargetCourts,
            target_count_shortfall: targetCountShortfall,
            plan_consumption: consumedPlanCourts.length > 0 ? {
              plan_job_id: planConsumption.job_id,
              plan_version_id: planConsumption.plan_version_id,
              consumed_court_idxs: consumedPlanCourts.map(item => item.court_idx),
              decisions: planConsumption.decisions.map(decision => ({
                court_idx: decision.court_idx,
                status: decision.status,
                reasons: decision.reasons,
              })),
            } : null,
          },
        }
      const persistenceRpc = consumedPlanCourts.length > 0
        ? 'replace_planned_live_session_suggestions_versioned'
        : 'replace_live_session_suggestions_versioned'
      const { data: persistedPreviewData, error: persistedPreviewError } = await auth.supabase.rpc(
        persistenceRpc,
        consumedPlanCourts.length > 0
          ? {
              ...persistencePayload,
              p_expected_planning_mutation_version: planConsumption.planning_mutation_version,
            }
          : persistencePayload,
      )
      if (persistedPreviewError) {
        if (persistedPreviewError.message?.includes('Session changed')
          || persistedPreviewError.message?.includes('Session planning changed')) {
          return jsonResponse({
            ok: false,
            error: 'PREVIEW_STATE_CHANGED',
            state_changed: true,
            planning_state_changed: persistedPreviewError.message?.includes('Session planning changed'),
            request_live_state_version: requestLiveStateVersion,
          }, 409)
        }
        throw new Error(`Could not persist live match suggestions: ${persistedPreviewError.message}`)
      }
      persistedPreviewVersion = Number((persistedPreviewData as any)?.live_state_version ?? liveStateVersion)
      persistedPreviewNoop = (persistedPreviewData as any)?.persisted_preview_noop === true
      const persistedMatches = Array.isArray((persistedPreviewData as any)?.matches)
        ? (persistedPreviewData as any).matches
        : []
      const normalizedPersistedMatches = persistedMatches
        .map((payload: any) => normalizeStartablePreviewMatch(payload, {
          liveStateVersion: persistedPreviewVersion,
          countableMatchCount: currentCountableMatchCount,
          maxSequenceNo: currentMaxSequenceNo,
        }))
        .filter(isNonNullPreviewMatch)
      finalPreviewBoard = persistenceScope.mode === 'replace_courts'
        ? buildFinalPreviewBoard({
            mode: persistenceScope.mode,
            payloads: normalizedPersistedMatches,
            currentPreviewBoard,
            replacementCourtIdxs: replaceCourtIdxs,
            courtCount,
          }).final_preview_board
        : normalizedPersistedMatches
      finalPreviewBoard = reattachDegradedPreviewFields(finalPreviewBoard, prePersistDegradedFieldsByCourtIdx)
    }
    // Board-wide degraded pass: the fill loop only computes degraded_reason/rescue for the courts it
    // freshly seated, so RETAINED/committed suggestions (other lanes) lack them and their "Chờ Sân X"
    // panel never shows. Recompute for every suggested court that still has no degraded_reason, using
    // ONE shared rescue budget so the (expensive) rescue search stays bounded across the board.
    if (blowoutRescueEnabled) {
      const liveCourtPlayers = new Map<number, string[]>()
      for (const match of liveMatchRows) {
        if (match.status !== 'live' || completingLiveMatchIds.has(match.id)) continue
        const courtIdx = Number(match.court_idx)
        if (!occupiedCourtIdxs.has(courtIdx)) continue
        liveCourtPlayers.set(courtIdx, [...(match.team_a ?? []), ...(match.team_b ?? [])].map(String))
      }
      const checkedInIds = [...state.players.values()]
        .filter(p => p.checked_out_at === null && !p.opted_rest)
        .map(p => p.player_id)
      let boardRescueBudgetMs = 400
      // Recompute degraded_reason / rescue_court_idxs / match_explanations AUTHORITATIVELY for EVERY
      // suggested court against its CURRENT lineup — never trust the value carried on the row. A
      // retained lane's fields come from the client's current_preview_board (which can be stale: a
      // lineup that changed, or repeat counts that grew), so trusting them produced false flags,
      // missed flags, and explanations describing an earlier lineup. Overwrite (and CLEAR when the
      // lineup is no longer degraded) so the flag, rescue, and explanation always match what's shown.
      for (const payload of finalPreviewBoard as any[]) {
        if (payload.status !== 'suggested' || payload.court_idx == null) continue
        // court X's own players return to the pool when we re-fill it; only OTHER placed players are busy.
        const busyIds = new Set<string>(liveBusyIds)
        for (const other of finalPreviewBoard as any[]) {
          if (other === payload || other.status !== 'suggested') continue
          for (const id of [...(other.team_a ?? []), ...(other.team_b ?? [])]) busyIds.add(String(id))
        }
        const result = computeMatchDegradedRescue({
          teamA: payload.team_a,
          teamB: payload.team_b,
          courtIdx: Number(payload.court_idx),
          state,
          liveCourtIdxs: occupiedCourtIdxs,
          liveCourtPlayers,
          busyIds,
          pvnaTolerance,
          budgetMs: boardRescueBudgetMs,
          nowMsFn: () => performance.now(),
        })
        boardRescueBudgetMs -= result.elapsedMs
        payload.degraded_reason = result.degradedReason ?? undefined
        payload.rescue_court_idxs = result.degradedReason && result.rescueCourtIdxs.length > 0
          ? result.rescueCourtIdxs
          : undefined
        // Explanation must describe THIS lineup. Recompute (alternatives=[] -> basic but accurate) and
        // clear it when the recompute yields nothing, so a stale "vì sao" list can never linger.
        try {
          const lineupIds = [...payload.team_a, ...payload.team_b].map(String)
          const availableIds = checkedInIds.filter(id => !busyIds.has(id) || lineupIds.includes(id))
          const explanations = explainMatchOptimality({
            teamA: payload.team_a,
            teamB: payload.team_b,
            alternatives: [],
            availableIds,
            state,
            playersById,
            pvnaTolerance,
          })
          payload.match_explanations = explanations.length > 0 ? explanations : undefined
        } catch (_explainError) {
          payload.match_explanations = undefined
        }
      }
    }
    // Persist advisory hints onto committed suggested rows after the final board repair pass.
    // Send every suggested row, including clean rows, so the RPC can clear stale hint keys.
    try {
      const hintSyncFields = (finalPreviewBoard as any[])
        .filter(m => m.status === 'suggested' && m.court_idx != null)
        .map(m => ({
          court_idx: Number(m.court_idx),
          team_a: (m.team_a ?? []).map(String),
          team_b: (m.team_b ?? []).map(String),
          degraded_reason: m.degraded_reason ?? null,
          rescue_court_idxs: Array.isArray(m.rescue_court_idxs) ? m.rescue_court_idxs : null,
          match_explanations: Array.isArray(m.match_explanations) ? m.match_explanations : null,
          suggestion_metadata: m.forced_tradeoff
            ? {
                forced_tradeoff: m.forced_tradeoff,
                wait_rescue_options: Array.isArray(m.wait_rescue_options) ? m.wait_rescue_options : [],
              }
            : {},
        }))
      await auth.supabase.rpc('sync_live_suggestion_hints', {
        p_session_id: sessionId,
        p_fields: hintSyncFields,
      })
    } catch (_syncError) {
      // hint-only advisory sync; never block the response on it
    }
    timingMs.persistence = roundedDuration(stageStartedAt)

    const totalTimingMs = roundedDuration(requestStartedAt)
    const slowRequest = totalTimingMs >= SLOW_SUGGEST_THRESHOLD_MS
    const slowDiagnostic = slowRequest ? classifySlowSuggest(timingMs) : null
    const planConsumptionSummary = {
      enabled: planConsumption.enabled,
      rolling_policy_enabled: rollingPolicyEnabled,
      rolling_horizon_enabled: rollingHorizonEnabled,
      rolling_target_loaded: planConsumption.rolling_target !== null,
      plan_job_id: planConsumption.job_id,
      plan_version_id: planConsumption.plan_version_id,
      consumed_court_idxs: consumedPlanCourts.map(item => item.court_idx),
      counts: {
        usable: planConsumption.decisions.filter(decision => decision.status === 'usable').length,
        repair_required: planConsumption.decisions.filter(decision => decision.status === 'repair_required').length,
        fallback: planConsumption.decisions.filter(decision => decision.status === 'fallback').length,
        consumed: consumedPlanCourts.length,
      },
      decisions: planConsumption.decisions.map(decision => ({
        court_idx: decision.court_idx,
        planned_round_no: decision.planned_round_no,
        planned_match_idx: decision.planned_match_idx ?? null,
        status: decision.status,
        reasons: decision.reasons,
      })),
    }

    if (verifyDumpEnabled) {
      const latestDump = verifyDumps.at(-1)
      const finalChosenMatches = finalPreviewBoard.map((payload: any) => ({
        court_idx: payload.court_idx ?? -1,
        team_a: [...(payload.team_a ?? [])],
        team_b: [...(payload.team_b ?? [])],
        is_replacement: preferAvailablePool,
        warnings: payload.warnings ?? [],
        tradeoffs: payload.tradeoffs ?? [],
      }))
      const dumpAnomaly = missingTargetCourts.length > 0
        || targetCountShortfall > 0
        || realLimitedCourts > 0
        || replacementBoardIncomplete
      const fullDumpEnabled = Deno.env.get('VERIFY_DUMP_FULL') === '1' || dumpAnomaly
      const compactPlayers = [...state.players.values()].map((player: any) => ({
        id: player.player_id,
        pvna: player.pvna,
        gender: player.gender,
        partner_gender_pref: player.partner_gender_pref,
        opponent_gender_pref: player.opponent_gender_pref,
        matches_played: player.matches_played,
        last_played_round: player.last_played_round ?? 0,
        consecutive_rest: player.consecutive_rest,
        consecutive_play: player.consecutive_play,
        rounds_available: player.rounds_available,
        opted_rest: player.opted_rest,
        checked_out: player.checked_out_at !== null,
        checked_in_at: player.checked_in_at instanceof Date ? player.checked_in_at.toISOString() : player.checked_in_at,
        checked_out_at: player.checked_out_at instanceof Date ? player.checked_out_at.toISOString() : player.checked_out_at,
        group_id: player.group_id ?? null,
        partner_counts: Object.fromEntries(player.partner_counts ?? []),
        opponent_counts: Object.fromEntries(player.opponent_counts ?? []),
      }))
      const compactRounds = state.rounds.map(round => ({
        round_no: round.round_no,
        status: round.status,
        match_count: round.matches.length,
        resting_count: round.resting.length,
      }))
      const compactMatch = (match: any) => ({
        id: match?.id ?? null,
        status: match?.status ?? null,
        round_no: match?.round_no ?? null,
        cycle_no: match?.cycle_no ?? null,
        sequence_no: match?.sequence_no ?? null,
        court_idx: match?.court_idx ?? null,
        team_a: [...(match?.team_a ?? [])],
        team_b: [...(match?.team_b ?? [])],
        resting: [...(match?.resting ?? [])],
        warnings: match?.warnings ?? undefined,
        tradeoffs: match?.tradeoffs ?? undefined,
        preview_source: match?.preview_source ?? undefined,
        preview_live_state_version: match?.preview_live_state_version ?? undefined,
        preview_countable_match_count: match?.preview_countable_match_count ?? undefined,
        degraded_reason: match?.degraded_reason ?? undefined,
        rescue_court_idxs: match?.rescue_court_idxs ?? undefined,
      })
      const compactRoundRecords = state.rounds.map(round => ({
        id: round.id ?? null,
        session_id: round.session_id,
        round_no: round.round_no,
        status: round.status,
        started_at: round.started_at instanceof Date ? round.started_at.toISOString() : round.started_at,
        ended_at: round.ended_at instanceof Date ? round.ended_at.toISOString() : round.ended_at,
        resting: [...(round.resting ?? [])],
        matches: (round.matches ?? []).map((match: any) => ({
          team_a: [...(match.team_a ?? [])],
          team_b: [...(match.team_b ?? [])],
        })),
      }))
      const compactSelectionDebug = selectionDebug.map((court: any) => ({
        court_idx: court.court_idx,
        busy_count: court.busy_count,
        required_for_court: [...(court.required_for_court ?? [])],
        forced_debug: court.forced_debug ?? null,
        eligible_players: (court.eligible_players ?? []).map((player: any) => ({
          id: player.id,
          pvna: player.pvna,
          consecutive_rest: player.consecutive_rest,
          matches_played: player.matches_played,
          tier: player.tier,
        })),
        selected: (court.selected ?? []).map((player: any) => ({
          id: player.id,
          pvna: player.pvna,
          team: player.team,
        })),
      }))
      const baseReplayPayload = {
        replay_schema_version: REPLAY_SCHEMA_VERSION,
        dump_level: fullDumpEnabled ? 'full' : 'lite',
        full_dump_reason: fullDumpEnabled
          ? Deno.env.get('VERIFY_DUMP_FULL') === '1'
            ? 'env'
            : 'anomaly'
          : null,
        event_type: 'live_match_suggested',
        event_created_at: new Date().toISOString(),
        request_received_at: requestReceivedAt,
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        decision_source: decisionSource,
        edge_function: EDGE_FUNCTION_NAME,
        engine_build: getEngineBuildInfo(),
        request: {
          requested_count: requestedCount,
          count,
          mode,
          court_count: courtCount,
          court_idxs: courtIdxs ?? null,
          prefer_available_pool: preferAvailablePool,
          live_state_version: liveStateVersion,
          completing_live_match_ids: [...completingLiveMatchIds],
          current_preview_board: currentPreviewBoard,
          allow_full_board_rescue: runReplacementFullBoardRescue,
          pvna_tolerance: pvnaTolerance,
          planned_total_rounds: plannedTotalRounds ?? null,
          court_preset: courtPreset ?? null,
          current_courts: currentCourts ?? null,
          avoid_pairs: avoidPairs ?? [],
        },
        derived_state_summary: {
          session_status: state.status,
          current_round: state.current_round,
          config: state.config,
          players: state.players.size,
          active_players: [...state.players.values()].filter(p => p.checked_out_at === null).length,
          opted_rest_players: [...state.players.values()].filter(p => p.checked_out_at === null && p.opted_rest).length,
          checked_out_players: [...state.players.values()].filter(p => p.checked_out_at !== null).length,
          live_busy_players: liveBusyIds.size,
          suggested_busy_players: suggestedBusyIds.size,
          free_playable_players: freeCount,
          completed_rounds: state.rounds.filter(round => round.status === 'completed').length,
          active_rounds: state.rounds.filter(round => round.status === 'active').length,
        },
        fairness: {
          adjustment,
          warnings,
        },
        engine_decision: {
          input_count: count,
          output_payload_count: payloads.length,
          final_preview_board_count: finalPreviewBoard.length,
          replacement_board_incomplete: replacementBoardIncomplete,
          needs_quality_rescue: needsQualityRescue,
          quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
          player_limited_courts: playerLimitedCourts,
          temp_limited_courts: tempLimitedCourts,
          real_limited_courts: realLimitedCourts,
          max_courts_with_free_players: Math.floor(freeCount / 4),
          max_courts_with_free_plus_live_busy_players: maxCourtsWithEveryone,
          blowout_rescue_enabled: blowoutRescueEnabled,
          degraded_court_count: finalPreviewBoard.filter((m: { degraded_reason?: unknown }) => m.degraded_reason).length,
          auth_method: (auth as { authMethod?: string }).authMethod ?? null,
          jwt_alg: (auth as { jwtAlg?: string | null }).jwtAlg ?? null,
          get_claims_ms: (auth as { getClaimsMs?: number }).getClaimsMs ?? null,
          session_query_ms: (auth as { sessionQueryMs?: number }).sessionQueryMs ?? null,
          plan_consumption: planConsumptionSummary,
        },
        timing_ms: {
          ...timingMs,
          total: totalTimingMs,
        },
        slow_request: slowRequest,
        slow_diagnostic: slowDiagnostic
          ? {
              threshold_ms: SLOW_SUGGEST_THRESHOLD_MS,
              ...slowDiagnostic,
              engine_instrumentation_events: instrumentEvents,
              search_shape: {
                selection_count: selectionDebug.length,
                max_busy_count: Math.max(0, ...selectionDebug.map((court: any) => Number(court.busy_count) || 0)),
                min_eligible_count: selectionDebug.length > 0
                  ? Math.min(...selectionDebug.map((court: any) => Array.isArray(court.eligible_players) ? court.eligible_players.length : 0))
                  : 0,
                max_required_count: Math.max(0, ...selectionDebug.map((court: any) => Array.isArray(court.required_for_court) ? court.required_for_court.length : 0)),
                quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
              },
            }
          : null,
        player_snapshot_lite: compactPlayers,
        round_snapshot_lite: compactRounds,
        busy_player_ids: [...allOccupiedIds].sort(),
        live_match_summary: {
          total: liveMatchRows.length,
          live: liveMatchRows.filter((match: any) => match?.status === 'live').length,
          suggested: liveMatchRows.filter((match: any) => match?.status === 'suggested').length,
          completed: liveMatchRows.filter((match: any) => match?.status === 'completed').length,
          cancelled: liveMatchRows.filter((match: any) => match?.status === 'cancelled').length,
        },
        raw_payloads_before_final_board_count: payloads.length,
        final_preview_board_count: finalPreviewBoard.length,
        selection_debug_count: selectionDebug.length,
        current_preview_board_lite: currentPreviewBoard.map(compactMatch),
        live_match_rows_lite: liveMatchRows.map(compactMatch),
        final_preview_board_lite: finalPreviewBoard.map(compactMatch),
        raw_payloads_before_final_board_lite: payloads.map(compactMatch),
        selection_debug_lite: compactSelectionDebug,
        round_records_lite: compactRoundRecords,
        chosen_courts: finalChosenMatches.map(match => match.court_idx),
        replaced_court_idxs: board.replaced_court_idxs,
        locked_court_idxs: board.locked_court_idxs,
        quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
        persisted_preview: true,
        persisted_preview_noop: persistedPreviewNoop,
        persisted_preview_live_state_version: persistedPreviewVersion,
        occupied_live_court_idxs: [...occupiedCourtIdxs].sort((left, right) => left - right),
        open_court_idxs: openCourtIdxs,
        target_court_idxs: targetCourtIdxs,
        requested_court_idxs: explicitTargetCourtIdxs,
        filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
        missing_open_courts: finalMissingOpenCourts,
        missing_target_courts: missingTargetCourts,
        partial_full_board_request: partialFullBoardRequest,
        target_expected_count: targetExpectedCount,
        filled_target_count: filledTargetCount,
        target_count_shortfall: targetCountShortfall,
        missing_courts: finalMissingOpenCourts,
      }
      const replayPayload = fullDumpEnabled
        ? {
            ...(latestDump && typeof latestDump.payload === 'object' && latestDump.payload !== null ? latestDump.payload : {}),
            ...baseReplayPayload,
            raw_request_body: body,
            session_history_snapshot: {
              captured_at: requestReceivedAt,
              player_rows: body.player_rows ?? [],
              pair_rows: body.pair_rows ?? [],
              round_rows: body.round_rows ?? [],
              live_match_rows: liveMatchRows,
              current_preview_board: currentPreviewBoard,
              avoid_pairs: avoidPairs ?? [],
            },
            live_match_rows: liveMatchRows,
            selection_debug: selectionDebug,
            intermediate_dumps: verifyDumps,
            raw_payloads_before_final_board: payloads,
            final_preview_board: finalPreviewBoard,
          }
        : baseReplayPayload

      const debugDumpWrite = serviceClient.from('debug_dumps').insert({
        session_id: sessionId,
        missing_courts: finalMissingOpenCourts,
        payload: replayPayload,
        chosen_matches: finalChosenMatches,
        pvna_tolerance: pvnaTolerance,
        rounds: latestDump?.rounds ?? [],
        decision_source: decisionSource,
      }).then(({ error }) => {
        if (error) {
          console.warn('[suggest] debug_dumps insert failed', {
            suggestion_request_id: suggestionRequestId,
            session_id: sessionId,
            error: error.message,
          })
        }
      })
      backgroundWrites.push(Promise.resolve(debugDumpWrite))
    }

    console.log('[suggest] request_done', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      decision_source: decisionSource,
      mode,
      requested_count: requestedCount,
      count,
      court_count: courtCount,
      live_state_version: liveStateVersion,
      persisted_preview: true,
      persisted_preview_noop: persistedPreviewNoop,
      persisted_preview_live_state_version: persistedPreviewVersion,
      output_payload_count: payloads.length,
      final_preview_board_count: finalPreviewBoard.length,
      occupied_live_court_idxs: [...occupiedCourtIdxs].sort((left, right) => left - right),
      missing_open_courts: finalMissingOpenCourts,
      missing_target_courts: missingTargetCourts,
      partial_full_board_request: partialFullBoardRequest,
      target_count_shortfall: targetCountShortfall,
      quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
      player_limited_courts: playerLimitedCourts,
      temp_limited_courts: tempLimitedCourts,
      real_limited_courts: realLimitedCourts,
      timing_ms: { ...timingMs, total: totalTimingMs },
      slow_request: slowRequest,
      slow_diagnostic: slowDiagnostic,
      plan_consumption: planConsumptionSummary,
    })

    const auditWrite = writeSessionAuditEvent(serviceClient, {
      sessionId,
      eventType: 'live_match_suggest',
      edgeFunction: EDGE_FUNCTION_NAME,
      request,
      requestId: suggestionRequestId,
      clientRequestId,
      requestPayload: {
        requested_count: requestedCount,
        count,
        mode,
        court_count: courtCount,
        court_idxs: courtIdxs ?? null,
        prefer_available_pool: preferAvailablePool,
        live_state_version: liveStateVersion,
        completing_live_match_ids: [...completingLiveMatchIds],
        allow_full_board_rescue: runReplacementFullBoardRescue,
        pvna_tolerance: pvnaTolerance,
        planned_total_rounds: plannedTotalRounds ?? null,
        court_preset: courtPreset ?? null,
        current_courts: currentCourts ?? null,
        avoid_pairs: avoidPairs ?? [],
      },
      responsePayload: {
        payload_count: payloads.length,
        final_preview_board_count: finalPreviewBoard.length,
        replaced_court_idxs: board.replaced_court_idxs,
        locked_court_idxs: board.locked_court_idxs,
        open_court_idxs: openCourtIdxs,
        target_court_idxs: targetCourtIdxs,
        requested_court_idxs: explicitTargetCourtIdxs,
        filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
        missing_open_courts: finalMissingOpenCourts,
        missing_target_courts: missingTargetCourts,
        partial_full_board_request: partialFullBoardRequest,
        target_expected_count: targetExpectedCount,
        filled_target_count: filledTargetCount,
        target_count_shortfall: targetCountShortfall,
        quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
        player_limited_courts: playerLimitedCourts,
        temp_limited_courts: tempLimitedCourts,
        real_limited_courts: realLimitedCourts,
        persisted_preview: true,
        persisted_preview_noop: persistedPreviewNoop,
        persisted_preview_live_state_version: persistedPreviewVersion,
        timing_ms: { ...timingMs, total: totalTimingMs },
        slow_request: slowRequest,
        slow_diagnostic: slowDiagnostic,
        plan_consumption: planConsumptionSummary,
      },
      detail: {
        decision_source: decisionSource,
        selection_debug: selectionDebug,
      },
    }).catch((error) => {
      console.warn('[suggest] session audit insert failed after response', {
        suggestion_request_id: suggestionRequestId,
        client_request_id: clientRequestId,
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error ?? 'Unknown audit error'),
      })
    })
    const planAdvisoryWrite = Deno.env.get('SESSION_PLAN_ADVISORY_SHADOW') === '1'
      ? writePlanAdvisoryShadow({
          supabase: serviceClient,
          sessionId,
          actorId: auth.userId,
          requestId: suggestionRequestId,
          clientRequestId,
          state,
          liveStateVersion: persistedPreviewVersion,
          targetCourtIdxs: targetCourtIdxs.length > 0
            ? targetCourtIdxs
            : [...finalFilledCourtIdxs],
          finalPreviewBoard,
          liveBusyIds,
          activeManualMutationKind,
          authoritativeLiveMatchRows,
          authorization: request.headers.get('Authorization'),
        })
      : null
    const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      for (const backgroundWrite of backgroundWrites) {
        edgeRuntime.waitUntil(backgroundWrite)
      }
      edgeRuntime.waitUntil(auditWrite)
      if (planAdvisoryWrite) edgeRuntime.waitUntil(planAdvisoryWrite)
    } else {
      for (const backgroundWrite of backgroundWrites) {
        void backgroundWrite
      }
      void auditWrite
      if (planAdvisoryWrite) void planAdvisoryWrite
    }
    return jsonResponse({
      ok: true,
      payloads,
      final_preview_board: finalPreviewBoard,
      request_live_state_version_used: requestLiveStateVersion,
      live_state_version_used: persistedPreviewVersion,
      persisted_preview: true,
      persisted_preview_noop: persistedPreviewNoop,
      replaced_court_idxs: board.replaced_court_idxs,
      locked_court_idxs: board.locked_court_idxs,
      open_court_idxs: openCourtIdxs,
      target_court_idxs: targetCourtIdxs,
      requested_court_idxs: explicitTargetCourtIdxs,
      filled_court_idxs: [...finalFilledCourtIdxs].sort((left, right) => left - right),
      missing_open_courts: finalMissingOpenCourts,
      missing_target_courts: missingTargetCourts,
      partial_full_board_request: partialFullBoardRequest,
      target_expected_count: targetExpectedCount,
      filled_target_count: filledTargetCount,
      target_count_shortfall: targetCountShortfall,
      quality_rescue_used: qualityRescueUsed || board.quality_rescue_used,
      player_limited_courts: playerLimitedCourts,
      temp_limited_courts: tempLimitedCourts,
      real_limited_courts: realLimitedCourts,
      plan_consumption: planConsumptionSummary,
      debug: {
        authoritative_snapshot: true,
        playerCount: state.players.size,
        activePlayers: [...state.players.values()].filter(p => p.checked_out_at === null).map(p => p.player_id),
        count,
        courtCount,
        mode,
        replacementBoardIncomplete,
        selection_debug: selectionDebug,
      },
    })
  } catch (error) {
    console.error('[session-live-matches-suggest] error:', {
      suggestion_request_id: suggestionRequestId,
      client_request_id: clientRequestId,
      session_id: sessionId,
      request_received_at: requestReceivedAt,
      error,
    })
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    )
  }
})
