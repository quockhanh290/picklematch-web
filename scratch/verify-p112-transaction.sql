-- P1-12 verification, inside a transaction that is rolled back.
-- Sets up its own hint state on a real suggested row rather than hunting for a session that happens to
-- have one, so the two claims can be tested deterministically:
--   BUG #25  hints must be CLEARED when the caller reports the row clean
--   BUG #24  a row must NOT be touched when court_idx matches but the teams do not
--
-- Run: paste the migration where marked and send the whole thing as one statement.

begin;

-- ========== paste supabase/migrations/20260809000002_unify_live_suggestion_hint_sync.sql here ==========

create temp table t_out(check_name text, result text) on commit drop;

do $verify$
declare
  v_row public.session_live_matches;
  v_meta jsonb := jsonb_build_object(
    'forced_tradeoff', jsonb_build_object('kind', 'repeat'),
    'wait_rescue_options', '[]'::jsonb
  );
  v_after_clean record;
  v_after_wrong_team record;
begin
  select * into v_row
  from public.session_live_matches
  where status = 'suggested' and court_idx is not null
    and jsonb_array_length(team_a) = 2 and jsonb_array_length(team_b) = 2
  order by created_at desc
  limit 1;

  if v_row.id is null then
    insert into t_out values ('setup', 'NO SUGGESTED ROW AVAILABLE - test inconclusive');
    return;
  end if;

  -- Give the row hints to clear.
  update public.session_live_matches
  set degraded_reason = 'repeat',
      rescue_court_idxs = '[1]'::jsonb,
      match_explanations = '["stale"]'::jsonb,
      suggestion_metadata = coalesce(suggestion_metadata, '{}'::jsonb) || v_meta
  where id = v_row.id;

  -- BUG #25: caller reports this exact row as clean. Every hint key must go.
  perform public.sync_live_suggestion_hints(
    v_row.session_id,
    jsonb_build_array(jsonb_build_object(
      'court_idx', v_row.court_idx,
      'team_a', v_row.team_a,
      'team_b', v_row.team_b,
      'degraded_reason', null,
      'rescue_court_idxs', null,
      'match_explanations', null,
      'suggestion_metadata', '{}'::jsonb
    ))
  );

  select degraded_reason, rescue_court_idxs, match_explanations,
         (suggestion_metadata ? 'forced_tradeoff') as has_forced
  into v_after_clean
  from public.session_live_matches where id = v_row.id;

  insert into t_out values (
    'clean row clears stale hints',
    case when v_after_clean.degraded_reason is null
          and v_after_clean.rescue_court_idxs is null
          and v_after_clean.match_explanations is null
          and v_after_clean.has_forced = false
      then 'PASS' else 'FAIL: ' || coalesce(v_after_clean.degraded_reason, '-')
        || ' forced=' || v_after_clean.has_forced::text end
  );

  -- Put the hints back for the second check.
  update public.session_live_matches
  set degraded_reason = 'repeat',
      match_explanations = '["stale"]'::jsonb,
      suggestion_metadata = coalesce(suggestion_metadata, '{}'::jsonb) || v_meta
  where id = v_row.id;

  -- BUG #24: same court, different teams. The row belongs to someone else now, so it must be left alone.
  perform public.sync_live_suggestion_hints(
    v_row.session_id,
    jsonb_build_array(jsonb_build_object(
      'court_idx', v_row.court_idx,
      'team_a', jsonb_build_array('00000000-0000-0000-0000-000000000001',
                                  '00000000-0000-0000-0000-000000000002'),
      'team_b', jsonb_build_array('00000000-0000-0000-0000-000000000003',
                                  '00000000-0000-0000-0000-000000000004'),
      'degraded_reason', null,
      'rescue_court_idxs', null,
      'match_explanations', null,
      'suggestion_metadata', '{}'::jsonb
    ))
  );

  select degraded_reason, (suggestion_metadata ? 'forced_tradeoff') as has_forced
  into v_after_wrong_team
  from public.session_live_matches where id = v_row.id;

  insert into t_out values (
    'wrong teams on same court leaves row alone',
    case when v_after_wrong_team.degraded_reason = 'repeat' and v_after_wrong_team.has_forced
      then 'PASS' else 'FAIL: hints were overwritten by a non-matching lineup' end
  );
end
$verify$;

select * from t_out;

rollback;
