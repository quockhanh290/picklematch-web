// What is wrong with THIS lineup — derived once, from one set of facts.
//
// The panel used to answer that question twice. The "Chơi luôn" card computed its cost line from
// degraded_reason plus the raw pvna gap, while the capacity lines underneath computed theirs from the
// tradeoff rows plus the intra-team verdict. Two derivations over overlapping inputs disagree, and the
// host saw them disagree: the card read "không đánh đổi gì" directly above a line saying the two teams
// were further apart than usual. The intra-team case was worse — the card had no term for it at all.

export type MatchCompromiseFacts = {
  degradedReason?: 'blowout' | 'repeat' | 'both' | null
  /** Projected count for the most-repeated opponent pair in this lineup. */
  maxOpponentPair: number
  /** How far the two teams are apart beyond the tolerance, as shown to the host. */
  pvnaOverBy: number
  /** True when the engine's verdict says the gap is over tolerance, whatever the raw number rounds to. */
  pvnaCapExceeded: boolean
  /** Two players on the same team are further apart in level than preferred. */
  intraTeamRelaxed: boolean
  /** How far the repeat cap was exceeded, from the repeat tradeoff row. */
  repeatOverBy: number
}

export type MatchCompromise =
  | { kind: 'blowout' }
  | { kind: 'pvna_over'; overBy: number }
  | { kind: 'intra_team' }
  | { kind: 'opponent_repeat'; count: number }
  | { kind: 'recent_repeat' }

const formatOverBy = (value: number) => value.toFixed(2).replace('.', ',')

// Every compromise the host is being asked to accept, in the order the panel names them.
export function getMatchCompromises(facts: MatchCompromiseFacts): MatchCompromise[] {
  const compromises: MatchCompromise[] = []
  const isBlowout = facts.degradedReason === 'blowout' || facts.degradedReason === 'both'
  if (isBlowout) {
    compromises.push({ kind: 'blowout' })
  } else if (facts.pvnaCapExceeded || facts.pvnaOverBy > 0) {
    // A lineup can sit over tolerance without earning the blowout flag, which only fires past a 1.5 gap
    // floor. That whole band used to read "không đánh đổi gì".
    compromises.push({ kind: 'pvna_over', overBy: facts.pvnaOverBy })
  }
  if (facts.intraTeamRelaxed) compromises.push({ kind: 'intra_team' })
  if (facts.maxOpponentPair >= 3) {
    compromises.push({ kind: 'opponent_repeat', count: facts.maxOpponentPair })
  } else if (facts.degradedReason === 'repeat' || facts.degradedReason === 'both' || facts.repeatOverBy > 0) {
    compromises.push({ kind: 'recent_repeat' })
  }
  return compromises
}

// The "Chơi luôn" card's cost line: what the host gives up by seating this lineup as-is.
export function getPlayCostText(compromises: MatchCompromise[]): string {
  if (compromises.length === 0) return 'không đánh đổi gì'
  const parts = compromises.map(compromise => {
    switch (compromise.kind) {
      case 'blowout': return 'trận hơi lệch trình'
      case 'pvna_over': return `trận chênh ${formatOverBy(compromise.overBy)} quá mức cân`
      case 'intra_team': return 'một đôi lệch trình'
      case 'opponent_repeat': return `lặp đối thủ ${compromise.count} lần`
      case 'recent_repeat': return 'trận bị trùng người'
    }
  })
  return `giữ ${parts.join(' & ')}`
}

// The lines under the lineup. Same compromises, longer wording — they cannot contradict the cost line
// because they are the same list.
export function getCompromiseInfoLines(compromises: MatchCompromise[]): string[] {
  return compromises.map(compromise => {
    switch (compromise.kind) {
      case 'blowout': return 'Hai đội chênh nhau hơn bình thường'
      case 'pvna_over': return 'Hai đội chênh nhau hơn bình thường'
      case 'intra_team': return 'Hai người cùng đội chênh trình độ'
      case 'opponent_repeat': return 'Đã từng đấu với nhau gần đây'
      case 'recent_repeat': return 'Đã từng đấu với nhau gần đây'
    }
  })
}
