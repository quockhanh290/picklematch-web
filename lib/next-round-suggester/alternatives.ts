import { computeGenderPrefSatisfaction, computeMatchCountMetrics, computeOpponentDiversity, computeOpponentRepeatBurden, computePartnerDiversity, computeSessionFairness } from './fairness/metrics'
import { computeRepeatPressure } from './fairness/pressure'
import { previewStateAfterAlternative } from './history'
import { suggestNextRound } from './suggest'
import type { SessionState, SuggestionAlternative } from './types'

export type AlternativeAudit = {
  index: number
  fairness_total: number
  match_range: number
  partner_repeat_pairs: number
  opponent_repeat_pairs: number
  max_partner_pair: number
  max_opponent_pair: number
  max_opponent_burden: number
  gender_rate: number
  pvna_diff: number
}

export type SuggestedRoundAction =
  | {
      type: 'select_alternative'
      label: string
      detail: string
      alternative_index: number
      before: AlternativeAudit
      after: AlternativeAudit
    }
  | {
      type: 'set_pvna_tolerance'
      label: string
      detail: string
      pvna_tolerance: number
      before: AlternativeAudit
      after?: AlternativeAudit
    }
  | {
      type: 'set_courts'
      label: string
      detail: string
      courts: number
      before: AlternativeAudit
      after?: AlternativeAudit
    }
  | {
      type: 'accept_tradeoff'
      label: string
      detail: string
      before: AlternativeAudit
    }

export function auditAlternative(
  state: SessionState,
  alternative: SuggestionAlternative,
  index: number,
): AlternativeAudit {
  const projected = previewStateAfterAlternative(state, alternative)
  const fairness = computeSessionFairness(projected)
  const match = computeMatchCountMetrics(projected)
  const partner = computePartnerDiversity(projected)
  const opponent = computeOpponentDiversity(projected)
  const burden = computeOpponentRepeatBurden(projected)
  const gender = computeGenderPrefSatisfaction(projected)

  return {
    index,
    fairness_total: fairness.total,
    match_range: match.range,
    partner_repeat_pairs: partner.repeat_pairs.length,
    opponent_repeat_pairs: opponent.repeat_pairs.length,
    max_partner_pair: Math.max(0, ...partner.repeat_pairs.map(pair => pair.count)),
    max_opponent_pair: Math.max(0, ...opponent.repeat_pairs.map(pair => pair.count)),
    max_opponent_burden: burden.max_repeated_opponents,
    gender_rate: gender.total_pref_opportunities === 0 ? 1 : gender.satisfaction_rate,
    pvna_diff: alternative.stats.pvna_diff,
  }
}

export type SuggestedRoundActionsCache = {
  audits: AlternativeAudit[]
  pressure: ReturnType<typeof computeRepeatPressure>
  setupPreviews: { pvnaTolerance08: AlternativeAudit | null; courtsMinus1: AlternativeAudit | null }
}

export function buildSuggestedRoundActionsCache(
  state: SessionState,
  alternatives: SuggestionAlternative[],
  courtCount: number,
): SuggestedRoundActionsCache {
  return {
    audits: alternatives.map((alt, i) => auditAlternative(state, alt, i)),
    pressure: computeRepeatPressure(state),
    setupPreviews: {
      pvnaTolerance08: previewSetupChange({ state, pvnaTolerance: 0.8 }),
      courtsMinus1: courtCount > 1 ? previewSetupChange({ state, courtCount: courtCount - 1 }) : null,
    },
  }
}

export function buildSuggestedRoundActions(input: {
  state: SessionState
  alternatives: SuggestionAlternative[]
  cache: SuggestedRoundActionsCache
  selectedIndex: number
  pvnaTolerance: number
  courtCount: number
}): SuggestedRoundAction[] {
  const selected = input.alternatives[input.selectedIndex] ?? input.alternatives[0]
  if (!selected) return []

  const { audits, pressure, setupPreviews } = input.cache
  const current = audits[input.selectedIndex] ?? audits[0]
  const best = audits[0]
  const actions: SuggestedRoundAction[] = []
  const repeatRisk =
    pressure.repeat_risk === 'high' ||
    pressure.repeat_risk === 'extreme' ||
    current.max_opponent_burden >= 3 ||
    current.max_opponent_pair > 2 ||
    current.max_partner_pair > 2 ||
    current.opponent_repeat_pairs >= 8 ||
    current.partner_repeat_pairs >= 6
  const rangeRisk = current.match_range > 1

  // Globally best: sort toàn bộ audits, lấy top 1.
  // Không so sánh relative với current để tránh cycle (A→B→C→A).
  const globalBest = [...audits].sort(compareAudit)[0]
  const better =
    globalBest &&
    globalBest.index !== current.index &&
    isMeaningfullyBetterAlternative(current, globalBest)
      ? globalBest
      : undefined

  if (better) {
    actions.push({
      type: 'select_alternative',
      label: `Chọn phương án ${better.index + 1}`,
      detail: describeAlternativeDelta(current, better),
      alternative_index: better.index,
      before: current,
      after: better,
    })
  }

  if ((repeatRisk || rangeRisk) && input.pvnaTolerance <= 0.5) {
    const after = setupPreviews.pvnaTolerance08
    if (
      setupActionImprovesTarget(current, after, repeatRisk, rangeRisk) &&
      setupActionIsWorthShowing(current, best, after)
    ) {
      actions.push({
        type: 'set_pvna_tolerance',
        label: `${setupActionPurpose(repeatRisk, rangeRisk)}: Thử PVNA ±0.8`,
        detail: describeSetupTradeoff(
          current,
          after,
          'Nới rộng dung sai (tolerance) để thuật toán có thêm tổ hợp hợp lệ. Đánh đổi: trình độ các trận có thể lệch hơn.',
        ),
        pvna_tolerance: 0.8,
        before: current,
        after,
      })
    }
  }

  if (repeatRisk && input.courtCount > 1) {
    const after = setupPreviews.courtsMinus1
    if (
      setupActionImprovesTarget(current, after, repeatRisk, false) &&
      setupActionIsWorthShowing(current, best, after)
    ) {
      actions.push({
        type: 'set_courts',
        label: `Giảm lặp: Giảm còn ${input.courtCount - 1} sân`,
        detail: describeSetupTradeoff(
          current,
          after,
          'Giảm số sân vòng này để thêm người nghỉ và xoay vòng tổ hợp tốt hơn. Đánh đổi: ít người được chơi vòng này hơn.',
        ),
        courts: input.courtCount - 1,
        before: current,
        after,
      })
    }
  }

  if (actions.length > 0) {
    actions.push({
      type: 'accept_tradeoff',
      label: 'Chấp nhận phương án này',
      detail: `Giữ cấu hình hiện tại và bắt đầu. Áp lực lặp: ${pressure.repeat_risk === 'low' ? 'thấp' : pressure.repeat_risk === 'medium' ? 'vừa' : 'cao'}, host chấp nhận đánh đổi.`,
      before: current,
    })
  }

  return actions.slice(0, 4)
}

function setupActionPurpose(repeatRisk: boolean, rangeRisk: boolean): string {
  if (repeatRisk && rangeRisk) return 'Giảm lặp/cân trận'
  if (repeatRisk) return 'Giảm lặp'
  return 'Cân số trận'
}

function setupActionImprovesTarget(
  before: AlternativeAudit,
  after: AlternativeAudit | null,
  repeatRisk: boolean,
  rangeRisk: boolean,
): after is AlternativeAudit {
  if (!after) return false
  if (rangeRisk && after.match_range < before.match_range) return true
  if (
    repeatRisk &&
    (
      after.max_opponent_burden < before.max_opponent_burden ||
      after.max_opponent_pair < before.max_opponent_pair ||
      after.max_partner_pair < before.max_partner_pair ||
      after.opponent_repeat_pairs < before.opponent_repeat_pairs ||
      after.partner_repeat_pairs < before.partner_repeat_pairs
    )
  ) {
    return true
  }
  return after.fairness_total > before.fairness_total + 2
}

function setupActionIsWorthShowing(
  current: AlternativeAudit,
  best: AlternativeAudit | undefined,
  after: AlternativeAudit,
): boolean {
  if (!best || current.index === best.index) return true
  return compareAudit(after, best) < 0
}

export function describeAlternativeDelta(before: AlternativeAudit, after: AlternativeAudit): string {
  const parts = [
    `fairness ${before.fairness_total} -> ${after.fairness_total}`,
    `burden ${before.max_opponent_burden} -> ${after.max_opponent_burden}`,
    `opp max ${before.max_opponent_pair} -> ${after.max_opponent_pair}`,
    `partner max ${before.max_partner_pair} -> ${after.max_partner_pair}`,
  ]
  if (before.match_range !== after.match_range) {
    parts.push(`range ${before.match_range} -> ${after.match_range}`)
  }
  return parts.join(', ')
}

function auditSortKey(audit: AlternativeAudit): number[] {
  return [
    audit.match_range,
    audit.max_opponent_burden,
    audit.max_opponent_pair,
    audit.max_partner_pair,
    audit.opponent_repeat_pairs,
    audit.partner_repeat_pairs,
    -audit.fairness_total,
  ]
}

export function sortAlternativesByAudit(audits: AlternativeAudit[]): number[] {
  return [...audits].sort(compareAudit).map(a => a.index)
}

export function compareAudit(a: AlternativeAudit, b: AlternativeAudit): number {
  const left = auditSortKey(a)
  const right = auditSortKey(b)
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return a.index - b.index
}

function isMeaningfullyBetterAlternative(current: AlternativeAudit, candidate: AlternativeAudit): boolean {
  if (candidate.fairness_total < current.fairness_total - 3) return false
  if (candidate.match_range > current.match_range) return false
  return (
    candidate.max_opponent_burden < current.max_opponent_burden ||
    candidate.max_opponent_pair < current.max_opponent_pair ||
    candidate.max_partner_pair < current.max_partner_pair ||
    candidate.opponent_repeat_pairs < current.opponent_repeat_pairs ||
    candidate.partner_repeat_pairs < current.partner_repeat_pairs ||
    candidate.fairness_total > current.fairness_total + 2
  )
}

function previewSetupChange(input: {
  state: SessionState
  pvnaTolerance?: number
  courtCount?: number
}): AlternativeAudit | null {
  const nextState: SessionState = {
    ...input.state,
    config: {
      ...input.state.config,
      pvna_tolerance: input.pvnaTolerance ?? input.state.config.pvna_tolerance,
      courts: input.courtCount ?? input.state.config.courts,
    },
  }
  const nextSuggestion = suggestNextRound(nextState)
  const nextAlternative = nextSuggestion.alternatives[0]
  return nextAlternative ? auditAlternative(nextState, nextAlternative, 0) : null
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function describeSetupTradeoff(before: AlternativeAudit, after: AlternativeAudit | null, fallback: string): string {
  if (!after) return fallback
  const repeatDelta =
    after.opponent_repeat_pairs +
    after.partner_repeat_pairs -
    before.opponent_repeat_pairs -
    before.partner_repeat_pairs

  return [
    describeAlternativeDelta(before, after),
    `cặp lặp ${formatSigned(repeatDelta)}`,
    'host tự quyết định đánh đổi',
  ].join(', ')
}
