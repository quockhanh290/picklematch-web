export type ChartData = {
  values: number[]
  labels: string[]
  min?: number
  max?: number
  color?: string
}

export function renderLineChart(data: ChartData, width = 760, height = 240): string {
  if (data.values.length === 0) {
    return '<p class="empty">No chart data.</p>'
  }

  const min = data.min ?? 0
  const max = data.max ?? Math.max(100, ...data.values)
  const range = Math.max(1, max - min)
  const pad = { top: 18, right: 22, bottom: 34, left: 40 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const color = data.color ?? '#0f6e56'
  const xFor = (index: number) =>
    pad.left + (data.values.length === 1 ? innerW / 2 : (index / (data.values.length - 1)) * innerW)
  const yFor = (value: number) => pad.top + innerH - ((value - min) / range) * innerH
  const points = data.values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ')
  const grid = [0, 25, 50, 75, 100]
    .map((value) => {
      const y = yFor(value)
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e6ddce" stroke-dasharray="3 3"/><text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#66736f">${value}</text>`
    })
    .join('')
  const labels = data.labels
    .map((label, index) => `<text x="${xFor(index)}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#66736f">${escapeAttr(label)}</text>`)
    .join('')
  const dots = data.values
    .map((value, index) => `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="4" fill="${color}"><title>${escapeAttr(data.labels[index])}: ${value}</title></circle>`)
    .join('')

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fairness evolution">${grid}${labels}<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3"/>${dots}</svg>`
}

export function renderBarChart(data: ChartData, width = 760, height = 260): string {
  if (data.values.length === 0) {
    return '<p class="empty">No chart data.</p>'
  }

  const max = data.max ?? Math.max(1, ...data.values)
  const pad = { top: 16, right: 14, bottom: 54, left: 34 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const barW = innerW / data.values.length
  const color = data.color ?? '#0f6e56'
  const bars = data.values
    .map((value, index) => {
      const h = (value / max) * innerH
      const x = pad.left + index * barW + 2
      const y = pad.top + innerH - h
      const label = data.labels[index]
      return `<rect x="${x}" y="${y}" width="${Math.max(2, barW - 4)}" height="${h}" fill="${color}" rx="3"><title>${escapeAttr(label)}: ${value}</title></rect><text transform="translate(${x + barW / 2 - 2},${height - 10}) rotate(-60)" text-anchor="end" font-size="9" fill="#66736f">${escapeText(label)}</text>`
    })
    .join('')

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Per player bar chart">${bars}</svg>`
}

export function renderHeatmap(
  grid: number[][],
  labels: string[],
  title: string,
  cellSize = 12,
): string {
  if (grid.length === 0 || labels.length === 0) {
    return '<p class="empty">No heatmap data.</p>'
  }

  const pad = { top: 34, right: 18, bottom: 90, left: 90 }
  const width = pad.left + pad.right + labels.length * cellSize
  const height = pad.top + pad.bottom + labels.length * cellSize
  const max = Math.max(1, ...grid.flat())
  const cells = grid
    .map((row, y) =>
      row
        .map((value, x) => {
          const intensity = value / max
          const fill = value === 0 ? '#f3eadb' : `rgba(15,110,86,${0.25 + intensity * 0.75})`
          return `<rect x="${pad.left + x * cellSize}" y="${pad.top + y * cellSize}" width="${cellSize - 1}" height="${cellSize - 1}" fill="${fill}"><title>${escapeAttr(labels[y])} / ${escapeAttr(labels[x])}: ${value}</title></rect>`
        })
        .join(''),
    )
    .join('')
  const xLabels = labels
    .map((label, index) => `<text transform="translate(${pad.left + index * cellSize + cellSize / 2},${height - 12}) rotate(-60)" text-anchor="end" font-size="8" fill="#66736f">${escapeText(label)}</text>`)
    .join('')
  const yLabels = labels
    .map((label, index) => `<text x="${pad.left - 8}" y="${pad.top + index * cellSize + cellSize - 3}" text-anchor="end" font-size="8" fill="#66736f">${escapeText(label)}</text>`)
    .join('')

  return `<svg class="chart heatmap" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(title)}"><text x="${pad.left}" y="18" font-size="13" font-weight="700" fill="#17211f">${escapeText(title)}</text>${cells}${xLabels}${yLabels}</svg>`
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function escapeAttr(value: string): string {
  return escapeText(value)
}
