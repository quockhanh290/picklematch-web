import { buildSuggestedMatchPayloads } from '../lib/next-round-suggester/live-preview.ts'

const state = {
  session_id: 'test',
  status: 'active',
  current_round: 1,
  config: { courts: 1, pvna_tolerance: 1.5, weights: { pvna: 1, partner_repeat: 1, opponent_repeat: 1, group_bonus: 1, partner_gender_pref: 1, opponent_gender_pref: 1 } },
  players: new Map(),
  rounds: []
}

// Add 4 players
const players = ['p1', 'p2', 'p3', 'p4']
for (const p of players) {
  state.players.set(p, {
    player_id: p,
    pvna: 3.0,
    group_id: null,
    checked_in_at: new Date(),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: 0,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: 'M',
    partner_gender_pref: 'any',
    opponent_gender_pref: 'any',
  })
}

const payloads = buildSuggestedMatchPayloads({
  count: 1,
  sessionId: 'test',
  courtCount: 1,
  state: state,
  rows: { liveMatchRows: [] },
  completingLiveMatchIds: new Set(),
  fairnessAdjustment: { tier_overrides: {}, applied_for_warnings: [] },
  fairnessWarnings: [],
  playersById: new Map(players.map(p => [p, { name: p }])),
  pvnaTolerance: 1.5,
})

console.log('Payloads:', JSON.stringify(payloads, null, 2))
