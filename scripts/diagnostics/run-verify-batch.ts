/**
 * Aggregate verify-suggest-quality across a session's debug dump JSONL.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/run-verify-batch.ts <dumps.jsonl>
 */

import { readFileSync } from 'node:fs'
import { analyzeSuggestQuality, normalizeDump } from './verify-suggest-quality.ts'

type BatchTotals = {
  dumps: number
  skipped: number
  engineBoards: number
  engineDeltaSum: number
  worstDelta: number
  missedBetter: number
  engineQualitySkippedPartialPreview: number
  fullBoards: number
  incompleteBoards: number
  restRiskCases: number
  restRiskAvoidable: number
  restRiskUnavoidable: number
  restRiskPriorityMisses: number
  restRiskCapacityDeferred: number
  restRiskSkippedPartialPreview: number
}

function pct(count: number, total: number) {
  if (total === 0) return '0.0%'
  return `${((count / total) * 100).toFixed(1)}%`
}

function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a'
}

function loadJsonl(path: string) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Usage: npx tsx scripts/diagnostics/run-verify-batch.ts <dumps.jsonl>')
    process.exit(1)
  }

  const totals: BatchTotals = {
    dumps: 0,
    skipped: 0,
    engineBoards: 0,
    engineDeltaSum: 0,
    worstDelta: Number.NEGATIVE_INFINITY,
    missedBetter: 0,
    engineQualitySkippedPartialPreview: 0,
    fullBoards: 0,
    incompleteBoards: 0,
    restRiskCases: 0,
    restRiskAvoidable: 0,
    restRiskUnavoidable: 0,
    restRiskPriorityMisses: 0,
    restRiskCapacityDeferred: 0,
    restRiskSkippedPartialPreview: 0,
  }

  for (const [index, line] of loadJsonl(path).entries()) {
    let raw: any
    try {
      raw = JSON.parse(line)
    } catch (error) {
      totals.skipped++
      console.warn(`Skipping line ${index + 1}: invalid JSON`)
      continue
    }

    totals.dumps++
    const dump = normalizeDump(raw)
    const knownMissingCourts = Array.isArray(dump.missing_courts) ? dump.missing_courts : null

    if (!dump.chosen_matches || dump.chosen_matches.length === 0) {
      totals.skipped++
      if (knownMissingCourts) {
        if (knownMissingCourts.length === 0) {
          totals.fullBoards++
        } else {
          totals.incompleteBoards++
        }
      }
      continue
    }

    const analysis = analyzeSuggestQuality(dump)
    if (analysis.engineQualitySkippedReason) totals.engineQualitySkippedPartialPreview++

    for (const board of analysis.engineBoards) {
      if (board.delta === null) continue
      totals.engineBoards++
      totals.engineDeltaSum += board.delta
      totals.worstDelta = Math.max(totals.worstDelta, board.delta)
      if (board.isSuboptimal) totals.missedBetter++
    }

    if (analysis.missingCourts.length === 0) {
      totals.fullBoards++
    } else {
      totals.incompleteBoards++
    }

    totals.restRiskCases += analysis.restRiskCases.length
    if (analysis.restRiskSkippedReason) totals.restRiskSkippedPartialPreview++
    totals.restRiskAvoidable += analysis.restRiskCases.filter(risk => risk.placeable && risk.priorityMiss).length
    totals.restRiskUnavoidable += analysis.restRiskCases.filter(risk => !risk.placeable).length
    totals.restRiskPriorityMisses += analysis.restRiskCases.filter(risk => risk.placeable && risk.priorityMiss).length
    totals.restRiskCapacityDeferred += analysis.restRiskCases.filter(risk => risk.placeable && risk.capacityDeferred).length
  }

  const analyzedBoards = totals.fullBoards + totals.incompleteBoards
  const avgDelta = totals.engineBoards > 0 ? totals.engineDeltaSum / totals.engineBoards : Number.NaN
  const worstDelta = totals.engineBoards > 0 ? totals.worstDelta : Number.NaN

  console.log('VERIFY SUGGEST QUALITY BATCH')
  console.log(`Input: ${path}`)
  console.log(`Dumps read: ${totals.dumps}${totals.skipped > 0 ? ` | quality skipped: ${totals.skipped}` : ''}`)
  console.log('')

  console.log('ENGINE QUALITY (engine_auto, is_replacement=false only)')
  console.log(`Boards analyzed: ${totals.engineBoards}`)
  console.log(`Avg engine_auto delta: ${fmt(avgDelta)}`)
  console.log(`Worst delta: ${fmt(worstDelta)}`)
  console.log(`Missed strictly-better placement: ${totals.missedBetter} (${pct(totals.missedBetter, totals.engineBoards)})`)
  console.log(`Skipped partial-preview dumps: ${totals.engineQualitySkippedPartialPreview}`)
  console.log('')

  console.log('BOARD FILL')
  console.log(`Full boards: ${totals.fullBoards}`)
  console.log(`Incomplete boards: ${totals.incompleteBoards} (${pct(totals.incompleteBoards, analyzedBoards)})`)
  console.log('')

  console.log('REST-FAIRNESS (slot-aware; PRE-F2 DATA if dumps predate 4816522)')
  console.log(`Total rest-risk cases: ${totals.restRiskCases}`)
  console.log(`Priority misses: ${totals.restRiskPriorityMisses}`)
  console.log(`Capacity-deferred: ${totals.restRiskCapacityDeferred}`)
  console.log(`Unavoidable: ${totals.restRiskUnavoidable}`)
  console.log(`Skipped partial-preview dumps: ${totals.restRiskSkippedPartialPreview}`)
}

main()
