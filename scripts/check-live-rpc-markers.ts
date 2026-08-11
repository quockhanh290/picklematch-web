import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_REF = 'mzqsxgfvtgmsscbqugni';

const FUNCTION_SIGNATURES = [
  {
    name: 'replace_live_session_suggestions_versioned',
    // Pinned by identity because overloads of this name have existed. A null here means "match by name
    // alone", used where no overload has ever shipped.
    identityArgs: 'p_session_id uuid, p_expected_live_state_version bigint, p_matches jsonb, p_replace_court_idxs jsonb, p_replace_all boolean, p_audit_payload jsonb',
  },
  {
    name: 'sync_live_suggestion_hints',
    identityArgs: null,
  },
  {
    name: 'start_live_session_match_versioned',
    identityArgs: 'p_session_id uuid, p_expected_live_state_version bigint, p_match_id uuid, p_audit_payload jsonb',
  },
  {
    name: 'start_live_session_match_from_payload_versioned',
    identityArgs: 'p_session_id uuid, p_expected_live_state_version bigint, p_match jsonb, p_audit_payload jsonb',
  },
] as const;

// Checked against production before being trusted. Two markers taken from the audit's description did
// not survive that check:
//   suggestion_metadata is no longer written by the persist RPC — P1-12 moved it to a dedicated
//     sync_live_suggestion_hints, and 2141 of 2141 rows in the last 30 days carry it. Asserting it on
//     the persist RPC failed on a function that is behaving correctly, so the rule now points at the
//     RPC that actually owns the column.
//   cycle_no has NO writer anywhere in the database (851 of those same 2141 rows still carry a value,
//     all older). That is real, and it is BUG #4's data-loss half — but requiring a writer here would
//     assert an intent nobody has decided on: round_no is per-court since 20260808000001, which is what
//     cycle_no meant, so the column is now redundant rather than broken. Tracked as BUG #39 (its dead
//     reader in live-rounds.ts) instead of guarded here.
const REQUIRED_MARKERS: ReadonlyArray<{ functionName: string; marker: string }> = [
  { functionName: 'sync_live_suggestion_hints', marker: 'suggestion_metadata' },
  { functionName: 'start_live_session_match_versioned', marker: 'is not distinct from' },
  { functionName: 'start_live_session_match_from_payload_versioned', marker: 'is not distinct from' },
];

const FORBIDDEN_MARKERS: ReadonlyArray<{ functionName: string; marker: string }> = [
  { functionName: 'replace_live_session_suggestions_versioned', marker: 'slm.round_no = v_round_no' },
];

export type RpcMarkerRule = 'missing-required-marker' | 'forbidden-marker-present';

export type Violation = {
  functionName: string;
  marker: string;
  rule: RpcMarkerRule;
  message: string;
};

type FunctionDefinitionRow = {
  proname: string;
  definition: string;
};

export function checkRpcMarkers(definitions: Record<string, string>): Violation[] {
  const violations: Violation[] = [];

  for (const { functionName, marker } of REQUIRED_MARKERS) {
    const definition = definitions[functionName] ?? '';
    if (!definition.includes(marker)) {
      violations.push({
        functionName,
        marker,
        rule: 'missing-required-marker',
        message: `${functionName} must contain marker "${marker}"`,
      });
    }
  }

  for (const { functionName, marker } of FORBIDDEN_MARKERS) {
    const definition = definitions[functionName] ?? '';
    if (definition.includes(marker)) {
      violations.push({
        functionName,
        marker,
        rule: 'forbidden-marker-present',
        message: `${functionName} must not contain marker "${marker}"`,
      });
    }
  }

  return violations;
}

async function fetchLiveFunctionDefinitions(): Promise<Record<string, string>> {
  const token = readFileSync(join(homedir(), '.supabase', 'access-token'), 'utf8').trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: buildFunctionDefinitionQuery(),
      read_only: true,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Management API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const rows = parseRows(JSON.parse(text));
  return Object.fromEntries(rows.map((row) => [row.proname, row.definition]));
}

function buildFunctionDefinitionQuery(): string {
  const values = FUNCTION_SIGNATURES.map(
    ({ name, identityArgs }) =>
      `('${name}', ${identityArgs === null ? 'null::text' : `'${identityArgs}'`})`,
  ).join(',\n    ');

  return `
with expected(proname, identity_args) as (
  values
    ${values}
)
select p.proname, pg_get_functiondef(p.oid) as definition
from expected e
left join pg_proc p
  on p.proname = e.proname
 and (e.identity_args is null or pg_get_function_identity_arguments(p.oid) = e.identity_args)
 and p.prokind = 'f'
left join pg_namespace n
  on n.oid = p.pronamespace
 and n.nspname = 'public'
where n.oid is not null
order by p.proname;
`;
}

function parseRows(payload: unknown): FunctionDefinitionRow[] {
  if (Array.isArray(payload)) {
    return payload.filter(isFunctionDefinitionRow);
  }

  if (isRecord(payload)) {
    for (const key of ['data', 'rows', 'result']) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value.filter(isFunctionDefinitionRow);
      }
    }
  }

  throw new Error('Could not parse Supabase database/query response rows');
}

function isFunctionDefinitionRow(value: unknown): value is FunctionDefinitionRow {
  return isRecord(value) && typeof value.proname === 'string' && typeof value.definition === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatViolation(violation: Violation): string {
  return `${violation.functionName}: ${violation.rule} - ${violation.message}`;
}

async function main() {
  const definitions = await fetchLiveFunctionDefinitions();
  const violations = checkRpcMarkers(definitions);

  if (violations.length > 0) {
    console.error('Live RPC marker check failed:');
    for (const violation of violations) {
      console.error(formatViolation(violation));
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Live RPC marker check passed: ${Object.keys(definitions).length} functions checked.`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
