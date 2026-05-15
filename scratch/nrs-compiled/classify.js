"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAverageMatches = exports.classifyPlayer = exports.Tier = void 0;
exports.Tier = {
    MUST_PLAY: 0,
    SHOULD_PLAY: 1,
    FLEXIBLE: 2,
    SHOULD_REST: 3,
    MUST_REST: 4,
    OPTED_REST: 5,
};
function classifyPlayer(player, avgMatches) {
    if (player.opted_rest)
        return exports.Tier.OPTED_REST;
    if (player.consecutive_rest >= 1)
        return exports.Tier.MUST_PLAY;
    if (player.matches_played < avgMatches - 1.5)
        return exports.Tier.SHOULD_PLAY;
    if (player.consecutive_play >= 2)
        return exports.Tier.MUST_REST;
    if (player.matches_played > avgMatches + 1.5)
        return exports.Tier.SHOULD_REST;
    return exports.Tier.FLEXIBLE;
}
exports.classifyPlayer = classifyPlayer;
function getAverageMatches(players) {
    if (players.length === 0)
        return 0;
    return players.reduce((sum, player) => sum + player.matches_played, 0) / players.length;
}
exports.getAverageMatches = getAverageMatches;
