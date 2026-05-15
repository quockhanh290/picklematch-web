"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitCompletedRound = exports.buildPairHistoryUpdates = void 0;
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
const state_ts_1 = require("./state.js");
function clonePlayer(player) {
    return {
        ...player,
        partner_counts: new Map(player.partner_counts),
        opponent_counts: new Map(player.opponent_counts),
    };
}
function getPlayedIds(matches) {
    return new Set(matches.flatMap((match) => [...match.team_a, ...match.team_b]));
}
function incrementPair(pairRows, sessionId, playerA, playerB, field) {
    const [a, b] = (0, state_ts_1.normalizePairKey)(playerA, playerB);
    const key = `${a}:${b}`;
    const row = pairRows.get(key) ??
        {
            session_id: sessionId,
            player_a: a,
            player_b: b,
            partner_count: 0,
            opponent_count: 0,
        };
    row[field] += 1;
    pairRows.set(key, row);
}
function buildPairHistoryUpdates(sessionId, matches, existingRows = []) {
    const pairRows = new Map(existingRows.map((row) => [`${row.player_a}:${row.player_b}`, { ...row }]));
    for (const match of matches) {
        incrementPair(pairRows, sessionId, match.team_a[0], match.team_a[1], 'partner_count');
        incrementPair(pairRows, sessionId, match.team_b[0], match.team_b[1], 'partner_count');
        for (const playerA of match.team_a) {
            for (const playerB of match.team_b) {
                incrementPair(pairRows, sessionId, playerA, playerB, 'opponent_count');
            }
        }
    }
    return [...pairRows.values()].sort((a, b) => {
        const keyA = `${a.player_a}:${a.player_b}`;
        const keyB = `${b.player_a}:${b.player_b}`;
        return keyA.localeCompare(keyB);
    });
}
exports.buildPairHistoryUpdates = buildPairHistoryUpdates;
function commitCompletedRound(state, round, existingPairRows = []) {
    const playedIds = getPlayedIds(round.matches);
    const players = new Map();
    for (const [playerId, player] of state.players) {
        const next = clonePlayer(player);
        if (next.checked_out_at === null) {
            if (playedIds.has(playerId)) {
                next.matches_played += 1;
                next.last_played_round = round.round_no;
                next.consecutive_play += 1;
                next.consecutive_rest = 0;
                next.opted_rest = false;
            }
            else {
                next.consecutive_rest += 1;
                next.consecutive_play = 0;
                next.opted_rest = false;
            }
        }
        players.set(playerId, next);
    }
    const pairHistory = buildPairHistoryUpdates(state.session_id, round.matches, existingPairRows);
    return {
        players,
        pairHistory,
    };
}
exports.commitCompletedRound = commitCompletedRound;
