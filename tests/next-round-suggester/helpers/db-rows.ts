/**
 * Serialize a SessionState (produced by simulation) into the DB row format
 * that mapRowsToSessionState() consumes in production.
 *
 * This lets benchmarks run the full production ingestion chain
 * (mapRowsToSessionState → correctForFairness → suggestNextRound → post-processing)
 * on top of realistic warm states built by the simulation runner.
 */

import type {
  SessionLiveMatchRow,
  SessionPairHistoryRow,
  SessionPlayerStateRow,
  SessionRoundRow,
  SessionState,
} from '../../../lib/next-round-suggester/types'

export type DbRows = {
  playerRows: SessionPlayerStateRow[]
  pairRows: SessionPairHistoryRow[]
  roundRows: SessionRoundRow[]
  liveMatchRows: SessionLiveMatchRow[]
}

/**
 * Convert a fully-warmed SessionState into the same DB row shapes that the
 * production Supabase query returns. Round history is emitted as both
 * legacy roundRows (simulating session_rounds table) AND as liveMatchRows
 * (simulating session_live_matches) so that buildCompletedLiveCycleRows can
 * exercise its full path.
 */
export function serializeStateToDbRows(state: SessionState): DbRows {
  const sessionId = state.session_id

  // ── player rows ──────────────────────────────────────────────────────────
  const playerRows: SessionPlayerStateRow[] = [...state.players.values()].map(player => ({
    session_id: sessionId,
    player_id: player.player_id,
    group_id: player.group_id,
    checked_in_at: player.checked_in_at.toISOString(),
    checked_out_at: player.checked_out_at?.toISOString() ?? null,
    matches_played: player.matches_played,
    last_played_round: player.last_played_round,
    consecutive_rest: player.consecutive_rest,
    consecutive_play: player.consecutive_play,
    opted_rest: player.opted_rest,
    effective_pvna: player.effective_pvna ?? null,
    players: {
      pvna: player.pvna,
      elo: null,
      current_elo: null,
      gender: player.gender,
      partner_gender_pref: player.partner_gender_pref,
      opponent_gender_pref: player.opponent_gender_pref,
    },
    session_players: {
      metadata: null,
    },
  }))

  // ── pair history rows ─────────────────────────────────────────────────────
  // Collect unique pairs from all players (each pair stored once, player_a < player_b).
  const pairMap = new Map<string, SessionPairHistoryRow>()
  for (const player of state.players.values()) {
    for (const [otherId, partnerCount] of player.partner_counts.entries()) {
      const [a, b] = player.player_id < otherId
        ? [player.player_id, otherId]
        : [otherId, player.player_id]
      const key = `${a}:${b}`
      if (pairMap.has(key)) continue
      const opponentCount = player.opponent_counts.get(otherId) ?? 0
      pairMap.set(key, {
        session_id: sessionId,
        player_a: a,
        player_b: b,
        partner_count: partnerCount,
        opponent_count: opponentCount,
      })
    }
    // Opponent-only pairs (played against but never partnered)
    for (const [otherId, opponentCount] of player.opponent_counts.entries()) {
      const [a, b] = player.player_id < otherId
        ? [player.player_id, otherId]
        : [otherId, player.player_id]
      const key = `${a}:${b}`
      if (pairMap.has(key)) continue
      pairMap.set(key, {
        session_id: sessionId,
        player_a: a,
        player_b: b,
        partner_count: 0,
        opponent_count: opponentCount,
      })
    }
  }
  const pairRows = [...pairMap.values()]

  // ── round rows (legacy session_rounds table) ──────────────────────────────
  const completedRounds = state.rounds.filter(r => r.status === 'completed')
  const roundRows: SessionRoundRow[] = completedRounds.map(round => ({
    id: `round-${round.round_no}`,
    session_id: sessionId,
    round_no: round.round_no,
    status: round.status,
    matches: round.matches,
    resting: round.resting,
    started_at: round.started_at?.toISOString() ?? null,
    ended_at: round.ended_at?.toISOString() ?? null,
  }))

  // ── live match rows (session_live_matches table) ──────────────────────────
  // Emit each individual match as a completed live-match row. The sequence_no
  // increments globally so buildCompletedLiveCycleRows can group them into
  // logical rounds using court_idx / sequence_no.
  let seqNo = 0
  const liveMatchRows: SessionLiveMatchRow[] = []
  for (const round of completedRounds) {
    for (const match of round.matches) {
      const startedAt = round.started_at?.toISOString() ?? new Date().toISOString()
      const endedAt = round.ended_at?.toISOString() ?? new Date().toISOString()
      liveMatchRows.push({
        id: `live-r${round.round_no}-c${match.court_idx ?? seqNo}`,
        session_id: sessionId,
        sequence_no: seqNo++,
        round_no: round.round_no,
        court_idx: match.court_idx ?? 0,
        status: 'completed',
        team_a: match.team_a,
        team_b: match.team_b,
        resting: round.resting,
        score_a: 0,
        score_b: 0,
        suggested_at: startedAt,
        started_at: startedAt,
        ended_at: endedAt,
      })
    }
  }

  return { playerRows, pairRows, roundRows, liveMatchRows }
}

/**
 * Compute a fingerprint string identical to the one computed by rowsFingerprint
 * in useNextRoundModel. Measures the real cost of that computation.
 */
export function computeRowsFingerprint(
  rows: DbRows,
  liveStateVersion: number | null,
): string {
  const players = rows.playerRows
    .map(r =>
      `${r.player_id}|${r.matches_played}|${r.last_played_round}|${r.consecutive_play}|${r.consecutive_rest}|${r.opted_rest ? 1 : 0}|${r.checked_out_at ?? ''}|${r.group_id ?? ''}|${r.players?.pvna ?? 0}|${r.effective_pvna ?? ''}|${r.players?.gender ?? ''}|${r.players?.partner_gender_pref ?? ''}|${r.players?.opponent_gender_pref ?? ''}`,
    )
    .sort()
    .join(';')

  const pairs = rows.pairRows
    .map(r => `${r.player_a}|${r.player_b}|${r.partner_count}|${r.opponent_count}`)
    .sort()
    .join(';')

  const rounds = rows.roundRows
    .map(r => `${r.round_no}|${r.status}|${JSON.stringify(r.matches)}|${JSON.stringify(r.resting ?? [])}`)
    .join(';')

  const live = rows.liveMatchRows
    .map(r =>
      `${r.id}|${r.sequence_no}|${r.status}|${r.score_a}|${r.score_b}|${JSON.stringify(r.team_a)}|${JSON.stringify(r.team_b)}|${JSON.stringify(r.resting ?? [])}`,
    )
    .join(';')

  return `${liveStateVersion ?? 'noversion'}__${players}__${pairs}__${rounds}__${live}`
}
