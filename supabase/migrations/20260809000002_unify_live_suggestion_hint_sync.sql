-- P1-12 / BUG #24 + #25: consolidate advisory hint sync into one canonical
-- implementation. Prod read-only evidence was collected with:
--   select p.oid::regprocedure::text, pg_get_functiondef(p.oid) ...
-- against project mzqsxgfvtgmsscbqugni on 2026-08-09.
--
-- Findings:
-- - sync_live_suggestion_degraded_fields already matches by court_idx + teams.
-- - sync_live_suggestion_metadata still matches only by court_idx.
-- - Real prod data showed final_preview_board_lite with no degraded hint keys
--   while the matching suggested row still retained match_explanations.
--
-- Caller contract for the new RPC:
-- - Send every suggested board row, including clean rows, after final board repair.
-- - Include court_idx, team_a, team_b for every row.
-- - Omit/null hint fields on clean rows; this function clears stale advisory keys.

create or replace function public.sync_live_suggestion_hints(
  p_session_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Hint fields must be an array';
  end if;

  -- If the caller has an empty board, remove stale advisory hints from all currently
  -- suggested rows for the session. This is hint-only and does not bump live_state_version.
  if jsonb_array_length(p_fields) = 0 then
    update public.session_live_matches slm
    set degraded_reason = null,
        rescue_court_idxs = null,
        match_explanations = null,
        suggestion_metadata = coalesce(slm.suggestion_metadata, '{}'::jsonb)
          - 'forced_tradeoff'
          - 'wait_rescue_options'
    where slm.session_id = p_session_id
      and slm.status = 'suggested'
      and (
        slm.degraded_reason is not null
        or slm.rescue_court_idxs is not null
        or slm.match_explanations is not null
        or slm.suggestion_metadata ? 'forced_tradeoff'
        or slm.suggestion_metadata ? 'wait_rescue_options'
      );

    return;
  end if;

  update public.session_live_matches slm
  set degraded_reason = f.degraded_reason,
      rescue_court_idxs = f.rescue_court_idxs,
      match_explanations = f.match_explanations,
      suggestion_metadata =
        case
          when f.suggestion_metadata = '{}'::jsonb then
            coalesce(slm.suggestion_metadata, '{}'::jsonb)
              - 'forced_tradeoff'
              - 'wait_rescue_options'
          else
            (coalesce(slm.suggestion_metadata, '{}'::jsonb)
              - 'forced_tradeoff'
              - 'wait_rescue_options')
            || f.suggestion_metadata
        end
  from (
    select
      (e.value ->> 'court_idx')::int as court_idx,
      nullif(e.value ->> 'degraded_reason', '') as degraded_reason,
      case when jsonb_typeof(e.value -> 'rescue_court_idxs') = 'array'
        then e.value -> 'rescue_court_idxs' else null end as rescue_court_idxs,
      case when jsonb_typeof(e.value -> 'match_explanations') = 'array'
        then e.value -> 'match_explanations' else null end as match_explanations,
      case when jsonb_typeof(e.value -> 'suggestion_metadata') = 'object'
        then e.value -> 'suggestion_metadata' else '{}'::jsonb end as suggestion_metadata,
      (select array_agg(x order by x) from jsonb_array_elements_text(e.value -> 'team_a') x) as team_a,
      (select array_agg(x order by x) from jsonb_array_elements_text(e.value -> 'team_b') x) as team_b
    from jsonb_array_elements(p_fields) as e(value)
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
      or coalesce(slm.suggestion_metadata, '{}'::jsonb) is distinct from
        case
          when f.suggestion_metadata = '{}'::jsonb then
            coalesce(slm.suggestion_metadata, '{}'::jsonb)
              - 'forced_tradeoff'
              - 'wait_rescue_options'
          else
            (coalesce(slm.suggestion_metadata, '{}'::jsonb)
              - 'forced_tradeoff'
              - 'wait_rescue_options')
            || f.suggestion_metadata
        end
    );
end;
$$;

revoke all on function public.sync_live_suggestion_hints(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_hints(uuid, jsonb) to authenticated;

-- Compatibility wrappers for already-deployed callers. They intentionally contain no
-- independent match/update logic; the canonical implementation above is the only writer.
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
  perform public.sync_live_suggestion_hints(p_session_id, p_fields);
end;
$$;

revoke all on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) to authenticated;

create or replace function public.sync_live_suggestion_metadata(
  p_session_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_live_suggestion_hints(p_session_id, p_fields);
end;
$$;

revoke all on function public.sync_live_suggestion_metadata(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_metadata(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
