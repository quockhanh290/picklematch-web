import { checkRpcMarkers } from '../../scripts/check-live-rpc-markers';

const REPLACE = 'replace_live_session_suggestions_versioned';
const START = 'start_live_session_match_versioned';
const START_FROM_PAYLOAD = 'start_live_session_match_from_payload_versioned';
const HINTS = 'sync_live_suggestion_hints';

// The rules these fixtures exercise were checked against production before being trusted, and two taken
// from the audit's wording did not survive: suggestion_metadata moved to its own RPC under P1-12, and
// cycle_no has no writer anywhere — deliberately, since round_no became per-court and that is what
// cycle_no meant. The rules changed to match what the database actually does; these fixtures follow.

function cleanDefinitions(): Record<string, string> {
  return {
    [REPLACE]: [
      'create or replace function public.replace_live_session_suggestions_versioned()',
      'returns jsonb',
      'as $function$',
      'insert into public.session_live_matches (round_no, court_idx)',
      "values (v_round_no, (match.value ->> 'court_idx')::int);",
      '$function$;',
    ].join('\n'),
    [START]: [
      'create or replace function public.start_live_session_match_versioned()',
      'returns jsonb',
      'as $function$',
      'where live.round_no = v_match.round_no',
      '  and live.court_idx is not distinct from v_match.court_idx;',
      '$function$;',
    ].join('\n'),
    [START_FROM_PAYLOAD]: [
      'create or replace function public.start_live_session_match_from_payload_versioned()',
      'returns jsonb',
      'as $function$',
      'where slm.round_no = v_round_no',
      '  and slm.court_idx is not distinct from v_court_idx;',
      '$function$;',
    ].join('\n'),
    [HINTS]: [
      'create or replace function public.sync_live_suggestion_hints()',
      'returns void',
      'as $function$',
      'update public.session_live_matches set suggestion_metadata = p_metadata;',
      '$function$;',
    ].join('\n'),
  };
}

describe('checkRpcMarkers', () => {
  // Two cases stood here asserting that the persist RPC is allowed when cycle_no and
  // suggestion_metadata are present. Both became vacuous once those rules were corrected — nothing
  // could make them fail — so they are gone rather than left to certify a rule that no longer exists.
  it('fails when the RPC that owns suggestion_metadata stops writing it', () => {
    const definitions = cleanDefinitions();
    definitions[HINTS] = definitions[HINTS].replace(/suggestion_metadata/g, 'metadata_alias');

    expect(checkRpcMarkers(definitions)).toContainEqual(
      expect.objectContaining({
        functionName: HINTS,
        marker: 'suggestion_metadata',
        rule: 'missing-required-marker',
      }),
    );
  });

  it('passes a database where every rule holds', () => {
    expect(checkRpcMarkers(cleanDefinitions())).toEqual([]);
  });

  it('fails when replace_live_session_suggestions_versioned contains the stale same-round guard', () => {
    const definitions = cleanDefinitions();
    definitions[REPLACE] += '\nand slm.round_no = v_round_no';

    expect(checkRpcMarkers(definitions)).toEqual([
      expect.objectContaining({
        functionName: REPLACE,
        marker: 'slm.round_no = v_round_no',
        rule: 'forbidden-marker-present',
      }),
    ]);
  });

  it('allows replace_live_session_suggestions_versioned when the stale same-round guard is absent', () => {
    expect(checkRpcMarkers(cleanDefinitions())).not.toContainEqual(
      expect.objectContaining({
        functionName: REPLACE,
        marker: 'slm.round_no = v_round_no',
      }),
    );
  });

  it('fails when start_live_session_match_versioned does not scope the guard with is not distinct from', () => {
    const definitions = cleanDefinitions();
    definitions[START] = definitions[START].replace('is not distinct from', '=');

    expect(checkRpcMarkers(definitions)).toEqual([
      expect.objectContaining({
        functionName: START,
        marker: 'is not distinct from',
        rule: 'missing-required-marker',
      }),
    ]);
  });

  it('allows start_live_session_match_versioned when is not distinct from is present', () => {
    expect(checkRpcMarkers(cleanDefinitions())).not.toContainEqual(
      expect.objectContaining({
        functionName: START,
        marker: 'is not distinct from',
      }),
    );
  });

  it('fails when start_live_session_match_from_payload_versioned does not scope the guard with is not distinct from', () => {
    const definitions = cleanDefinitions();
    definitions[START_FROM_PAYLOAD] = definitions[START_FROM_PAYLOAD].replace('is not distinct from', '=');

    expect(checkRpcMarkers(definitions)).toEqual([
      expect.objectContaining({
        functionName: START_FROM_PAYLOAD,
        marker: 'is not distinct from',
        rule: 'missing-required-marker',
      }),
    ]);
  });

  it('allows start_live_session_match_from_payload_versioned when is not distinct from is present', () => {
    expect(checkRpcMarkers(cleanDefinitions())).not.toContainEqual(
      expect.objectContaining({
        functionName: START_FROM_PAYLOAD,
        marker: 'is not distinct from',
      }),
    );
  });
});
