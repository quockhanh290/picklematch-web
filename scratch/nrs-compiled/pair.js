"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bestPartitioning = exports.bestTeamSplit = void 0;
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
const score_ts_1 = require("./score.js");
const SPLIT_INDEXES = [
    [0, 1, 2, 3],
    [0, 2, 1, 3],
    [0, 3, 1, 2],
];
function bestTeamSplit(players, state) {
    if (players.length !== 4)
        return null;
    let best = null;
    for (const [a1, a2, b1, b2] of SPLIT_INDEXES) {
        const teamA = [players[a1].player_id, players[a2].player_id];
        const teamB = [players[b1].player_id, players[b2].player_id];
        const scored = (0, score_ts_1.scoreMatch)(teamA, teamB, state);
        if (!Number.isFinite(scored.score))
            continue;
        const result = {
            match: {
                court_idx: 0,
                team_a: teamA,
                team_b: teamB,
            },
            score: scored.score,
            stats: scored.stats,
        };
        if (!best || result.score < best.score) {
            best = result;
        }
    }
    return best;
}
exports.bestTeamSplit = bestTeamSplit;
const EXHAUSTIVE_MAX_ITER = 20000;
const SAMPLED_MAX_ITER = 5000;
function addStats(a, b) {
    return {
        elo_diff: a.elo_diff + b.elo_diff,
        partner_repeats: a.partner_repeats + b.partner_repeats,
        opponent_repeats: a.opponent_repeats + b.opponent_repeats,
        group_bonus: a.group_bonus + b.group_bonus,
        gender_pref_penalty: a.gender_pref_penalty + b.gender_pref_penalty,
    };
}
function zeroStats() {
    return {
        elo_diff: 0,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
    };
}
function evaluatePartition(groups, state, iteration) {
    let score = 0;
    let stats = zeroStats();
    const matches = [];
    for (let courtIdx = 0; courtIdx < groups.length; courtIdx += 1) {
        const split = bestTeamSplit(groups[courtIdx], state);
        if (!split)
            return null;
        matches.push({
            ...split.match,
            court_idx: courtIdx,
            score: split.score,
            stats: split.stats,
        });
        score += split.score;
        stats = addStats(stats, split.stats);
    }
    return {
        matches,
        score,
        stats,
        iterations: iteration,
    };
}
function getCombinations(items, size) {
    const result = [];
    function walk(start, selected) {
        if (selected.length === size) {
            result.push([...selected]);
            return;
        }
        for (let i = start; i < items.length; i += 1) {
            selected.push(items[i]);
            walk(i + 1, selected);
            selected.pop();
        }
    }
    walk(0, []);
    return result;
}
function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffled(players, seed) {
    const random = seededRandom(seed);
    const copy = [...players];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const temp = copy[i];
        copy[i] = copy[j];
        copy[j] = temp;
    }
    return copy;
}
function chunkIntoCourts(players) {
    const groups = [];
    for (let i = 0; i < players.length; i += 4) {
        groups.push(players.slice(i, i + 4));
    }
    return groups;
}
function bestPartitioning(players, state, options = {}) {
    if (players.length < 4 || players.length % 4 !== 0)
        return null;
    const normalizedPlayers = [...players].sort((a, b) => a.player_id.localeCompare(b.player_id));
    let best = null;
    let iterations = 0;
    const maxIterations = options.maxIterations ?? (normalizedPlayers.length >= 13 ? SAMPLED_MAX_ITER : EXHAUSTIVE_MAX_ITER);
    function consider(groups) {
        if (iterations >= maxIterations)
            return;
        iterations += 1;
        const result = evaluatePartition(groups, state, iterations);
        if (!result)
            return;
        if (!best || result.score < best.score) {
            best = result;
        }
    }
    if (normalizedPlayers.length <= 12) {
        function walk(remaining, groups) {
            if (iterations >= maxIterations)
                return;
            if (remaining.length === 0) {
                consider(groups);
                return;
            }
            const [anchor, ...rest] = remaining;
            for (const combo of getCombinations(rest, 3)) {
                const comboIds = new Set(combo.map((player) => player.player_id));
                const nextRemaining = rest.filter((player) => !comboIds.has(player.player_id));
                walk(nextRemaining, [...groups, [anchor, ...combo]]);
            }
        }
        walk(normalizedPlayers, []);
        return best;
    }
    consider(chunkIntoCourts(normalizedPlayers));
    const seedBase = hashString(normalizedPlayers.map((player) => player.player_id).join(':'));
    while (iterations < maxIterations) {
        consider(chunkIntoCourts(shuffled(normalizedPlayers, seedBase + iterations)));
    }
    return best;
}
exports.bestPartitioning = bestPartitioning;
