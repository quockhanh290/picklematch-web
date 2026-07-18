import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { normalizeDump, type Dump } from './verify-suggest-quality'

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function loadRaw(path: string, lineIndex?: number) {
  const text = readFileSync(path, 'utf8').trim()
  if (!path.toLowerCase().endsWith('.jsonl')) return JSON.parse(text)
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) throw new Error(`No JSONL rows in ${path}`)
  const index = lineIndex == null
    ? lines.length - 1
    : lineIndex < 0
      ? lines.length + lineIndex
      : lineIndex
  if (index < 0 || index >= lines.length) throw new Error(`JSONL line index ${lineIndex} is out of range`)
  return JSON.parse(lines[index])
}

function normalizeOracleInput(dump: Dump & Record<string, any>) {
  const busyIds = new Set((dump.busy_player_ids ?? []).map(String))
  const availableCount = dump.players.filter(player =>
    !player.checked_out && !player.opted_rest && !busyIds.has(player.id)
  ).length
  const requestedTarget = Number(
    argument('--courts')
      ?? dump.target_expected_count
      ?? dump.court_count,
  )
  const targetCourts = Math.min(
    Math.max(0, Number.isFinite(requestedTarget) ? Math.floor(requestedTarget) : 0),
    Math.floor(availableCount / 4),
  )
  return {
    session_id: dump.session_id ?? 'offline-dump',
    current_round: dump.current_round,
    court_count: dump.court_count,
    target_courts: targetCourts,
    pvna_tolerance: dump.pvna_tolerance ?? 0.5,
    busy_player_ids: [...busyIds],
    avoid_pairs: dump.avoid_pairs ?? [],
    players: dump.players.map(player => ({
      ...player,
      effective_pvna: (player as any).effective_pvna ?? null,
      quality_debt: Number((player as any).quality_debt ?? 0),
    })),
    engine_matches: (dump.chosen_matches ?? [])
      .filter(match => match.is_replacement !== true)
      .map(match => ({
        court_idx: match.court_idx,
        team_a: match.team_a,
        team_b: match.team_b,
      })),
  }
}

function pythonPath() {
  const explicit = argument('--python')
  if (explicit) return resolve(explicit)
  const localVenv = resolve('tmp/oracle-venv/Scripts/python.exe')
  return existsSync(localVenv) ? localVenv : 'python'
}

const inputArg = argument('--input') ?? process.argv[2]
if (!inputArg || inputArg.startsWith('--')) {
  throw new Error(
    'Usage: npx tsx scripts/diagnostics/solve-session-quality-oracle.ts --input=<dump.json|dump.jsonl> [--line=-1] [--courts=6] [--time-limit=60] [--output=report.json]',
  )
}

const inputPath = resolve(inputArg)
const lineArg = argument('--line')
const lineIndex = lineArg == null ? undefined : Number(lineArg)
const raw = loadRaw(inputPath, Number.isFinite(lineIndex) ? lineIndex : undefined)
const dump = normalizeDump(raw) as Dump & Record<string, any>
if (!Array.isArray(dump.players) || dump.players.length === 0) {
  throw new Error('Dump has no replayable players payload')
}

const workDir = resolve('tmp/quality-oracle')
mkdirSync(workDir, { recursive: true })
const normalizedPath = join(workDir, 'normalized-input.json')
writeFileSync(normalizedPath, JSON.stringify(normalizeOracleInput(dump), null, 2))

const solverPath = resolve('scripts/diagnostics/quality-oracle-solver.py')
const timeLimit = Number(argument('--time-limit') ?? 60)
const workers = Number(argument('--workers') ?? 8)
const result = spawnSync(
  pythonPath(),
  [
    solverPath,
    normalizedPath,
    '--time-limit',
    String(Number.isFinite(timeLimit) ? timeLimit : 60),
    '--workers',
    String(Number.isFinite(workers) ? workers : 8),
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  },
)
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`Oracle solver failed (${result.status}):\n${result.stderr || result.stdout}`)
}

const report = JSON.parse(result.stdout)
const output = argument('--output')
if (output) {
  const outputPath = resolve(output)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report, null, 2))
