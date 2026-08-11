import { computeRestFairness } from '../../../lib/next-round-suggester/fairness/metrics'
import { createMatch, createPlayer, createState } from '../helpers/factories'

// The current-round extension asks one question: has this player NOT played in the activity that
// state.rounds does not yet cover?
//
// KNOWN LIMITATION, deliberately pinned here rather than papered over. The check uses
// `player.last_played_round >= state.current_round`, and last_played_round counts cycles on one court
// (BUG #7). When courts drift apart it reads the wrong side, and a genuinely resting player's run can
// go unextended.
//
// The obvious repair — swap round numbers for the session-wide last_played_seq — was tried and is
// WORSE, which is what these two tests exist to stop anyone from re-landing. Both candidate anchors
// fail:
//   * against the session's newest sequence: every court except the last one to finish sits below it,
//     so people who just played read as resting;
//   * against the newest sequence among players of tracked rounds: those players' state is read as it
//     is NOW, so the moment they play again that anchor rises to the session maximum and the extension
//     stops firing at all — the second test below.
//
// A sound fix needs data this function does not have: the sequence number of each tracked round's
// matches, so "covered by state.rounds" becomes a fact rather than an inference. That means carrying it
// on RoundRecord from the snapshot, not another comparison here.
describe('rest run extension for the round state.rounds does not cover yet', () => {
  it('still extends the run when the players who are back on court are the tracked round\'s own players', () => {
    // Tracked round 7: p1..p8 played, p9 sat out (run of 1).
    // Untracked activity: the same eight are playing again (seq 40). p9 has now sat out two rounds and
    // the run must read 2.
    //
    // The trap: "the latest sequence among players of tracked rounds" reads each player's CURRENT
    // state, so p1..p8 playing again drags that value up to 40 — equal to the session maximum. Any test
    // of the form latest_player > latest_tracked then reports no new activity at all, and the extension
    // silently stops firing in the most ordinary situation there is.
    const state = createState({
      currentRound: 8,
      players: [
        ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(id =>
          createPlayer(id, { last_played_round: 8, last_played_seq: 40 })),
        createPlayer('p9', { last_played_round: 6, last_played_seq: 5 }),
      ],
    })

    state.rounds = [{
      session_id: state.session_id,
      round_no: 7,
      status: 'completed',
      matches: [createMatch(['p1', 'p2'], ['p3', 'p4'])],
      resting: ['p9'],
      started_at: null,
      ended_at: null,
    }]

    const metrics = computeRestFairness(state)
    const p9 = metrics.per_player.find(p => p.player_id === 'p9')

    expect(p9?.max_consecutive_rest).toBe(2)
  })

  it('does not extend the run of a rested player who is back on a court that finished earlier', () => {
    // Tracked round 7: p1..p4 played, p9 sat out — p9 carries a rest run of 1.
    // Untracked activity: court 0 finished first (seq 20) and p9 is IN it; court 1 finished after
    // (seq 40). p9 is playing again, so their run must stay at 1.
    const state = createState({
      currentRound: 8,
      players: [
        createPlayer('p1', { last_played_round: 8, last_played_seq: 20 }),
        createPlayer('p2', { last_played_round: 8, last_played_seq: 20 }),
        createPlayer('p3', { last_played_round: 8, last_played_seq: 20 }),
        createPlayer('p9', { last_played_round: 8, last_played_seq: 20 }),
        createPlayer('p5', { last_played_round: 8, last_played_seq: 40 }),
        createPlayer('p6', { last_played_round: 8, last_played_seq: 40 }),
        createPlayer('p7', { last_played_round: 8, last_played_seq: 40 }),
        createPlayer('p8', { last_played_round: 8, last_played_seq: 40 }),
      ],
    })

    state.rounds = [{
      session_id: state.session_id,
      round_no: 7,
      status: 'completed',
      matches: [createMatch(['p1', 'p2'], ['p3', 'p5'])],
      resting: ['p9'],
      started_at: null,
      ended_at: null,
    }]

    const metrics = computeRestFairness(state)
    const p9 = metrics.per_player.find(p => p.player_id === 'p9')

    expect(p9?.max_consecutive_rest).toBe(1)
  })
})
