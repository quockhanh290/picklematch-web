param(
  [Parameter(Mandatory = $false)]
  [string]$SessionId = "967e6682-207d-4d92-aec9-dbe56b54ca2b",

  [Parameter(Mandatory = $false)]
  [string]$OutDir = "",

  [Parameter(Mandatory = $false)]
  [int]$DebugBatchSize = 10,

  [Parameter(Mandatory = $false)]
  [int]$RowBatchSize = 100,

  [Parameter(Mandatory = $false)]
  [switch]$MetadataOnly
)

$ErrorActionPreference = "Stop"

function Load-DotEnv {
  if (-not (Test-Path ".env")) {
    return
  }

  Get-Content ".env" | ForEach-Object {
    if ($_ -match "^\s*([^#=]+?)\s*=\s*(.*)\s*$") {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"')
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }
}

function Invoke-SupabaseJson {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $false)][string]$Label = "query"
  )

  $Sql = ($Sql -replace "\s+", " ").Trim()

  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & npx supabase db query --linked --agent=no -o json $Sql 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }
  if ($exitCode -ne 0) {
    $message = ($output | Out-String).Trim()
    throw "supabase db query failed for [$Label] with exit code $exitCode`nSQL:`n$Sql`n$message"
  }

  $lines = @($output | ForEach-Object { $_.ToString() })
  $startIndex = -1
  $endIndex = -1
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    $trimmed = $lines[$i].TrimStart()
    if ($trimmed.StartsWith("[") -or $trimmed.StartsWith("{")) {
      $startIndex = $i
      break
    }
  }
  for ($i = $lines.Count - 1; $i -ge 0; $i -= 1) {
    $trimmed = $lines[$i].TrimEnd()
    if ($trimmed.EndsWith("]") -or $trimmed.EndsWith("}")) {
      $endIndex = $i
      break
    }
  }

  if ($startIndex -lt 0 -or $endIndex -lt $startIndex) {
    return @()
  }

  $text = ($lines[$startIndex..$endIndex] -join "`n").Trim()
  if (-not $text) {
    return @()
  }

  return @($text | ConvertFrom-Json)
}

function Sql-Literal {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )

  if (
    $null -ne $Value -and
    $Value.PSObject.Properties.Name -contains "value" -and
    $Value.PSObject.Properties.Name -contains "Count"
  ) {
    $Value = $Value.value
  }

  ConvertTo-Json -InputObject $Value -Depth 100 | Set-Content -Encoding UTF8 -LiteralPath $Path
}

function Export-JsonlQuery {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$RowExpression,
    [Parameter(Mandatory = $true)][string]$FromWhere,
    [Parameter(Mandatory = $true)][string]$OrderBy,
    [Parameter(Mandatory = $true)][int]$BatchSize,
    [Parameter(Mandatory = $true)][string]$Path
  )

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path
  }

  $offset = 0
  $written = 0
  while ($true) {
    $sql = "select $RowExpression as row_json $FromWhere $OrderBy limit $BatchSize offset $offset;"
    $rows = Invoke-SupabaseJson $sql
    if ($rows.Count -eq 0) {
      break
    }

    foreach ($row in $rows) {
      $row.row_json | ConvertTo-Json -Depth 100 -Compress | Add-Content -Encoding UTF8 -LiteralPath $Path
      $written += 1
    }

    Write-Host ("{0}: +{1} rows ({2} total)" -f $Name, $rows.Count, $written)
    if ($rows.Count -lt $BatchSize) {
      break
    }
    $offset += $BatchSize
  }

  return $written
}

Load-DotEnv

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw "Missing SUPABASE_ACCESS_TOKEN. Put it in .env or set it in the current shell."
}

if (-not $OutDir) {
  $OutDir = Join-Path "diagnostics/session-replay" $SessionId
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$sessionSql = Sql-Literal $SessionId
$manifest = [ordered]@{
  session_id = $SessionId
  exported_at = (Get-Date).ToUniversalTime().ToString("o")
  files = [ordered]@{}
}

$summarySql = @"
select 'debug_dumps' as table_name, count(*)::int as row_count from public.debug_dumps where session_id = $sessionSql
union all select 'session_audit_events', count(*)::int from public.session_audit_events where session_id = $sessionSql
union all select 'engine_instrumentation', count(*)::int from public.engine_instrumentation where session_id = $sessionSql
union all select 'session_live_matches', count(*)::int from public.session_live_matches where session_id::text = $sessionSql
union all select 'session_player_state', count(*)::int from public.session_player_state where session_id::text = $sessionSql
union all select 'session_rounds', count(*)::int from public.session_rounds where session_id::text = $sessionSql
union all select 'session_pair_history', count(*)::int from public.session_pair_history where session_id::text = $sessionSql;
"@
$summary = Invoke-SupabaseJson $summarySql
Write-JsonFile $summary (Join-Path $OutDir "summary.json")
$manifest.files["summary.json"] = $summary.Count

$debugMetaSql = @"
select
  id,
  created_at,
  decision_source,
  coalesce(jsonb_array_length(chosen_matches), 0) as chosen_matches_count,
  coalesce(jsonb_array_length(rounds), 0) as rounds_count,
  missing_courts,
  payload ? 'selection_debug' as has_selection_debug,
  payload ? 'session_history_snapshot' as has_session_history_snapshot,
  payload ? 'raw_request_body' as has_raw_request_body,
  payload ? 'engine_build' as has_engine_build
from public.debug_dumps
where session_id = $sessionSql
order by created_at, id;
"@
$debugMeta = Invoke-SupabaseJson $debugMetaSql
Write-JsonFile $debugMeta (Join-Path $OutDir "debug_dumps.metadata.json")
$manifest.files["debug_dumps.metadata.json"] = $debugMeta.Count

$auditMetaSql = @"
select
  id,
  created_at,
  event_type,
  edge_function,
  request_id,
  client_request_id,
  client_event_id,
  detail
from public.session_audit_events
where session_id = $sessionSql
order by created_at, id;
"@
$auditMeta = Invoke-SupabaseJson $auditMetaSql
Write-JsonFile $auditMeta (Join-Path $OutDir "session_audit_events.metadata.json")
$manifest.files["session_audit_events.metadata.json"] = $auditMeta.Count

if ($MetadataOnly) {
  foreach ($fileName in @(
    "debug_dumps.jsonl",
    "session_audit_events.jsonl",
    "engine_instrumentation.jsonl",
    "session_live_matches.jsonl",
    "session_player_state.jsonl",
    "session_rounds.jsonl",
    "session_pair_history.jsonl"
  )) {
    $path = Join-Path $OutDir $fileName
    if (Test-Path $path) {
      $manifest.files[$fileName] = (Get-Content -LiteralPath $path | Measure-Object -Line).Lines
    }
  }
  Write-JsonFile $manifest (Join-Path $OutDir "manifest.json")
  Write-Host "Metadata refresh complete: $OutDir"
  exit 0
}

$manifest.files["debug_dumps.jsonl"] = Export-JsonlQuery `
  -Name "debug_dumps" `
  -RowExpression "to_jsonb((select x from (select dd.*) x))" `
  -FromWhere "from public.debug_dumps dd where dd.session_id = $sessionSql" `
  -OrderBy "order by created_at, id" `
  -BatchSize $DebugBatchSize `
  -Path (Join-Path $OutDir "debug_dumps.jsonl")

$manifest.files["session_audit_events.jsonl"] = Export-JsonlQuery `
  -Name "session_audit_events" `
  -RowExpression "to_jsonb((select x from (select sae.*) x))" `
  -FromWhere "from public.session_audit_events sae where sae.session_id = $sessionSql" `
  -OrderBy "order by created_at, id" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "session_audit_events.jsonl")

$manifest.files["engine_instrumentation.jsonl"] = Export-JsonlQuery `
  -Name "engine_instrumentation" `
  -RowExpression "to_jsonb((select x from (select ei.*) x))" `
  -FromWhere "from public.engine_instrumentation ei where ei.session_id = $sessionSql" `
  -OrderBy "order by created_at, id" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "engine_instrumentation.jsonl")

$manifest.files["session_live_matches.jsonl"] = Export-JsonlQuery `
  -Name "session_live_matches" `
  -RowExpression "to_jsonb((select x from (select slm.*) x))" `
  -FromWhere "from public.session_live_matches slm where slm.session_id::text = $sessionSql" `
  -OrderBy "order by created_at, id" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "session_live_matches.jsonl")

$manifest.files["session_player_state.jsonl"] = Export-JsonlQuery `
  -Name "session_player_state" `
  -RowExpression "to_jsonb((select x from (select sps.*) x))" `
  -FromWhere "from public.session_player_state sps where sps.session_id::text = $sessionSql" `
  -OrderBy "order by checked_in_at, player_id" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "session_player_state.jsonl")

$manifest.files["session_rounds.jsonl"] = Export-JsonlQuery `
  -Name "session_rounds" `
  -RowExpression "to_jsonb((select x from (select sr.*) x))" `
  -FromWhere "from public.session_rounds sr where sr.session_id::text = $sessionSql" `
  -OrderBy "order by round_no, created_at, id" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "session_rounds.jsonl")

$manifest.files["session_pair_history.jsonl"] = Export-JsonlQuery `
  -Name "session_pair_history" `
  -RowExpression "to_jsonb((select x from (select sph.*) x))" `
  -FromWhere "from public.session_pair_history sph where sph.session_id::text = $sessionSql" `
  -OrderBy "order by player_a, player_b" `
  -BatchSize $RowBatchSize `
  -Path (Join-Path $OutDir "session_pair_history.jsonl")

Write-JsonFile $manifest (Join-Path $OutDir "manifest.json")
Write-Host "Export complete: $OutDir"
