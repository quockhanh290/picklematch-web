-- Fix RPC signature mismatch for environments where client calls
-- create_session_with_host without p_price.
-- Keep the original canonical function (with p_price) and add backward-compatible overloads.

create or replace function public.create_session_with_host(
  p_court_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_elo_min integer,
  p_elo_max integer,
  p_is_ranked boolean,
  p_max_players integer,
  p_fill_deadline timestamptz,
  p_total_cost integer,
  p_require_approval boolean,
  p_court_booking_status text,
  p_booking_reference text,
  p_booking_name text,
  p_booking_phone text,
  p_booking_notes text,
  p_booking_confirmed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_session_with_host(
    p_court_id,
    p_start_time,
    p_end_time,
    p_total_cost,
    p_elo_min,
    p_elo_max,
    p_is_ranked,
    p_max_players,
    p_fill_deadline,
    p_total_cost,
    p_require_approval,
    p_court_booking_status,
    p_booking_reference,
    p_booking_name,
    p_booking_phone,
    p_booking_notes,
    p_booking_confirmed_at
  );
end;
$$;

create or replace function public.create_session_with_host(
  p_court_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_elo_min integer,
  p_elo_max integer,
  p_is_ranked boolean,
  p_max_players integer,
  p_fill_deadline timestamptz,
  p_total_cost integer,
  p_require_approval boolean,
  p_court_booking_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_session_with_host(
    p_court_id,
    p_start_time,
    p_end_time,
    p_total_cost,
    p_elo_min,
    p_elo_max,
    p_is_ranked,
    p_max_players,
    p_fill_deadline,
    p_total_cost,
    p_require_approval,
    p_court_booking_status,
    null,
    null,
    null,
    null,
    null
  );
end;
$$;

grant execute on function public.create_session_with_host(
  uuid, timestamptz, timestamptz, integer, integer, boolean, integer, timestamptz, integer, boolean, text, text, text, text, text, timestamptz
) to authenticated;

grant execute on function public.create_session_with_host(
  uuid, timestamptz, timestamptz, integer, integer, boolean, integer, timestamptz, integer, boolean, text
) to authenticated;
