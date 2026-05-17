import { computeGenderPrefSatisfaction, computeMatchCountMetrics, computeOpponentDiversity, computeOpponentRepeatBurden, computePartnerDiversity, computeSessionFairness } from './fairness/metrics.ts'
import { computeRepeatPressure } from './fairness/pressure.ts'
import { previewStateAfterAlternative } from './history.ts'
import { suggestNextRound } from './suggest.ts'
import type { SessionState, SuggestionAlternative } from './types.ts'

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
  }
}

export function buildSuggestedRoundActions(input: {
  state: SessionState
  alternatives: SuggestionAlternative[]
  selectedIndex: number
  pvnaTolerance: number
  courtCount: number
}): SuggestedRoundAction[] {
  const selected = input.alternatives[input.selectedIndex] ?? input.alternatives[0]
  if (!selected) return []

  const pressure = computeRepeatPressure(input.state)
  const audits = input.alternatives.map((alternative, index) => auditAlternative(input.state, alternative, index))
  const current = audits[input.selectedIndex] ?? audits[0]
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

  const better = audits
    .filter(audit => audit.index !== current.index)
    .filter(audit => isMeaningfullyBetterAlternative(current, audit))
    .sort(compareAudit)[0]

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
    const after = previewSetupChange({
      state: input.state,
      pvnaTolerance: 0.8,
    })
    actions.push({
      type: 'set_pvna_tolerance',
      label: 'Đánh đổi: Thử PVNA ±0.8',
      detail: describeSetupTradeoff(
        current,
        after,
        'Nới rộng dung sai (tolerance) để thuật toán có thêm tổ hợp hợp lệ. Đánh đổi: trình độ các trận có thể lệch hơn.',
      ),
      pvna_tolerance: 0.8,
      before: current,
      after: after ?? undefined,
    })
  }

  if (repeatRisk && input.courtCount > 1) {
    const after = previewSetupChange({
      state: input.state,
      courtCount: input.courtCount - 1,
    })
    actions.push({
      type: 'set_courts',
      label: `Đánh đổi: Giảm còn ${input.courtCount - 1} sân`,
      detail: describeSetupTradeoff(
        current,
        after,
        'Giảm số sân vòng này để thêm người nghỉ và xoay vòng tổ hợp tốt hơn. Đánh đổi: ít người được chơi vòng này hơn.',
      ),
      courts: input.courtCount - 1,
      before: current,
      after: after ?? undefined,
    })
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

function compareAudit(a: AlternativeAudit, b: AlternativeAudit): number {
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
