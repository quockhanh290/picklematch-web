export type SuggesterAuditEventType =
  | 'roster_synced'
  | 'player_checked_in'
  | 'player_checked_out'
  | 'player_rest_changed'
  | 'group_changed'
  | 'round_started'
  | 'round_ended'
  | 'player_swapped_mid_round'

export type SuggesterAuditEventSource = 'engine' | 'host' | 'system'

export async function insertSuggesterAuditEvent(
  supabase: any,
  event: {
    session_id: string
    round_no?: number | null
    event_type: SuggesterAuditEventType
    event_source: SuggesterAuditEventSource
    actor_id?: string | null
    payload?: Record<string, unknown>
  },
): Promise<string | null> {
  const { error } = await supabase
    .from('suggester_decision_events')
    .insert({
      session_id: event.session_id,
      round_no: event.round_no ?? null,
      event_type: event.event_type,
      event_source: event.event_source,
      actor_id: event.actor_id ?? null,
      payload: event.payload ?? {},
    })

  return error?.message ?? null
}
