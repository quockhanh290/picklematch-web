-- Sync the forced-court 3-way decision data (forced_tradeoff + wait_rescue_options) onto persisted
-- suggested rows, into the existing suggestion_metadata jsonb column. The INSERT-time persist RPC does
-- not write suggestion_metadata, and the forced-court computation runs after; without this the host's
-- "Chờ / Chịu lặp / Chịu lệch" panel data never reaches the DB snapshot. Updates only rows that differ
-- (IS DISTINCT FROM). Hint-only: no live_state_version bump, no CAS — slight staleness is fine for an
-- advisory panel, matching sync_live_suggestion_degraded_fields.
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
  -- MERGE (||) rather than wholesale replace, so keys other RPCs write into suggestion_metadata
  -- (e.g. plan_adoption_pending from publish_session_plan_signal_versioned) are preserved.
  update public.session_live_matches slm
  set suggestion_metadata = coalesce(slm.suggestion_metadata, '{}'::jsonb) || f.suggestion_metadata
  from (
    select
      (e.value ->> 'court_idx')::int as court_idx,
      case when jsonb_typeof(e.value -> 'suggestion_metadata') = 'object'
        then e.value -> 'suggestion_metadata' else '{}'::jsonb end as suggestion_metadata
    from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as e(value)
    where coalesce(e.value ->> 'court_idx', '') ~ '^-?[0-9]+$'
  ) f
  where slm.session_id = p_session_id
    and slm.status = 'suggested'
    and slm.court_idx = f.court_idx
    and slm.suggestion_metadata is distinct from
        (coalesce(slm.suggestion_metadata, '{}'::jsonb) || f.suggestion_metadata);
end;
$$;

revoke all on function public.sync_live_suggestion_metadata(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_metadata(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
