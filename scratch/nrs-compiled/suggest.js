"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmptySuggestion = exports.suggestNextRound = exports.detectGenderConflicts = void 0;
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
const pair_ts_1 = require("./pair.js");
// @ts-ignore Node's strip-only test runner needs the local .ts extension.
const select_ts_1 = require("./select.js");
function combinationKey(players) {
    return players.map((player) => player.player_id).sort().join(':');
}
class CandidateHeap {
    constructor() {
        this.items = [];
    }
    get length() {
        return this.items.length;
    }
    push(candidate) {
        this.items.push(candidate);
        this.bubbleUp(this.items.length - 1);
    }
    pop() {
        if (this.items.length === 0)
            return null;
        const result = this.items[0];
        const last = this.items.pop();
        if (last && this.items.length > 0) {
            this.items[0] = last;
            this.sinkDown(0);
        }
        return result;
    }
    compare(a, b) {
        if (a.priority !== b.priority)
            return a.priority - b.priority;
        return a.key.localeCompare(b.key);
    }
    bubbleUp(index) {
        let current = index;
        while (current > 0) {
            const parent = Math.floor((current - 1) / 2);
            if (this.compare(this.items[current], this.items[parent]) >= 0)
                break;
            const temp = this.items[current];
            this.items[current] = this.items[parent];
            this.items[parent] = temp;
            current = parent;
        }
    }
    sinkDown(index) {
        let current = index;
        while (true) {
            const left = current * 2 + 1;
            const right = left + 1;
            let smallest = current;
            if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
                smallest = left;
            }
            if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
                smallest = right;
            }
            if (smallest === current)
                break;
            const temp = this.items[current];
            this.items[current] = this.items[smallest];
            this.items[smallest] = temp;
            current = smallest;
        }
    }
}
function makeCandidate(players, indexes) {
    const selected = indexes.map((index) => players[index]);
    return {
        indexes,
        players: selected,
        priority: indexes.reduce((sum, index) => sum + index, 0),
        key: combinationKey(selected),
    };
}
function getPriorityCandidates(players, size, limit) {
    if (size > players.length || size <= 0 || limit <= 0)
        return [];
    const initialIndexes = Array.from({ length: size }, (_, index) => index);
    const heap = new CandidateHeap();
    const queued = new Set();
    const result = [];
    heap.push(makeCandidate(players, initialIndexes));
    queued.add(initialIndexes.join(':'));
    while (heap.length > 0 && result.length < limit) {
        const candidate = heap.pop();
        if (!candidate)
            break;
        result.push(candidate);
        for (let position = size - 1; position >= 0; position -= 1) {
            const nextIndexes = [...candidate.indexes];
            const nextValue = nextIndexes[position] + 1;
            const upperBound = position === size - 1 ? players.length : nextIndexes[position + 1];
            if (nextValue >= upperBound)
                continue;
            nextIndexes[position] = nextValue;
            const key = nextIndexes.join(':');
            if (queued.has(key))
                continue;
            heap.push(makeCandidate(players, nextIndexes));
            queued.add(key);
        }
    }
    return result;
}
function emptyStats() {
    return {
        elo_diff: 0,
        partner_repeats: 0,
        opponent_repeats: 0,
        group_bonus: 0,
        gender_pref_penalty: 0,
    };
}
const MAX_CANDIDATES_PER_STRATEGY = 250;
function detectGenderConflicts(players) {
    const counts = {
        M: players.filter((player) => player.gender === 'M').length,
        F: players.filter((player) => player.gender === 'F').length,
    };
    const warnings = [];
    const wantFemalePartner = players.filter((player) => player.partner_gender_pref === 'F').length;
    const wantMalePartner = players.filter((player) => player.partner_gender_pref === 'M').length;
    if (wantFemalePartner > counts.F * 2) {
        warnings.push(`${wantFemalePartner} ngÆ°á»i muá»‘n partner ná»¯ nhÆ°ng chá»‰ cÃ³ ${counts.F} ná»¯`);
    }
    if (wantMalePartner > counts.M * 2) {
        warnings.push(`${wantMalePartner} ngÆ°á»i muá»‘n partner nam nhÆ°ng chá»‰ cÃ³ ${counts.M} nam`);
    }
    return warnings;
}
exports.detectGenderConflicts = detectGenderConflicts;
function makeAlternative(selected, allPresent, state, warnings) {
    const startedAt = Date.now();
    const partition = (0, pair_ts_1.bestPartitioning)(selected, state);
    if (!partition)
        return null;
    const selectedIds = new Set(selected.map((player) => player.player_id));
    const resting = allPresent
        .filter((player) => !selectedIds.has(player.player_id))
        .map((player) => player.player_id)
        .sort();
    return {
        matches: partition.matches,
        resting,
        score: partition.score,
        warnings,
        stats: partition.stats,
        runtime_ms: Date.now() - startedAt,
        iterations: partition.iterations,
    };
}
function suggestNextRound(state) {
    const presentPlayers = (0, select_ts_1.getPresentPlayers)(state);
    const eligiblePlayers = presentPlayers.filter((player) => !player.opted_rest);
    const courtCapacity = Math.max(1, state.config.courts) * 4;
    const slots = Math.min(courtCapacity, Math.floor(eligiblePlayers.length / 4) * 4);
    const basePick = (0, select_ts_1.pickPlayers)(state, Math.max(4, slots));
    const warnings = [...basePick.warnings, ...detectGenderConflicts(eligiblePlayers)];
    if (slots < 4) {
        return {
            alternatives: [],
            warnings,
            should_end: true,
        };
    }
    if (slots < courtCapacity) {
        warnings.push('PARTIAL_COURTS');
    }
    const alternatives = [];
    const seen = new Set();
    const strategies = ['fairness', 'rest', 'diversity'];
    for (const strategy of strategies) {
        const sorted = (0, select_ts_1.sortPlayersForStrategy)(eligiblePlayers, strategy);
        const candidates = getPriorityCandidates(sorted, slots, MAX_CANDIDATES_PER_STRATEGY);
        for (const candidate of candidates) {
            const key = combinationKey(candidate.players);
            if (seen.has(key))
                continue;
            const alternative = makeAlternative(candidate.players, presentPlayers, state, warnings);
            if (!alternative)
                continue;
            alternatives.push(alternative);
            seen.add(key);
            break;
        }
    }
    alternatives.sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        return a.matches[0].team_a.join(':').localeCompare(b.matches[0].team_a.join(':'));
    });
    if (alternatives.length === 0) {
        return {
            alternatives: [],
            warnings: [...warnings, 'NO_VALID_MATCH'],
            should_end: false,
        };
    }
    return {
        alternatives: alternatives.slice(0, 3),
        warnings,
        should_end: false,
    };
}
exports.suggestNextRound = suggestNextRound;
function getEmptySuggestion() {
    return {
        matches: [],
        resting: [],
        score: Infinity,
        warnings: [],
        stats: emptyStats(),
    };
}
exports.getEmptySuggestion = getEmptySuggestion;
