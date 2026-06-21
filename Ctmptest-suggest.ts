import { createClient } from '@supabase/supabase-js'
import { mapRowsToSessionState } from './lib/next-round-suggester/state'
import { suggestNextRound } from './lib/next-round-suggester/suggest'
import { calculateOptimalCourts } from './lib/court-calculator/calculator'

const SUPABASE_URL = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk2Mjg3MiwiZXhwIjoyMDg5NTM4ODcyfQ.bcpigz2zCpUGbvyV1NUlI9sWfiCWy64NOjaQRh8n2Ks'
const SESSION_ID = '6271b4f4-ae62-48d2-ac86-87f26eeba4a3'

async function main() {
  const client = createClient(SUPABASE_URL, KEY)
  const [{ data: playerRows }, { data: pairRows }, { data: settings }] = await Promise.all([
    client.from('session_round_players').select('*, players(pvna,current_elo,elo,gender,partner_gender_pref,opponent_gender_pref), session_players(metadata)').eq('session_id', SESSION_ID).neq('check_in_status', 'cancelled'),
    client.from('session_pair_histories').select('*').eq('session_id', SESSION_ID),
    client.from('session_next_round_settings').select('court_count_override,pvna_tolerance').eq('session_id', SESSION_ID).maybeSingle(),
  ])
  const n = (playerRows as any[])?.filter((r) => r.check_in_status === 'checked_in').length || (playerRows as any[])?.length || 0
  const courts = Number((settings as any)?.court_count_override ?? calculateOptimalCourts({ n_players: n, session_duration_min: 90, match_duration_min: 15, preset: 'balanced' }).recommended.courts)
  const pvna = Number((settings as any)?.pvna_tolerance ?? 0.5)
  const state = mapRowsToSessionState({ sessionId: SESSION_ID, playerRows: playerRows as any ?? [], pairRows: pairRows as any ?? [], roundRows: [], courts, pvnaTolerance: pvna })
  console.log('Courts:', courts, 'Players:', state.players.size, 'PVNA tol:', pvna)
  const result = suggestNextRound(state, {})
  console.log('Alternatives:', result.alternatives.length)
  console.log('Should end:', result.should_end)
  if (result.alternatives.length > 0) {
    const alt = result.alternatives[0]
    console.log('Alt 1:', alt.matches.length, 'courts')
    for (const m of alt.matches) {
      const a = m.team_a.map((id: string) => { const p = state.players.get(id); return `${p?.name}(${p?.pvna?.toFixed(2)})` }).join('+')
      const b = m.team_b.map((id: string) => { const p = state.players.get(id); return `${p?.name}(${p?.pvna?.toFixed(2)})` }).join('+')
      console.log(' ', a, 'vs', b)
    }
  }
}
main().catch(console.error)
