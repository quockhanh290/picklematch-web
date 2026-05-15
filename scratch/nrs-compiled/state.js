"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRestPatch = exports.buildCheckoutPatch = exports.buildCheckInPatch = exports.loadSessionState = exports.mapRowsToSessionState = exports.isPresent = exports.deriveGroupId = exports.normalizePairKey = exports.DEFAULT_SCORING_WEIGHTS = void 0;
exports.DEFAULT_SCORING_WEIGHTS = {
    elo: 1,
    partner_repeat: 3,
    opponent_repeat: 1.5,
    group_bonus: 0.5,
    partner_gender_pref: 4,
    opponent_gender_pref: 2,
};
function normalizeGender(value) {
    const gender = String(value ?? '').trim().toLowerCase();
    if (gender === 'm' || gender === 'male' || gender === 'nam')
        return 'M';
    if (gender === 'f' || gender === 'female' || gender === 'ná»¯' || gender === 'nu')
        return 'F';
    return null;
}
function normalizeGenderPreference(value) {
    const pref = String(value ?? '').trim().toLowerCase();
    if (pref === 'm' || pref === 'male' || pref === 'nam')
        return 'M';
    if (pref === 'f' || pref === 'female' || pref === 'ná»¯' || pref === 'nu')
        return 'F';
    return 'any';
}
function getMetadataPref(metadata, key) {
    return metadata && Object.prototype.hasOwnProperty.call(metadata, key) ? metadata[key] : undefined;
}
function normalizePairKey(playerA, playerB) {
    if (playerA === playerB) {
        throw new Error('Pair must contain two different players');
    }
    return playerA < playerB ? [playerA, playerB] : [playerB, playerA];
}
exports.normalizePairKey = normalizePairKey;
function deriveGroupId(sessionId, playerIds) {
    const normalized = [...new Set(playerIds)].sort().join(':');
    return `${sessionId}:${normalized}`;
}
exports.deriveGroupId = deriveGroupId;
function isPresent(player) {
    return player.checked_out_at === null;
}
exports.isPresent = isPresent;
function mapRowsToSessionState(input) {
    const players = new Map();
    const preferencesByPlayerId = new Map((input.preferenceRows ?? []).map((row) => [row.player_id, row]));
    for (const row of input.playerRows) {
        const preferenceRow = preferencesByPlayerId.get(row.player_id);
        const metadata = row.session_players?.metadata ?? preferenceRow?.metadata;
        const profile = preferenceRow?.players ?? row.players;
        players.set(row.player_id, {
            player_id: row.player_id,
            elo: profile?.elo ?? 1000,
            group_id: row.group_id,
            checked_in_at: new Date(row.checked_in_at),
            checked_out_at: row.checked_out_at ? new Date(row.checked_out_at) : null,
            matches_played: row.matches_played,
            last_played_round: row.last_played_round,
            consecutive_rest: row.consecutive_rest,
            consecutive_play: row.consecutive_play,
            partner_counts: new Map(),
            opponent_counts: new Map(),
            opted_rest: row.opted_rest,
            gender: normalizeGender(profile?.gender),
            partner_gender_pref: normalizeGenderPreference(getMetadataPref(metadata, 'partner_gender_pref') ?? profile?.partner_gender_pref),
            opponent_gender_pref: normalizeGenderPreference(getMetadataPref(metadata, 'opponent_gender_pref') ?? profile?.opponent_gender_pref),
        });
    }
    for (const row of input.pairRows) {
        const playerA = players.get(row.player_a);
        const playerB = players.get(row.player_b);
        if (playerA) {
            playerA.partner_counts.set(row.player_b, row.partner_count);
            playerA.opponent_counts.set(row.player_b, row.opponent_count);
        }
        if (playerB) {
            playerB.partner_counts.set(row.player_a, row.partner_count);
            playerB.opponent_counts.set(row.player_a, row.opponent_count);
        }
    }
    const rounds = input.roundRows.map((row) => ({
        id: row.id,
        session_id: row.session_id,
        round_no: row.round_no,
        status: row.status,
        matches: row.matches,
        resting: row.resting,
        started_at: row.started_at ? new Date(row.started_at) : null,
        ended_at: row.ended_at ? new Date(row.ended_at) : null,
    }));
    const currentRound = rounds.reduce((max, round) => Math.max(max, round.round_no), -1) + 1;
    return {
        session_id: input.sessionId,
        current_round: currentRound,
        status: rounds.some((round) => round.status === 'active') ? 'active' : 'waiting',
        config: {
            courts: input.courts ?? 1,
            elo_tolerance: input.eloTolerance ?? 150,
            weights: exports.DEFAULT_SCORING_WEIGHTS,
        },
        players,
        rounds,
    };
}
exports.mapRowsToSessionState = mapRowsToSessionState;
async function loadSessionState(supabase, sessionId, options = {}) {
    const [playersResult, pairsResult, roundsResult] = await Promise.all([
        supabase
            .from('session_player_state')
            .select('*, players(elo, gender, partner_gender_pref, opponent_gender_pref)')
            .eq('session_id', sessionId)
            .order('checked_in_at', { ascending: true }),
        supabase
            .from('session_pair_history')
            .select('*')
            .eq('session_id', sessionId)
            .order('player_a', { ascending: true }),
        supabase
            .from('session_rounds')
            .select('*')
            .eq('session_id', sessionId)
            .order('round_no', { ascending: true }),
    ]);
    const error = playersResult.error ?? pairsResult.error ?? roundsResult.error;
    if (error) {
        throw new Error(error.message);
    }
    const playerIds = (playersResult.data ?? []).map((row) => row.player_id);
    let preferenceRows = [];
    if (playerIds.length > 0) {
        const preferenceResult = await supabase
            .from('session_players')
            .select('player_id, metadata, players(elo, gender, partner_gender_pref, opponent_gender_pref)')
            .eq('session_id', sessionId)
            .order('player_id', { ascending: true });
        if (preferenceResult.error) {
            throw new Error(preferenceResult.error.message);
        }
        preferenceRows = preferenceResult.data ?? [];
    }
    return mapRowsToSessionState({
        sessionId,
        playerRows: playersResult.data ?? [],
        pairRows: pairsResult.data ?? [],
        roundRows: roundsResult.data ?? [],
        preferenceRows,
        courts: options.courts,
        eloTolerance: options.eloTolerance,
    });
}
exports.loadSessionState = loadSessionState;
function buildCheckInPatch(sessionId, request, now) {
    const groupMembers = [request.player_id, ...(request.group_with ?? [])];
    const groupId = groupMembers.length > 1 ? deriveGroupId(sessionId, groupMembers) : null;
    return {
        session_id: sessionId,
        player_id: request.player_id,
        group_id: groupId,
        checked_in_at: now.toISOString(),
        checked_out_at: null,
        matches_played: 0,
        last_played_round: -1,
        consecutive_rest: 0,
        consecutive_play: 0,
        opted_rest: false,
    };
}
exports.buildCheckInPatch = buildCheckInPatch;
function buildCheckoutPatch(request, now) {
    return {
        player_id: request.player_id,
        checked_out_at: now.toISOString(),
        opted_rest: false,
    };
}
exports.buildCheckoutPatch = buildCheckoutPatch;
function buildRestPatch(request) {
    return {
        player_id: request.player_id,
        opted_rest: request.opted_rest,
    };
}
exports.buildRestPatch = buildRestPatch;
