import { Tier } from '../../../lib/next-round-suggester/classify'
import { suggestNextMatch } from '../../../lib/next-round-suggester/suggest'
import { createPlayer, createState, setOpponentRepeats, setPartnerRepeats } from '../helpers/factories'

// Hinh dang lay tu prod (keo 893b1427, san 2, dump 10:59:44): 9 nguoi ranh cho 4 cho, so MUST_PLAY
// nhieu hon so cho nen canh bao MUST_PLAY_OVER_CAPACITY bat. Live-preview cat danh sach bat buoc xuong
// con 3 nguoi — vua khit mot san — roi truyen xuong bang forced_required_player_ids. suggestNextMatch
// LOC ket qua theo danh sach do vo dieu kien, nhung vong tim kiem ben trong lai xoa rong no vi canh
// bao over-capacity. Tim khong ep, loc thi ep => 0 phuong an, san dung im du nghiem ton tai.
const POOL: [string, number, number, number][] = [
  // id, pvna, matches_played, consecutive_rest
  ['a', 3.54, 6, 1],
  ['b', 3.22, 6, 1],
  ['c', 2.98, 6, 0],
  ['d', 3.04, 6, 0],
  ['e', 2.35, 6, 0],
  ['g', 2.13, 6, 0],
  ['f', 2.32, 5, 0],
  ['h', 4.46, 5, 0],
  ['i', 4.63, 5, 0],
]
const REQUIRED = ['a', 'b', 'c']

function buildState() {
  const players = POOL.map(([id, pvna, matchesPlayed, consecutiveRest]) =>
    createPlayer(id, {
      pvna,
      matches_played: matchesPlayed,
      consecutive_rest: consecutiveRest,
      last_played_round: consecutiveRest > 0 ? 5 : 6,
    }),
  )
  // Khong co lich su lap thi lua chon tu do cua engine tinh co van chua du ba nguoi bat buoc, va test
  // xanh ke ca khi loi con nguyen. Prod co 8 vong lich su day nen engine tu nhien ne ho ra — dung vai
  // lan lap voi 'b' de dung lai dung ap luc do.
  const byId = (id: string) => players.find(player => player.player_id === id)!
  for (const other of ['a', 'c', 'd', 'e', 'g']) {
    setPartnerRepeats(byId('b'), byId(other), 2)
    setOpponentRepeats(byId('b'), byId(other), 2)
  }
  return createState({ courts: 1, pvnaTolerance: 0.5, currentRound: 7, players })
}

const overCapacityOverrides = Object.fromEntries(POOL.map(([id]) => [id, Tier.MUST_PLAY]))

describe('forced required players under MUST_PLAY_OVER_CAPACITY', () => {
  it('raises MUST_PLAY_OVER_CAPACITY for this shape', () => {
    const result = suggestNextMatch(buildState(), {
      court_idx: 0,
      max_alternatives: 5,
      tier_overrides: overCapacityOverrides,
    })

    expect(result.warnings).toContain('MUST_PLAY_OVER_CAPACITY')
  })

  it('leaves the forced players out when nothing forces them', () => {
    const result = suggestNextMatch(buildState(), {
      court_idx: 0,
      max_alternatives: 5,
      tier_overrides: overCapacityOverrides,
    })
    const seatsEveryRequired = result.alternatives.some(alternative => {
      const seated = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
      return REQUIRED.every(playerId => seated.includes(playerId))
    })

    expect(seatsEveryRequired).toBe(false)
  })

  it('still seats forced_required_player_ids that fit in the court', () => {
    const result = suggestNextMatch(buildState(), {
      court_idx: 0,
      max_alternatives: 5,
      tier_overrides: overCapacityOverrides,
      forced_required_player_ids: REQUIRED,
    })

    expect(result.alternatives.length).toBeGreaterThan(0)
    for (const alternative of result.alternatives) {
      const seated = alternative.matches.flatMap(match => [...match.team_a, ...match.team_b])
      for (const playerId of REQUIRED) expect(seated).toContain(playerId)
    }
  })
})
