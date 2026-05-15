import type { SimulationResult } from '../runner'
import { renderBarChart, renderHeatmap, renderLineChart } from './charts'

export function renderHeader(result: SimulationResult): string {
  const config = result.config
  const score = result.fairness_score
  return `<header><div><h1>${escapeText(config.scenario_name ?? 'Simulation')}</h1><div class="config"><span class="pill">${config.n_players} players</span><span class="pill">${config.courts} courts</span><span class="pill">${config.rounds} rounds</span><span class="pill">seed ${config.seed}</span><span class="pill">corrector ${config.use_corrector ? 'ON' : 'OFF'}</span></div></div><div class="score ${score.grade}"><div class="num">${score.total}</div><div class="label">${score.grade}</div></div></header>`
}

export function renderSummaryCards(result: SimulationResult): string {
  const avgMatches = average(result.per_player_stats.map((player) => player.matches_played))
  const maxRest = Math.max(0, ...result.per_player_stats.map((player) => player.max_consecutive_rest))
  return `<section><div class="cards"><div class="card"><div class="value">${result.rounds_completed.length}</div><div class="label">Rounds completed</div></div><div class="card"><div class="value">${avgMatches.toFixed(1)}</div><div class="label">Avg matches/player</div></div><div class="card ${maxRest > 1 ? 'warn' : ''}"><div class="value">${maxRest}</div><div class="label">Max consecutive rest</div></div><div class="card"><div class="value">${result.avg_suggest_time_ms.toFixed(0)}ms</div><div class="label">Avg suggest time</div></div></div></section>`
}

export function renderBreakdown(result: SimulationResult): string {
  const b = result.fairness_score.breakdown
  const rows: Array<[string, number, number]> = [
    ['Match count', b.match_count, 25],
    ['Partner diversity', b.partner_diversity, 20],
    ['Opponent diversity', b.opponent_diversity, 15],
    ['Rest fairness', b.rest, 20],
    ['Gender prefs', b.gender_prefs, 20],
  ]

  return `<section><h2>Fairness Breakdown</h2><div class="breakdown">${rows
    .map(([label, value, max]) => `<div class="breakrow"><div>${label}</div><div class="bar"><div class="fill" style="width:${Math.max(0, Math.min(100, (value / max) * 100))}%"></div></div><div>${value}/${max}</div></div>`)
    .join('')}</div></section>`
}

export function renderEvolution(result: SimulationResult): string {
  return `<section><h2>Fairness Evolution</h2><div class="chartwrap">${renderLineChart({
    values: result.fairness_evolution.map((point) => point.score),
    labels: result.fairness_evolution.map((point) => `R${point.round}`),
    max: 100,
  })}</div></section>`
}

export function renderPerPlayer(result: SimulationResult): string {
  const matchChart = renderBarChart({
    values: result.per_player_stats.map((player) => player.matches_played),
    labels: result.per_player_stats.map((player) => player.player_id),
  })

  return `<section><h2>Per Player Stats</h2><div class="chartwrap">${matchChart}</div><div class="chartwrap"><table class="sortable"><thead><tr><th data-sort="string">Player</th><th data-sort="number">PVNA</th><th data-sort="number">Matches</th><th data-sort="number">Unique partners</th><th data-sort="number">Unique opponents</th><th data-sort="number">Max rest</th><th data-sort="number">Rest total</th><th data-sort="string">Gender</th><th data-sort="string">Partner pref</th><th data-sort="string">Opponent pref</th></tr></thead><tbody>${result.per_player_stats
    .map((stat) => {
      const player = result.final_state.players.get(stat.player_id)
      return `<tr><td>${escapeText(stat.player_id)}</td><td>${formatNumber(player?.pvna)}</td><td>${stat.matches_played}</td><td>${stat.unique_partners}</td><td>${stat.unique_opponents}</td><td class="${stat.max_consecutive_rest > 1 ? 'bad' : ''}">${stat.max_consecutive_rest}</td><td>${stat.rest_total}</td><td>${escapeText(player?.gender ?? '-')}</td><td>${escapeText(player?.partner_gender_pref ?? 'any')}</td><td>${escapeText(player?.opponent_gender_pref ?? 'any')}</td></tr>`
    })
    .join('')}</tbody></table></div></section>`
}

export function renderPairHistoryHeatmaps(result: SimulationResult): string {
  const playerIds = result.per_player_stats.map((player) => player.player_id)
  const partnerGrid = buildPairGrid(result, playerIds, 'partner')
  const opponentGrid = buildPairGrid(result, playerIds, 'opponent')

  return `<section><h2>Pair History Heatmaps</h2><div class="grid2"><div class="chartwrap">${renderHeatmap(partnerGrid, playerIds, 'Partner counts')}</div><div class="chartwrap">${renderHeatmap(opponentGrid, playerIds, 'Opponent counts')}</div></div></section>`
}

export function renderRounds(result: SimulationResult): string {
  return `<section><h2>Round Details</h2>${result.rounds_completed
    .map((round, index) => {
      const adjustment = result.adjustments_applied.find((item) => item.round_no === round.round_no)
      const score = result.fairness_evolution[index]?.score ?? '-'
      return `<details class="round" ${index < 2 ? 'open' : ''}><summary><b>Round ${round.round_no}</b><span>Score after: ${score}</span>${adjustment ? '<span class="badge">Adjusted</span>' : ''}<span class="roundtime">${round.elapsed_ms.toFixed(0)}ms</span></summary><div class="roundbody">${round.matches
        .map((match) => `<div class="match"><span class="court">S${match.court_idx + 1}</span><div class="teams"><span class="team">${match.team_a.map(escapeText).join(' + ')}</span><span class="vs">vs</span><span class="team">${match.team_b.map(escapeText).join(' + ')}</span></div></div>`)
        .join('')}${round.resting.length > 0 ? `<div class="rest">Resting: ${round.resting.map(escapeText).join(', ')}</div>` : ''}${adjustment ? `<div class="adjustment"><b>Adjustment:</b> ${adjustment.triggered_by_warnings.map(escapeText).join(', ')}<br/>Score: ${adjustment.fairness_score_before} -> ${adjustment.fairness_score_after ?? '-'}</div>` : ''}</div></details>`
    })
    .join('')}</section>`
}

export function renderWarnings(result: SimulationResult): string {
  if (result.warnings_raised.length === 0 && result.invariant_violations.length === 0) {
    return '<section><h2>Engine Behavior</h2><p class="empty">No warnings or invariant violations.</p></section>'
  }

  return `<section><h2>Engine Behavior</h2><div class="grid2"><div><h3>Warnings</h3>${result.warnings_raised.length === 0 ? '<p class="empty">No warnings.</p>' : `<table><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>${result.warnings_raised.map((warning) => `<tr><td><code>${escapeText(warning.type)}</code></td><td>${warning.count}</td></tr>`).join('')}</tbody></table>`}</div><div><h3>Invariant Violations</h3>${result.invariant_violations.length === 0 ? '<p class="ok">None</p>' : `<ul>${result.invariant_violations.map((item) => `<li class="warntext">${escapeText(item)}</li>`).join('')}</ul>`}</div></div></section>`
}

export function renderAdjustmentTimeline(result: SimulationResult): string {
  if (result.adjustments_applied.length === 0) {
    return '<section><h2>Adjustment Timeline</h2><p class="empty">No fairness adjustments applied.</p></section>'
  }

  return `<section><h2>Adjustment Timeline</h2><table class="sortable"><thead><tr><th data-sort="number">Round</th><th data-sort="string">Triggered by</th><th data-sort="number">Before</th><th data-sort="number">No adjust</th><th data-sort="number">Adjusted</th><th data-sort="number">A/B delta</th><th data-sort="string">Config changes</th><th data-sort="number">Tier overrides</th></tr></thead><tbody>${result.adjustments_applied
    .map((adjustment) => {
      const before = adjustment.fairness_score_before
      const without = adjustment.fairness_score_without_adjustment
      const after = adjustment.fairness_score_after
      const delta = after == null || without == null ? null : after - without
      const deltaClass = delta == null ? '' : delta >= 0 ? 'ok' : 'warntext'
      return `<tr><td>${adjustment.round_no}</td><td>${adjustment.triggered_by_warnings.map(escapeText).join(', ')}</td><td>${before}</td><td>${without ?? '-'}</td><td>${after ?? '-'}</td><td class="${deltaClass}">${delta == null ? '-' : `${delta > 0 ? '+' : ''}${delta}`}</td><td><code>${escapeText(formatConfigChanges(adjustment.config_changes))}</code></td><td>${Object.keys(adjustment.tier_overrides).length}</td></tr>`
    })
    .join('')}</tbody></table></section>`
}

export function renderPerformance(result: SimulationResult): string {
  return `<section><h2>Performance</h2><div class="cards"><div class="card"><div class="value">${result.total_suggest_time_ms.toFixed(0)}ms</div><div class="label">Total suggest</div></div><div class="card"><div class="value">${result.avg_suggest_time_ms.toFixed(0)}ms</div><div class="label">Avg round</div></div><div class="card"><div class="value">${result.max_suggest_time_ms.toFixed(0)}ms</div><div class="label">Max round</div></div><div class="card"><div class="value">${result.adjustments_applied.length}</div><div class="label">Adjustments</div></div></div></section>`
}

export function escapeText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatNumber(value: number | undefined): string {
  return value == null ? '-' : value.toFixed(2)
}

function formatConfigChanges(value: unknown): string {
  const text = JSON.stringify(value)
  return text === '{}' ? '-' : text
}

function buildPairGrid(
  result: SimulationResult,
  playerIds: string[],
  type: 'partner' | 'opponent',
): number[][] {
  return playerIds.map((rowId) => {
    const player = result.final_state.players.get(rowId)
    const counts = type === 'partner' ? player?.partner_counts : player?.opponent_counts

    return playerIds.map((columnId) => (rowId === columnId ? 0 : counts?.get(columnId) ?? 0))
  })
}
