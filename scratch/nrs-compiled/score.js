"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreMatch = exports.genderPenalty = void 0;
const INFINITY_SCORE = {
    score: Infinity,
    stats: {
        elo_diff: Infinity,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
    },
};
function emptyStats(eloDiff = 0) {
    return {
        elo_diff: eloDiff,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
    };
}
function getElo(team, state) {
    const players = team.map((playerId) => state.players.get(playerId));
    if (players.some((player) => !player))
        return null;
    return players.reduce((sum, player) => sum + (player?.elo ?? 1000), 0) / 2;
}
function getPartnerRepeats(team, state) {
    return state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0;
}
function getOpponentRepeats(teamA, teamB, state) {
    let total = 0;
    for (const playerA of teamA) {
        for (const playerB of teamB) {
            total += state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0;
        }
    }
    return total;
}
function getGroupedPairCount(players, state) {
    let count = 0;
    for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
            const groupA = state.players.get(players[i])?.group_id;
            const groupB = state.players.get(players[j])?.group_id;
            if (groupA && groupA === groupB)
                count += 1;
        }
    }
    return count;
}
function prefMatchesGender(pref, player) {
    if (pref === 'any')
        return true;
    if (!player?.gender)
        return true;
    return player.gender === pref;
}
function genderPenalty(teamA, teamB, state, weights = state.config.weights) {
    const players = new Map([
        [teamA[0], { partnerId: teamA[1], opponentIds: teamB }],
        [teamA[1], { partnerId: teamA[0], opponentIds: teamB }],
        [teamB[0], { partnerId: teamB[1], opponentIds: teamA }],
        [teamB[1], { partnerId: teamB[0], opponentIds: teamA }],
    ]);
    let penalty = 0;
    for (const [playerId, relations] of players) {
        const player = state.players.get(playerId);
        if (!player)
            continue;
        const partner = state.players.get(relations.partnerId);
        if (!prefMatchesGender(player.partner_gender_pref, partner)) {
            penalty += weights.partner_gender_pref;
        }
        if (player.opponent_gender_pref !== 'any') {
            for (const opponentId of relations.opponentIds) {
                const opponent = state.players.get(opponentId);
                if (!prefMatchesGender(player.opponent_gender_pref, opponent)) {
                    penalty += weights.opponent_gender_pref;
                }
            }
        }
    }
    return penalty;
}
exports.genderPenalty = genderPenalty;
function scoreMatch(teamA, teamB, state, options = {}) {
    const allPlayers = [...teamA, ...teamB];
    const uniquePlayers = new Set(allPlayers);
    if (teamA.length !== 2 || teamB.length !== 2 || uniquePlayers.size !== 4) {
        return INFINITY_SCORE;
    }
    if (allPlayers.some((playerId) => !state.players.has(playerId))) {
        return INFINITY_SCORE;
    }
    const teamAElo = getElo(teamA, state);
    const teamBElo = getElo(teamB, state);
    if (teamAElo === null || teamBElo === null)
        return INFINITY_SCORE;
    const eloDiff = Math.abs(teamAElo - teamBElo);
    const tolerance = options.tolerance ?? state.config.elo_tolerance;
    if (eloDiff > tolerance)
        return INFINITY_SCORE;
    const weights = options.weights ?? state.config.weights;
    const stats = emptyStats(eloDiff);
    stats.partner_repeats = getPartnerRepeats(teamA, state) + getPartnerRepeats(teamB, state);
    stats.opponent_repeats = getOpponentRepeats(teamA, teamB, state);
    stats.group_bonus = getGroupedPairCount(allPlayers, state);
    stats.gender_pref_penalty = genderPenalty(teamA, teamB, state, weights);
    const score = (eloDiff / 50) * weights.elo +
        stats.partner_repeats * weights.partner_repeat +
        stats.opponent_repeats * weights.opponent_repeat -
        stats.group_bonus * weights.group_bonus +
        stats.gender_pref_penalty;
    return {
        score,
        stats,
    };
}
exports.scoreMatch = scoreMatch;
