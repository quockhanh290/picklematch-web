-- Sync the board-wide degraded hint fields onto the persisted suggested rows AFTER the edge's
-- board-wide rescue pass has run. The INSERT-time persist (migration 20260803000001) only captures
-- what the fill loop set at persist time — the board-wide pass (which fills rescue_court_idxs for
-- degraded courts and re-evaluates retained lanes) runs afterwards, so its results never reach the
-- DB. Without this, a court can be stored degraded_reason='repeat' with rescue_court_idxs=null and
-- the host "Chờ Sân X" panel (which needs BOTH) never shows on cold load. This updates only rows that
-- actually differ (IS DISTINCT FROM), so a stable board writes nothing. Hint fields only — no
-- live_state_version bump, no CAS: slight staleness is acceptable for an advisory panel.
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
        then e.value -> 'match_explanations' else null end as match_explanations
    from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as e(value)
    where coalesce(e.value ->> 'court_idx', '') ~ '^-?[0-9]+$'
  ) f
  where slm.session_id = p_session_id
    and slm.status = 'suggested'
    and slm.court_idx = f.court_idx
    and (
      slm.degraded_reason is distinct from f.degraded_reason
      or slm.rescue_court_idxs is distinct from f.rescue_court_idxs
      or slm.match_explanations is distinct from f.match_explanations
    );
end;
$$;

revoke all on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_degraded_fields(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
