const fs = require('node:fs')
const vm = require('node:vm')
const { suggestNextRound } = require('./nrs-compiled/suggest.js')
const { commitCompletedRound } = require('./nrs-compiled/commit.js')

const source = fs.readFileSync('scratch/simulate_next_round_40.js', 'utf8')
const rowsSource = source.match(/const rows = \[[\s\S]*?\n\]/)?.[0]
if (!rowsSource) throw new Error('Cannot load base roster rows')

const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(`${rowsSource.replace('const rows', 'var rows')}`, sandbox)
const rows = sandbox.rows

const weights = {
  elo: 100,
  partner_repeat: 3,
  opponent_repeat: 1.5,
  group_bonus: 0.5,
  partner_gender_pref: 4,
  opponent_gender_pref: 2,
}

const plan = [
  { courts: 4, in: ['P1', 'P2', 'P3', 'P4', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P14', 'P16', 'P18', 'P21', 'P23'] },
  { courts: 5, in: ['P24', 'P25', 'P27', 'P28'], out: ['P10'] },
  { courts: 6, in: ['P30', 'P32', 'P37', 'P39', 'P40'], out: ['P7'] },
  { courts: 6, in: ['P10', 'P13', 'P15', 'P17'], out: ['P2', 'P18'] },
  { courts: 5, in: ['P7', 'P19', 'P20', 'P22'], out: ['P4', 'P39'] },
  { courts: 6, in: ['P2', 'P18', 'P26', 'P29', 'P31', 'P33'], out: ['P1'] },
  { courts: 6, in: ['P1', 'P4', 'P34', 'P35', 'P36', 'P38'], out: ['P12', 'P21'] },
]

const groupAssignments = [
  ['P1', 'P4'],
  ['P6', 'P12', 'P18'],
  ['P9', 'P21', 'P27'],
  ['P10', 'P16', 'P28'],
  ['P24', 'P30', 'P32'],
  ['P33', 'P35', 'P37'],
  ['P7', 'P22'],
]

const groupByPlayer = new Map()
for (const [index, members] of groupAssignments.entries()) {
  const groupId = `g${index + 1}:${members.join(':')}`
  for (const member of members) groupByPlayer.set(member, groupId)
}

function playerFromRow([name, pvna, gender, partnerPref, opponentPref]) {
  return {
    player_id: name,
    elo: pvna,
    group_id: groupByPlayer.get(name) ?? null,
    checked_in_at: new Date('2026-05-14T12:00:00.000Z'),
    checked_out_at: new Date('2026-05-14T11:59:00.000Z'),
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

function makeState(players, courts, roundNo, rounds) {
  return {
    session_id: 'dynamic-real-case',
    current_round: roundNo,
    status: 'waiting',
    config: { courts, elo_tolerance: 0.5, weights },
    players: new Map(players.map((player) => [player.player_id, player])),
    rounds,
  }
}

function applyEvents(players, step, roundNo) {
  const now = new Date(`2026-05-14T12:${String(roundNo).padStart(2, '0')}:00.000Z`)
  const inSet = new Set(step.in ?? [])
  const outSet = new Set(step.out ?? [])

  return players.map((player) => {
    if (inSet.has(player.player_id)) {
      return { ...player, checked_in_at: now, checked_out_at: null, opted_rest: false }
    }
    if (outSet.has(player.player_id)) {
      return { ...player, checked_out_at: now, opted_rest: false }
    }
    return player
  })
}

function prefLabel(player) {
  const group = player.group_id ? player.group_id.split(':')[0] : '-'
  return `${player.player_id}(${player.gender};P:${player.partner_gender_pref};O:${player.opponent_gender_pref};G:${group})`
}

function teamLabel(team, state) {
  return team.map((id) => prefLabel(state.players.get(id))).join('/')
}

function presentPlayers(players) {
  return players.filter((player) => player.checked_out_at === null)
}

function playerMatchLine(players) {
  return players
    .sort((a, b) => a.matches_played - b.matches_played || a.player_id.localeCompare(b.player_id))
    .map((player) => `${player.player_id}:${player.matches_played}${player.checked_out_at ? '(out)' : ''}`)
    .join(' ')
}

let players = rows.map(playerFromRow)
let pairRows = []
let rounds = []

console.log('Dynamic simulation: arrivals, late players, checkout/re-checkin, 4-6 courts')
console.log(`Groups: ${groupAssignments.map((members, index) => `g${index + 1}=${members.join('/')}`).join(' | ')}`)

for (let roundNo = 0; roundNo < plan.length; roundNo += 1) {
  const step = plan[roundNo]
  players = hydratePairHistory(players, pairRows)
  players = applyEvents(players, step, roundNo)
  const present = presentPlayers(players)
  const state = makeState(players, step.courts, roundNo, rounds)
  const suggestion = suggestNextRound(state)
  const alternative = suggestion.alternatives[0]

  console.log(`\nROUND ${roundNo} | courts=${step.courts} | present=${present.length} | in=${(step.in ?? []).join(',') || '-'} | out=${(step.out ?? []).join(',') || '-'}`)
  if (!alternative) {
    console.log(`  NO MATCH | warnings=${suggestion.warnings.join('; ')}`)
    continue
  }

  const stats = alternative.stats
  console.log(`  score=${alternative.score.toFixed(1)} pvna=${stats.elo_diff.toFixed(2)} PR=${stats.partner_repeats} OR=${stats.opponent_repeats} gender=${stats.gender_pref_penalty.toFixed(1)} resting=${alternative.resting.join(',') || '-'}`)
  for (const match of alternative.matches) {
    const ms = match.stats
    console.log(`  S${match.court_idx + 1}: ${teamLabel(match.team_a, state)} vs ${teamLabel(match.team_b, state)} | score=${match.score.toFixed(1)} pvna=${ms.elo_diff.toFixed(2)} PR=${ms.partner_repeats} OR=${ms.opponent_repeats} G=${ms.gender_pref_penalty.toFixed(1)}`)
  }

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

const active = presentPlayers(players)
const values = players.map((player) => player.matches_played)
const activeValues = active.map((player) => player.matches_played)
const pairRepeats = pairRows.filter((row) => row.partner_count > 1)
const opponentRepeats = pairRows.filter((row) => row.opponent_count > 1)

console.log('\nSUMMARY')
console.log(`all players matches min/max=${Math.min(...values)}/${Math.max(...values)}`)
console.log(`active players matches min/max=${Math.min(...activeValues)}/${Math.max(...activeValues)}, active=${active.length}`)
console.log(`partner repeat pairs=${pairRepeats.length}, worst=${Math.max(0, ...pairRepeats.map((row) => row.partner_count))}`)
console.log(`opponent repeat pairs=${opponentRepeats.length}, worst=${Math.max(0, ...opponentRepeats.map((row) => row.opponent_count))}`)
console.log(playerMatchLine(players))
