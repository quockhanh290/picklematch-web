const { suggestNextRound } = require('./nrs-compiled/suggest.js')
const { commitCompletedRound } = require('./nrs-compiled/commit.js')

const rows = [
  ['P12', 3.12, 'F', 'F', 'F', 'present'],
  ['P8', 2.92, 'F', 'any', 'F', 'present'],
  ['P30', 4.06, 'F', 'F', 'any', 'present'],
  ['P40', 2.58, 'F', 'M', 'F', 'present'],
  ['P26', 3.85, 'F', 'any', 'any', 'pending'],
  ['P7', 2.86, 'M', 'F', 'any', 'present'],
  ['P32', 4.16, 'F', 'any', 'F', 'present'],
  ['P13', 3.18, 'M', 'F', 'F', 'pending'],
  ['P3', 2.66, 'M', 'M', 'any', 'present'],
  ['P31', 4.11, 'M', 'F', 'any', 'pending'],
  ['P15', 3.28, 'M', 'M', 'any', 'pending'],
  ['P36', 4.37, 'F', 'F', 'F', 'pending'],
  ['P24', 3.75, 'F', 'F', 'F', 'present'],
  ['P16', 3.33, 'F', 'M', 'F', 'present'],
  ['P34', 4.27, 'F', 'M', 'any', 'pending'],
  ['P2', 2.60, 'F', 'any', 'any', 'present'],
  ['P27', 3.90, 'M', 'M', 'any', 'present'],
  ['P39', 2.53, 'M', 'M', 'any', 'present'],
  ['P9', 2.97, 'M', 'M', 'F', 'present'],
  ['P28', 3.96, 'F', 'M', 'F', 'present'],
  ['P14', 3.23, 'F', 'any', 'any', 'present'],
  ['P29', 4.01, 'M', 'any', 'F', 'pending'],
  ['P19', 3.49, 'M', 'F', 'any', 'pending'],
  ['P22', 3.64, 'F', 'M', 'any', 'pending'],
  ['P10', 3.02, 'F', 'M', 'any', 'present'],
  ['P18', 3.44, 'F', 'F', 'any', 'present'],
  ['P1', 2.55, 'M', 'F', 'F', 'present'],
  ['P33', 4.22, 'M', 'M', 'F', 'pending'],
  ['P11', 3.07, 'M', 'any', 'any', 'present'],
  ['P4', 2.71, 'F', 'M', 'F', 'present'],
  ['P37', 4.42, 'M', 'F', 'F', 'present'],
  ['P35', 4.32, 'M', 'any', 'any', 'pending'],
  ['P5', 2.76, 'M', 'any', 'F', 'pending'],
  ['P23', 3.70, 'M', 'any', 'any', 'present'],
  ['P6', 2.81, 'F', 'F', 'any', 'present'],
  ['P25', 3.80, 'M', 'F', 'F', 'present'],
  ['P38', 4.48, 'F', 'any', 'any', 'pending'],
  ['P20', 3.54, 'F', 'any', 'F', 'pending'],
  ['P21', 3.59, 'M', 'M', 'F', 'present'],
  ['P17', 3.38, 'M', 'any', 'F', 'pending'],
]

const weights = {
  elo: 100,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
}

function playerFromRow([name, pvna, gender, partnerPref, opponentPref]) {
  return {
    player_id: name,
    elo: pvna,
    group_id: null,
    checked_in_at: new Date('2026-05-14T12:00:00.000Z'),
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender,
    partner_gender_pref: partnerPref,
    opponent_gender_pref: opponentPref,
  }
}

function makeState(players, rounds = []) {
  return {
    session_id: 'f977ae32-2240-42c7-a237-e74cab5dcee4',
    current_round: rounds.length,
    status: 'waiting',
    config: { courts: 10, elo_tolerance: 0.5, weights },
    players: new Map(players.map((player) => [player.player_id, player])),
    rounds,
  }
}

function hydratePairHistory(players, pairRows) {
  return players.map((player) => ({
    ...player,
    partner_counts: new Map(
      pairRows
        .filter((row) => row.player_a === player.player_id || row.player_b === player.player_id)
        .map((row) => [
          row.player_a === player.player_id ? row.player_b : row.player_a,
          row.partner_count,
        ]),
    ),
    opponent_counts: new Map(
      pairRows
        .filter((row) => row.player_a === player.player_id || row.player_b === player.player_id)
        .map((row) => [
          row.player_a === player.player_id ? row.player_b : row.player_a,
          row.opponent_count,
        ]),
    ),
  }))
}

function clonePlayers(players) {
  return players.map((player) => ({
    ...player,
    partner_counts: new Map(player.partner_counts),
    opponent_counts: new Map(player.opponent_counts),
  }))
}

function prefLabel(player) {
  return `${player.player_id}(${player.gender};P:${player.partner_gender_pref};O:${player.opponent_gender_pref})`
}

function teamLabel(team, state) {
  return team.map((id) => prefLabel(state.players.get(id))).join('/')
}

function summarizePlayers(players) {
  const values = players.map((player) => player.matches_played)
  const rests = players.map((player) => player.consecutive_rest)
  return {
    minMatches: Math.min(...values),
    maxMatches: Math.max(...values),
    avgMatches: values.reduce((sum, value) => sum + value, 0) / values.length,
    maxConsecutiveRest: Math.max(...rests),
  }
}

function roundReport(roundNo, alternative, state) {
  const stats = alternative.stats
  console.log(`\nROUND ${roundNo} | score=${alternative.score.toFixed(1)} | pvna=${stats.elo_diff.toFixed(2)} | partnerRepeat=${stats.partner_repeats} | opponentRepeat=${stats.opponent_repeats} | gender=${stats.gender_pref_penalty.toFixed(1)} | rest=${alternative.resting.join(',') || '-'}`)
  for (const match of alternative.matches) {
    const ms = match.stats
    console.log(`  S${match.court_idx + 1}: ${teamLabel(match.team_a, state)} vs ${teamLabel(match.team_b, state)} | score=${match.score.toFixed(1)} pvna=${ms.elo_diff.toFixed(2)} PR=${ms.partner_repeats} OR=${ms.opponent_repeats} G=${ms.gender_pref_penalty.toFixed(1)}`)
  }
}

let players = rows.map(playerFromRow)
let pairRows = []
let rounds = []

console.log(`Players=${players.length}, courts=10, rounds=7`)
console.log(`Gender counts: F=${players.filter((p) => p.gender === 'F').length}, M=${players.filter((p) => p.gender === 'M').length}`)
console.log(`Check-in: present=${rows.filter((r) => r[5] === 'present').length}, pending=${rows.filter((r) => r[5] === 'pending').length}`)

for (let roundNo = 0; roundNo < 7; roundNo += 1) {
  players = hydratePairHistory(players, pairRows)
  const state = makeState(players, rounds)
  const suggestion = suggestNextRound(state)
  const alternative = suggestion.alternatives[0]
  if (!alternative) {
    console.log(`No alternative at round ${roundNo}`, suggestion.warnings)
    break
  }

  roundReport(roundNo, alternative, state)
  const round = {
    id: `round-${roundNo}`,
    session_id: state.session_id,
    round_no: roundNo,
    status: 'completed',
    matches: alternative.matches,
    resting: alternative.resting,
    started_at: new Date(),
    ended_at: new Date(),
  }
  const committed = commitCompletedRound(state, round, pairRows)
  players = [...committed.players.values()]
  pairRows = committed.pairHistory
  rounds = [...rounds, round]
}

const summary = summarizePlayers(players)
const pairRepeats = pairRows.filter((row) => row.partner_count > 1)
const opponentRepeats = pairRows.filter((row) => row.opponent_count > 1)
console.log('\nSUMMARY')
console.log(`matches min/max/avg=${summary.minMatches}/${summary.maxMatches}/${summary.avgMatches.toFixed(2)}, maxConsecutiveRest=${summary.maxConsecutiveRest}`)
console.log(`partner repeat pairs=${pairRepeats.length}, worst=${Math.max(0, ...pairRepeats.map((row) => row.partner_count))}`)
console.log(`opponent repeat pairs=${opponentRepeats.length}, worst=${Math.max(0, ...opponentRepeats.map((row) => row.opponent_count))}`)
console.log('matches by player:')
console.log(players.sort((a, b) => a.matches_played - b.matches_played || a.player_id.localeCompare(b.player_id)).map((player) => `${player.player_id}:${player.matches_played}`).join(' '))
