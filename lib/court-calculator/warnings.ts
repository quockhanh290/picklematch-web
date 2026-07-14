// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { getCourtPresetTargetMatches, PRESETS, PRESET_ROTATION_TARGETS } from './presets.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import { computeCourtRepeatPressure } from './pressure.ts'
// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type {
  CourtCalculatorInput,
  CourtOption,
  CourtPreset,
  CourtWarning,
  CourtWarningAlternative,
  CourtWarningPreview,
} from './types.ts'

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
  const totalRounds = roundsFor(durationMin, matchDuration)
  const targetMatches = getCourtPresetTargetMatches(preset, totalRounds)
  const warnings: CourtWarning[] = []
  const pressure = recommended.repeat_pressure

  if (pressure.risk === 'high' || pressure.risk === 'extreme') {
    const lowerCourt = [...alternatives]
      .reverse()
      .find((option) => option.courts < recommended.courts && option.feasibility !== 'infeasible')
    warnings.push({
      severity: pressure.risk === 'extreme' ? 'warning' : 'info',
      type: 'repeat_pressure',
      message: `Setup này tạo áp lực lặp (repeat pressure) ${pressure.risk === 'extreme' ? 'rất cao' : 'cao'}.`,
      why: `Dự kiến ${pressure.avg_matches_per_player.toFixed(1)} trận/người, áp lực đối thủ ${pressure.opponent_pressure.toFixed(2)}. Lặp có thể là giới hạn tổ hợp, không phải do lỗi engine.`,
      alternatives: compactAlternatives([
        lowerCourt ? setCourtsAlternative(nPlayers, durationMin, matchDuration, preset, lowerCourt, 'Giảm sân để thêm người nghỉ và mở thêm tổ hợp vòng sau.') : null,
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup nếu ưu tiên số trận/người cao và chấp nhận lặp.'),
      ]),
    })
  }

  if (nPlayers <= 12 && recommended.total_rounds >= 8) {
    warnings.push({
      severity: nPlayers <= 9 && recommended.total_rounds >= 10 ? 'critical' : 'warning',
      type: 'small_group_long_session',
      message: 'Nhóm ít người và buổi chơi dài sẽ lặp cặp nhiều.',
      why: `${nPlayers} người chơi ${recommended.total_rounds} vòng nên số tổ hợp partner (đồng đội)/đối thủ rất hạn chế.`,
      alternatives: compactAlternatives([
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup này nếu ưu tiên mỗi người chơi nhiều hơn độ đa dạng.'),
      ]),
    })
  }

  if (nPlayers <= 10 && recommended.avg_matches_per_player >= 5) {
    warnings.push({
      severity: 'warning',
      type: 'repeat_unavoidable',
      message: 'Lặp gần như không tránh được với setup này.',
      why: `Mỗi người dự kiến chơi ${recommended.avg_matches_per_player.toFixed(1)} trận trong nhóm ${nPlayers} người.`,
      alternatives: compactAlternatives([
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Chấp nhận lặp cặp để giữ số trận mỗi người cao.'),
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
      message: 'Mỗi vòng hơi ít người vào sân.',
      why: `Tỉ lệ vào sân ${(recommended.play_ratio * 100).toFixed(0)}% thấp hơn vùng đẹp của chế độ ${PRESETS[preset].label}.`,
      alternatives: compactAlternatives([
        higherCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, higherCourt, 'Tăng sân để nhiều người được xoay mỗi vòng hơn.') : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup nếu muốn nghỉ nhiều hơn và trận ít hơn.'),
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
      message: 'Mỗi vòng có nhiều người vào sân, độ đa dạng (diversity) có thể giảm.',
      why: `Tỉ lệ vào sân ${(recommended.play_ratio * 100).toFixed(0)}% cao hơn vùng đẹp của chế độ ${PRESETS[preset].label}.`,
      alternatives: compactAlternatives([
        lowerCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, lowerCourt, 'Giảm sân để tạo thêm lượt nghỉ và xoay tổ hợp.') : null,
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup nếu ưu tiên chơi nhiều.'),
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
      message: 'Gần như chơi tất cả mỗi vòng (all-play).',
      why: 'Khi hầu hết mọi người đều chơi mỗi vòng, engine có ít lượt nghỉ để đổi tổ hợp đồng đội (partner)/đối thủ.',
      alternatives: compactAlternatives([
        lowerCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, lowerCourt, 'Giảm sân để tăng độ đa dạng (diversity).') : null,
        reduceDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup nếu đây là buổi chơi nhiều.'),
      ]),
    })
  }

  if (recommended.avg_matches_per_player < targetMatches - 0.25) {
    const higherCourt = alternatives.find(
      (option) => option.courts > recommended.courts && option.feasibility !== 'infeasible',
    )
    warnings.push({
      severity: 'info',
      type: 'target_unreachable',
      message: 'Setup này chưa đạt mục tiêu số trận của chế độ.',
      why: `Dự kiến ${recommended.avg_matches_per_player.toFixed(1)} trận/người, mục tiêu ${PRESETS[preset].label} là ${targetMatches.toFixed(1)}.`,
      alternatives: compactAlternatives([
        higherCourt ? setCourtsAlternativeIfUseful(nPlayers, durationMin, matchDuration, preset, higherCourt, 'Tăng sân để gần mục tiêu trận/người hơn.') : null,
        increaseDurationAlternative(nPlayers, durationMin, matchDuration, preset, recommended),
        preset !== 'relaxed' ? changePresetAlternative(nPlayers, durationMin, matchDuration, 'relaxed', recommended) : null,
        acceptTradeoffAlternative(nPlayers, durationMin, matchDuration, preset, recommended, 'Giữ setup nếu muốn buổi chơi nhẹ hơn target.'),
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
    label: `Giảm còn ${nextDuration}p`,
    expected_effect: `Giảm số vòng ${option.total_rounds} ➔ ${roundsFor(nextDuration, matchDuration)}, nguy cơ lặp (repeat risk) thấp hơn.`,
    tradeoff: 'Mỗi người sẽ chơi ít trận hơn.',
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
    label: `Tăng lên ${nextDuration}p`,
    expected_effect: `Tăng số vòng ${option.total_rounds} ➔ ${roundsFor(nextDuration, matchDuration)}, gần mục tiêu trận/người hơn.`,
    tradeoff: 'Buổi chơi dài hơn và lặp có thể tăng nếu nhóm ít người.',
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
    label: `Đổi sang ${PRESETS[preset].label}`,
    expected_effect: `Đổi mục tiêu sang khoảng ${getCourtPresetTargetMatches(preset, roundsFor(durationMin, matchDuration)).toFixed(1)} trận/người.`,
    tradeoff: 'Khuyến nghị số sân có thể thay đổi theo mục tiêu mới.',
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
    label: `Chọn ${option.courts} sân`,
    expected_effect: expectedEffect,
    tradeoff: `${option.avg_matches_per_player.toFixed(1)} trận/người, tỉ lệ vào sân ${(option.play_ratio * 100).toFixed(0)}%.`,
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
  return alternative.preview.risk_level === 'high' || alternative.preview.risk_level === 'extreme' ? null : alternative
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
    label: 'Giữ setup',
    expected_effect: expectedEffect,
    tradeoff: 'Host chấp nhận đánh đổi (tradeoff) này.',
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
  const pressure = computeCourtRepeatPressure(nPlayers, courts, rounds)

  return {
    n_players: nPlayers,
    duration_min: durationMin,
    match_duration_min: matchDuration,
    preset,
    courts,
    rounds,
    avg_matches_per_player: pressure.avg_matches_per_player,
    play_ratio: pressure.play_ratio,
    risk_level: pressure.risk,
  }
}

function roundsFor(durationMin: number, matchDuration: number): number {
  return Math.max(0, Math.floor(durationMin / Math.max(1, matchDuration)))
}

function targetMin(preset: CourtPreset): number {
  return PRESET_ROTATION_TARGETS[preset].min
}

function targetMax(preset: CourtPreset): number {
  return PRESET_ROTATION_TARGETS[preset].max
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
