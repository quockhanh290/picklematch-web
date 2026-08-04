-- Fix a false-positive introduced by 20260803000002: sync_live_suggestion_degraded_fields matched
-- only on court_idx, but the edge's final_board court can hold a DIFFERENT lineup than the persisted
-- suggested row (a retained lane rebuilt from the client's current_preview_board, which can be stale
-- relative to the DB). Flagging the persisted row with the OTHER lineup's degraded_reason showed a
-- false "Chờ Sân X" panel on a clean lineup (observed: DB [A,B]v[C,D] with 0 repeats got tagged
-- degraded='repeat' from a final_board [A,E]v[F,B]). Require the teams to match (allowing an A/B
-- swap) so a mismatched lineup is left untouched.
create or replace function public.sync_live_suggestion_degraded_fields(
  p_session_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.session_live_matches slm
  set degraded_reason = f.degraded_reason,
      rescue_court_idxs = f.rescue_court_idxs,
      match_explanations = f.match_explanations
  from (
    select
      (e.value ->> 'court_idx')::int as court_idx,
      nullif(e.value ->> 'degraded_reason', '') as degraded_reason,
      case when jsonb_typeof(e.value -> 'rescue_court_idxs') = 'array'
        then e.value -> 'rescue_court_idxs' else null end as rescue_court_idxs,
      case when jsonb_typeof(e.value -> 'match_explanations') = 'array'
        then e.value -> 'match_explanations' else null end as match_explanations,
      (select array_agg(x order by x) from jsonb_array_elements_text(e.value -> 'team_a') x) as team_a,
      (select array_agg(x order by x) from jsonb_array_elements_text(e.value -> 'team_b') x) as team_b
    from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as e(value)
    where coalesce(e.value ->> 'court_idx', '') ~ '^-?[0-9]+$'
      and jsonb_typeof(e.value -> 'team_a') = 'array'
      and jsonb_typeof(e.value -> 'team_b') = 'array'
  ) f
  where slm.session_id = p_session_id
    and slm.status = 'suggested'
    and slm.court_idx = f.court_idx
    and (
      (
        (select array_agg(x order by x) from jsonb_array_elements_text(slm.team_a) x) = f.team_a
        and (select array_agg(x order by x) from jsonb_array_elements_text(slm.team_b) x) = f.team_b
      )
      or (
        (select array_agg(x order by x) from jsonb_array_elements_text(slm.team_a) x) = f.team_b
        and (select array_agg(x order by x) from jsonb_array_elements_text(slm.team_b) x) = f.team_a
      )
    )
    and (
      slm.degraded_reason is distinct from f.degraded_reason
      or slm.rescue_court_idxs is distinct from f.rescue_court_idxs
      or slm.match_explanations is distinct from f.match_explanations
    );
end;
$$;

revoke all on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) to authenticated;

-- One-time cleanup: clear degraded hints on currently-suggested rows for any session so a stale
-- false flag from the court-idx-only sync self-heals immediately (the next suggest re-applies the
-- correct, lineup-matched values). Only touches advisory hint columns.
update public.session_live_matches
set degraded_reason = null, rescue_court_idxs = null, match_explanations = null
where status = 'suggested' and degraded_reason is not null;

notify pgrst, 'reload schema';
