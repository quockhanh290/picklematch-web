import { PRESETS } from './presets'
import type {
  CourtCalculatorInput,
  CourtOption,
  CourtPreset,
  CourtWarning,
  CourtWarningAlternative,
  CourtWarningPreview,
} from './types'

const DEFAULT_MATCH_DURATION_MIN = 15

export function buildCourtWarnings(
  input: Required<Pick<CourtCalculatorInput, 'n_players' | 'session_duration_min'>> &
    Pick<CourtCalculatorInput, 'match_duration_min' | 'preset'>,
  recommended: CourtOption,
  alternatives: CourtOption[],
): CourtWarning[] {
  const nPlayers = Math.max(0, Math.floor(input.n_players))
  const durationMin = Math.max(0, Math.floor(input.session_duration_min))
  const matchDuration = Math.max(1, Math.floor(input.match_duration_min ?? DEFAULT_MATCH_DURATION_MIN))
  const preset = input.preset ?? 'balanced'
  const warnings: CourtWarning[] = []

  if (nPlayers <= 12 && recommended.total_rounds >= 8) {
    warnings.push({
      severity: nPlayers <= 9 && recommended.total_rounds >= 10 ? 'critical' : 'warning',
      type: 'small_group_long_session',
      message: 'Nhom it nguoi va session dai se lap cap nhieu.',
      why: `${nPlayers} nguoi choi ${recommended.total_rounds} vong nen so to hop partner/doi thu rat han che.`,
      alternatives: compactAlternatives([
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giu setup nay neu uu tien moi nguoi choi nhieu hon diversity.'),
      ]),
    })
  }

  if (nPlayers <= 10 && recommended.avg_matches_per_player >= 5) {
    warnings.push({
      severity: 'warning',
      type: 'repeat_unavoidable',
      message: 'Repeat gan nhu khong tranh duoc voi setup nay.',
      why: `Moi nguoi du kien choi ${recommended.avg_matches_per_player.toFixed(1)} tran trong nhom ${nPlayers} nguoi.`,
      alternatives: compactAlternatives([
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Chap nhan lap cap de giu so tran moi nguoi cao.'),
      ]),
    })
  }

  if (recommended.play_ratio < targetMin(preset)) {
    const higherCourt = alternatives.find(
      (option) => option.courts > recommended.courts && option.feasibility !== 'infeasible',
    )
    warnings.push({
      severity: 'info',
      type: 'low_rotation',
      message: 'Moi vong hoi it nguoi vao san.',
      why: `Rotation ${(recommended.play_ratio * 100).toFixed(0)}% thap hon vung dep cua mode ${PRESETS[preset].label}.`,
      alternatives: compactAlternatives([
        higherCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, higherCourt, 'Tang san de nhieu nguoi duoc xoay moi vong hon.') : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giu setup neu muon nghi nhieu hon va tran it hon.'),
      ]),
    })
  }

  if (recommended.play_ratio > targetMax(preset)) {
    const lowerCourt = [...alternatives]
      .reverse()
      .find((option) => option.courts < recommended.courts && option.feasibility !== 'infeasible')
    warnings.push({
      severity: 'info',
      type: 'high_rotation',
      message: 'Moi vong co nhieu nguoi vao san, diversity co the giam.',
      why: `Rotation ${(recommended.play_ratio * 100).toFixed(0)}% cao hon vung dep cua mode ${PRESETS[preset].label}.`,
      alternatives: compactAlternatives([
        lowerCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, lowerCourt, 'Giam san de tao them luot nghi va xoay to hop.') : null,
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giu setup neu uu tien choi nhieu.'),
      ]),
    })
  }

  if (recommended.play_ratio >= 0.98 && recommended.total_rounds >= 6 && nPlayers > 4) {
    const lowerCourt = [...alternatives]
      .reverse()
      .find((option) => option.courts < recommended.courts && option.feasibility !== 'infeasible')
    warnings.push({
      severity: 'warning',
      type: 'all_play_pressure',
      message: 'Gan nhu all-play moi vong.',
      why: 'Khi hau het moi nguoi deu choi moi vong, engine co it luot nghi de doi to hop partner/doi thu.',
      alternatives: compactAlternatives([
        lowerCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, lowerCourt, 'Giam san de tang diversity.') : null,
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giu setup neu day la session choi nhieu.'),
      ]),
    })
  }

  if (recommended.avg_matches_per_player < PRESETS[preset].matches - 0.25) {
    const higherCourt = alternatives.find(
      (option) => option.courts > recommended.courts && option.feasibility !== 'infeasible',
    )
    warnings.push({
      severity: 'info',
      type: 'target_unreachable',
      message: 'Setup nay chua dat muc tieu so tran cua mode.',
      why: `Du kien ${recommended.avg_matches_per_player.toFixed(1)} tran/nguoi, muc tieu ${PRESETS[preset].label} la ${PRESETS[preset].matches.toFixed(1)}.`,
      alternatives: compactAlternatives([
        higherCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, higherCourt, 'Tang san de gan muc tieu tran/nguoi hon.') : null,
        increaseDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giu setup neu muon session nhe hon target.'),
      ]),
    })
  }

  return dedupeWarnings(warnings)
}

function reduceDurationAlternative(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
): CourtWarningAlternative | null {
  const nextDuration = Math.max(matchDuration * 4, durationMin - 30)
  if (nextDuration >= durationMin) return null

  return {
    action: 'set_duration',
    label: `Giam con ${nextDuration}p`,
    expected_effect: `Giam so vong ${option.total_rounds} -> ${roundsFor(nextDuration, matchDuration)}, repeat risk thap hon.`,
    tradeoff: 'Moi nguoi se choi it tran hon.',
    duration_min: nextDuration,
    preview: buildPreview(nPlayers, nextDuration, matchDuration, preset, option.courts),
  }
}

function increaseDurationAlternative(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
): CourtWarningAlternative | null {
  const nextDuration = durationMin + 30
  const preview = buildPreview(nPlayers, nextDuration, matchDuration, preset, option.courts)
  if (preview.risk_level === 'high') return null

  return {
    action: 'set_duration',
    label: `Tang len ${nextDuration}p`,
    expected_effect: `Tang so vong ${option.total_rounds} -> ${roundsFor(nextDuration, matchDuration)}, gan target tran/nguoi hon.`,
    tradeoff: 'Session dai hon va repeat co the tang neu nhom it nguoi.',
    duration_min: nextDuration,
    preview,
  }
}

function changePresetAlternative(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
): CourtWarningAlternative {
  return {
    action: 'set_preset',
    label: `Doi ${PRESETS[preset].label}`,
    expected_effect: `Doi muc tieu sang ${PRESETS[preset].description}.`,
    tradeoff: 'Recommendation so san co the thay doi theo muc tieu moi.',
    preset,
    preview: buildPreview(nPlayers, durationMin, matchDuration, preset, option.courts),
  }
}

function setCourtsAlternative(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
  expectedEffect: string,
): CourtWarningAlternative {
  return {
    action: 'set_courts',
    label: `Chon ${option.courts} san`,
    expected_effect: expectedEffect,
    tradeoff: `${option.avg_matches_per_player.toFixed(1)} tran/nguoi, rotation ${(option.play_ratio * 100).toFixed(0)}%.`,
    courts: option.courts,
    preview: buildPreview(nPlayers, durationMin, matchDuration, preset, option.courts),
  }
}

function setCourtsAlternativeIfUseful(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
  expectedEffect: string,
): CourtWarningAlternative | null {
  const alternative = setCourtsAlternative(nPlayers, durationMin, matchDuration, preset, option, expectedEffect)
  return alternative.preview.risk_level === 'high' ? null : alternative
}

function acceptTradeoffAlternative(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  option: CourtOption,
  expectedEffect: string,
): CourtWarningAlternative {
  return {
    action: 'accept_tradeoff',
    label: 'Giu setup',
    expected_effect: expectedEffect,
    tradeoff: 'Host chap nhan tradeoff nay.',
    preview: buildPreview(nPlayers, durationMin, matchDuration, preset, option.courts),
  }
}

function buildPreview(
  nPlayers: number,
  durationMin: number,
  matchDuration: number,
  preset: CourtPreset,
  courts: number,
): CourtWarningPreview {
  const rounds = roundsFor(durationMin, matchDuration)
  const slotsPerRound = Math.max(1, courts) * 4
  const avgMatches = nPlayers === 0 ? 0 : (rounds * slotsPerRound) / nPlayers
  const playRatio = nPlayers === 0 ? 0 : slotsPerRound / nPlayers

  return {
    n_players: nPlayers,
    duration_min: durationMin,
    match_duration_min: matchDuration,
    preset,
    courts,
    rounds,
    avg_matches_per_player: round1(avgMatches),
    play_ratio: round2(playRatio),
    risk_level: riskLevel(nPlayers, rounds, avgMatches, playRatio),
  }
}

function riskLevel(
  nPlayers: number,
  rounds: number,
  avgMatches: number,
  playRatio: number,
): CourtWarningPreview['risk_level'] {
  if ((nPlayers <= 10 && avgMatches >= 5) || (playRatio >= 0.98 && rounds >= 8)) return 'high'
  if ((nPlayers <= 12 && rounds >= 8) || playRatio > 0.9 || playRatio < 0.45) return 'medium'
  return 'low'
}

function roundsFor(durationMin: number, matchDuration: number): number {
  return Math.max(0, Math.floor(durationMin / Math.max(1, matchDuration)))
}

function targetMin(preset: CourtPreset): number {
  if (preset === 'relaxed') return 0.4
  if (preset === 'play_more') return 0.65
  return 0.55
}

function targetMax(preset: CourtPreset): number {
  if (preset === 'relaxed') return 0.7
  if (preset === 'play_more') return 0.95
  return 0.8
}

function compactAlternatives(
  alternatives: Array<CourtWarningAlternative | null>,
): CourtWarningAlternative[] {
  return alternatives.filter((item): item is CourtWarningAlternative => item !== null)
}

function dedupeWarnings(warnings: CourtWarning[]): CourtWarning[] {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    if (seen.has(warning.type)) return false
    seen.add(warning.type)
    return true
  })
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}
