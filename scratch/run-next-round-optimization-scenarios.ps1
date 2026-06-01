param(
  [string]$Label = "before",
  [string]$SessionId = "47cb2127-3193-4613-a642-2ce1b0ecabec",
  [int]$Iterations = 1,
  [int]$BackendIterations = 5,
  [switch]$RunBackend
)

$ErrorActionPreference = "Stop"

function Run-JsonCommand {
  param([string[]]$ArgsList)

  $json = & npx tsx @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: npx tsx $($ArgsList -join ' ')"
  }
  return $json | ConvertFrom-Json
}

function Sum-Field {
  param($Rows, [string]$Field)
  return ($Rows | Measure-Object $Field -Sum).Sum
}

Write-Host "Next Round Optimization Scenario: $Label"
Write-Host "Session: $SessionId"
Write-Host ""

Write-Host "1) Suggest cache parity: real sessions, cached-production"
$real = Run-JsonCommand @(
  "scratch/compare-next-round-benchmark.ts",
  "--multi-session",
  "--sessions", "5",
  "--through-rounds",
  "--summary-only",
  "--iterations", "$Iterations",
  "--candidate-mode", "cached-production"
)

$realRows = foreach ($report in $real.reports) {
  [pscustomobject]@{
    session = $report.sessionId.Substring(0, 8)
    checkpoints = $report.summary.checkpoints
    speedupAvg = $report.summary.speedup.avg
    faster = $report.summary.speedup.experimentalFaster
    scoreBetter = $report.summary.quality.scoreBetter
    scoreSame = $report.summary.quality.scoreSame
    scoreWorse = $report.summary.quality.scoreWorse
    altRegressed = $report.summary.quality.alternativesRegressed
    matchRangeWorse = $report.summary.quality.matchRangeWorse
    partnerWorse = $report.summary.quality.partnerRepeatsWorse
    opponentWorse = $report.summary.quality.opponentRepeatsWorse
    pvnaWorse = $report.summary.quality.pvnaWorse
    genderWorse = $report.summary.quality.genderPenaltyWorse
  }
}

$realRows | Format-Table -AutoSize
[pscustomobject]@{
  label = $Label
  scenario = "suggest-real-cached-production"
  checkpoints = Sum-Field $realRows "checkpoints"
  faster = Sum-Field $realRows "faster"
  scoreBetter = Sum-Field $realRows "scoreBetter"
  scoreSame = Sum-Field $realRows "scoreSame"
  scoreWorse = Sum-Field $realRows "scoreWorse"
  altRegressed = Sum-Field $realRows "altRegressed"
  matchRangeWorse = Sum-Field $realRows "matchRangeWorse"
  partnerWorse = Sum-Field $realRows "partnerWorse"
  opponentWorse = Sum-Field $realRows "opponentWorse"
  pvnaWorse = Sum-Field $realRows "pvnaWorse"
  genderWorse = Sum-Field $realRows "genderWorse"
} | Format-List

Write-Host ""
Write-Host "2) Suggest cache parity: synthetic stress, cached-production"
$synthetic = Run-JsonCommand @(
  "scratch/compare-next-round-synthetic.ts",
  "--seeds", "3",
  "--rounds", "8",
  "--candidate-mode", "cached-production"
)

[pscustomobject]@{
  label = $Label
  scenario = "suggest-synthetic-cached-production"
  checkpoints = $synthetic.summary.checkpoints
  speedupAvg = $synthetic.summary.speedup.avg
  faster = $synthetic.summary.speedup.experimentalFaster
  scoreBetter = $synthetic.summary.quality.scoreBetter
  scoreSame = $synthetic.summary.quality.scoreSame
  scoreWorse = $synthetic.summary.quality.scoreWorse
  altRegressed = $synthetic.summary.quality.alternativesRegressed
  matchRangeWorse = $synthetic.summary.quality.matchRangeWorse
  partnerWorse = $synthetic.summary.quality.partnerRepeatsWorse
  opponentWorse = $synthetic.summary.quality.opponentRepeatsWorse
  pvnaWorse = $synthetic.summary.quality.pvnaWorse
  genderWorse = $synthetic.summary.quality.genderPenaltyWorse
} | Format-List

Write-Host ""
Write-Host "3) Suggest rolling simulation: 50 rounds, independent progression"
$rolling = Run-JsonCommand @(
  "scratch/compare-next-round-rolling.ts",
  "--seeds", "3",
  "--rounds", "50",
  "--summary-only"
)

[pscustomobject]@{
  label = $Label
  scenario = "suggest-rolling-50-cached-production"
  checkpoints = $rolling.summary.checkpoints
  baselineAvgMs = $rolling.summary.timing.baseline.avg
  cachedAvgMs = $rolling.summary.timing.cached.avg
  cachedP95Ms = $rolling.summary.timing.cached.p95
  speedupAvg = $rolling.summary.timing.speedupAvg
  scoreBetter = $rolling.summary.quality.scoreBetter
  scoreSame = $rolling.summary.quality.scoreSame
  scoreWorse = $rolling.summary.quality.scoreWorse
  worstScoreRegression = $rolling.summary.quality.worstScoreRegression
  altRegressed = $rolling.summary.quality.alternativesRegressed
  cachedMissing3Alt = $rolling.summary.quality.cachedMissing3Alt
  matchRangeWorse = $rolling.summary.quality.matchRangeWorse
  partnerWorse = $rolling.summary.quality.partnerRepeatsWorse
  opponentWorse = $rolling.summary.quality.opponentRepeatsWorse
  pvnaWorse = $rolling.summary.quality.pvnaWorse
  groupBonusWorse = $rolling.summary.quality.groupBonusWorse
  groupNewPairsWorse = $rolling.summary.quality.groupNewPairsWorse
  genderWorse = $rolling.summary.quality.genderPenaltyWorse
  sameTopAlternative = $rolling.summary.quality.sameTopAlternative
} | Format-List

if (-not $RunBackend) {
  Write-Host ""
  Write-Host "Backend scenarios skipped. Re-run with -RunBackend to mutate the test session."
  exit 0
}

Write-Host ""
Write-Host "4) Backend current production Edge Function path"
& npx tsx scratch/bench-live-session-flow.ts `
  --mode cycle `
  --yes `
  --session-id $SessionId `
  --courts 6 `
  --iterations $BackendIterations `
  --delay-ms 300 `
  --candidate-mode global `
  --candidate-limit 28
if ($LASTEXITCODE -ne 0) {
  throw "Production backend benchmark failed"
}

Write-Host ""
Write-Host "5) Backend versioned experimental Edge Function path"
& npx tsx scratch/bench-live-round-versioned-rpc.ts `
  --yes `
  --transport edge `
  --session-id $SessionId `
  --courts 6 `
  --iterations $BackendIterations `
  --delay-ms 300
if ($LASTEXITCODE -ne 0) {
  throw "Versioned backend benchmark failed"
}
