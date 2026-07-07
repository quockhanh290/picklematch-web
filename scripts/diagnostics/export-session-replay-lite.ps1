param(
  [Parameter(Mandatory = $false)]
  [string]$SessionId = "",

  [Parameter(Mandatory = $false)]
  [switch]$Latest,

  [Parameter(Mandatory = $false)]
  [int]$SinceHours = 24,

  [Parameter(Mandatory = $false)]
  [string]$OutDir = "",

  [Parameter(Mandatory = $false)]
  [int]$BatchSize = 500
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

  ConvertTo-Json -InputObject $Value -Depth 100 | Set-Content -Encoding UTF8 -LiteralPath $Path
}

function Resolve-LatestSessionId {
  param([Parameter(Mandatory = $true)][int]$Hours)

  $hoursValue = [Math]::Max(1, $Hours)
  $latestSql = @"
select
  session_id,
  max(created_at) as latest_dump_at,
  count(*)::int as dump_count
from public.debug_dumps
where created_at >= now() - make_interval(hours => $hoursValue)
group by session_id
order by latest_dump_at desc
limit 1;
"@

  $rows = Invoke-SupabaseJson $latestSql "latest-debug-dump-session"
  if ($rows.Count -eq 0) {
    throw "No debug_dumps rows found in the last $hoursValue hours."
  }

  $latest = $rows[0]
  Write-Host ("Latest dump session: {0} at {1} ({2} dumps in last {3}h)" -f $latest.session_id, $latest.latest_dump_at, $latest.dump_count, $hoursValue)
  return [string]$latest.session_id
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
    $rows = Invoke-SupabaseJson $sql $Name
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

if ($Latest) {
  $SessionId = Resolve-LatestSessionId $SinceHours
}

if (-not $SessionId) {
  throw "Pass -SessionId <uuid> or use -Latest."
}

if (-not $OutDir) {
  $OutDir = Join-Path "diagnostics/session-replay-lite" $SessionId
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$sessionSql = Sql-Literal $SessionId
$manifest = [ordered]@{
  session_id = $SessionId
  exported_at = (Get-Date).ToUniversalTime().ToString("o")
  mode = "lite"
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
$summary = Invoke-SupabaseJson $summarySql "summary"
Write-JsonFile $summary (Join-Path $OutDir "summary.json")
$manifest.files["summary.json"] = $summary.Count

$manifest.files["debug_dumps.lite.jsonl"] = Export-JsonlQuery `
  -Name "debug_dumps_lite" `
  -RowExpression "jsonb_build_object('id', dd.id, 'created_at', dd.created_at, 'session_id', dd.session_id, 'decision_source', dd.decision_source, 'missing_courts', dd.missing_courts, 'missing_open_courts', coalesce(dd.payload->'missing_open_courts', dd.missing_courts), 'missing_target_courts', coalesce(dd.payload->'missing_target_courts', '[]'::jsonb), 'partial_full_board_request', coalesce((dd.payload->>'partial_full_board_request')::boolean, false), 'target_count_shortfall', coalesce((dd.payload->>'target_count_shortfall')::int, 0), 'target_expected_count', coalesce((dd.payload->>'target_expected_count')::int, null), 'filled_target_count', coalesce((dd.payload->>'filled_target_count')::int, null), 'chosen_matches_count', coalesce(jsonb_array_length(dd.chosen_matches), 0), 'rounds_count', coalesce(jsonb_array_length(dd.rounds), 0), 'payload_bytes', pg_column_size(dd.payload), 'chosen_matches_bytes', pg_column_size(dd.chosen_matches), 'rounds_bytes', pg_column_size(dd.rounds), 'payload_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(dd.payload) as key), 'client_request_id', dd.payload->>'client_request_id', 'suggestion_request_id', dd.payload->>'suggestion_request_id', 'current_round', coalesce(dd.payload->>'current_round', dd.payload#>>'{derived_state_summary,current_round}'), 'court_count', dd.payload->>'court_count', 'selection_debug_count', coalesce(jsonb_array_length(dd.payload->'selection_debug'), 0), 'raw_payloads_before_final_board_count', coalesce(jsonb_array_length(dd.payload->'raw_payloads_before_final_board'), 0), 'final_preview_board_count', coalesce(jsonb_array_length(dd.payload->'final_preview_board'), 0), 'live_match_rows_count', coalesce(jsonb_array_length(dd.payload->'live_match_rows'), 0), 'busy_player_ids_count', coalesce(jsonb_array_length(dd.payload->'busy_player_ids'), 0))" `
  -FromWhere "from public.debug_dumps dd where dd.session_id = $sessionSql" `
  -OrderBy "order by dd.created_at, dd.id" `
  -BatchSize $BatchSize `
  -Path (Join-Path $OutDir "debug_dumps.lite.jsonl")

$manifest.files["session_audit_events.lite.jsonl"] = Export-JsonlQuery `
  -Name "session_audit_events_lite" `
  -RowExpression "jsonb_build_object('id', sae.id, 'created_at', sae.created_at, 'session_id', sae.session_id, 'event_type', sae.event_type, 'edge_function', sae.edge_function, 'request_id', sae.request_id, 'client_request_id', sae.client_request_id, 'client_event_id', sae.client_event_id, 'request_payload_bytes', pg_column_size(sae.request_payload), 'response_payload_bytes', pg_column_size(sae.response_payload), 'detail_bytes', pg_column_size(sae.detail), 'request_payload_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(sae.request_payload) as key), 'response_payload_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(sae.response_payload) as key), 'detail_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(sae.detail) as key), 'timing_ms', sae.detail->'timing_ms', 'error', coalesce(sae.detail->>'error', sae.response_payload->>'error'))" `
  -FromWhere "from public.session_audit_events sae where sae.session_id = $sessionSql" `
  -OrderBy "order by sae.created_at, sae.id" `
  -BatchSize $BatchSize `
  -Path (Join-Path $OutDir "session_audit_events.lite.jsonl")

$manifest.files["engine_instrumentation.lite.jsonl"] = Export-JsonlQuery `
  -Name "engine_instrumentation_lite" `
  -RowExpression "jsonb_build_object('id', ei.id, 'created_at', ei.created_at, 'session_id', ei.session_id, 'event', ei.event, 'detail', ei.detail, 'court_count', ei.court_count, 'available', ei.available)" `
  -FromWhere "from public.engine_instrumentation ei where ei.session_id = $sessionSql" `
  -OrderBy "order by ei.created_at, ei.id" `
  -BatchSize $BatchSize `
  -Path (Join-Path $OutDir "engine_instrumentation.lite.jsonl")

Write-JsonFile $manifest (Join-Path $OutDir "manifest.json")
Write-Host "Lite export complete: $OutDir"
