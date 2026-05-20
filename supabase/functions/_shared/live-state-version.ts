type SupabaseClient = {
  from: (table: string) => any
}

export async function bumpLiveStateVersion(supabase: SupabaseClient, sessionId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: loadError } = await supabase
      .from('sessions')
      .select('live_state_version')
      .eq('id', sessionId)
      .single()

    if (loadError) {
      throw new Error(`Could not load live_state_version: ${loadError.message}`)
    }

    const currentVersion = Number(current?.live_state_version ?? 0)
    const nextVersion = currentVersion + 1
    const { data: updated, error: updateError } = await supabase
      .from('sessions')
      .update({ live_state_version: nextVersion })
      .eq('id', sessionId)
      .eq('live_state_version', currentVersion)
      .select('live_state_version')
      .maybeSingle()

    if (updateError) {
      throw new Error(`Could not bump live_state_version: ${updateError.message}`)
    }
    if (updated) {
      return Number(updated.live_state_version)
    }
  }

  throw new Error('Could not bump live_state_version after concurrent updates')
}
