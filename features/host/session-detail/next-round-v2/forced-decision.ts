import type { Match, SessionState } from '@/lib/next-round-suggester/types'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import { formatNumber, getTeamPvna, playerName } from './helpers'
import type { SuggestedLiveMatchRow } from './preview'

// Repeat-detail derivation for a lineup — pure (no React). Lives here (not preview-helpers.ts) because it
// pulls the RN-coupled './helpers'; preview-helpers.ts is on preview-consistency.ts's import chain, which
// pure non-RN unit tests load, so it must stay light.
export function getRepeatDetailLines(
  match: Match,
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
) {
  type RepeatPairDetail = {
    playerA: string
    playerB: string
    currentCount: number
    projectedCount: number
  }
  const pairLines: string[] = []
  const sentenceLines: string[] = []
  const partnerPairs: RepeatPairDetail[] = []
  const opponentPairs: RepeatPairDetail[] = []
  const playerRepeatMap = new Map<string, { partners: string[]; opponents: string[] }>()
  const describePair = (playerA: string, playerB: string) =>
    `${playerName(playerA, playersById)} và ${playerName(playerB, playersById)}`
  const repeatSentence = (
    playerA: string,
    playerB: string,
    currentCount: number,
    projectedCount: number,
    relation: 'partner' | 'opponent',
  ) => {
    const pairText = describePair(playerA, playerB)
    const previousText = currentCount === 1 ? '1 trận' : `${currentCount} trận`
    const projectedText = projectedCount === 2 ? 'trận thứ 2' : `trận thứ ${projectedCount}`
    return relation === 'partner'
      ? `${pairText} đã làm đồng đội ${previousText}; đây là ${projectedText} cùng làm đồng đội.`
      : `${pairText} đã làm đối thủ ${previousText}; đây là ${projectedText} làm đối thủ.`
  }

  for (const team of [match.team_a, match.team_b]) {
    const currentCount = state.players.get(team[0])?.partner_counts.get(team[1]) ?? 0
    const projectedCount = currentCount + 1
    if (projectedCount >= 2) {
      partnerPairs.push({ playerA: team[0], playerB: team[1], currentCount, projectedCount })
      sentenceLines.push(repeatSentence(team[0], team[1], currentCount, projectedCount, 'partner'))
      pairLines.push(`Partner: ${describePair(team[0], team[1])} (${projectedCount} lần)`)
    }
  }

  for (const playerA of match.team_a) {
    for (const playerB of match.team_b) {
      const currentCount = state.players.get(playerA)?.opponent_counts.get(playerB) ?? 0
      const projectedCount = currentCount + 1
      if (projectedCount >= 2) {
        opponentPairs.push({ playerA, playerB, currentCount, projectedCount })
        sentenceLines.push(repeatSentence(playerA, playerB, currentCount, projectedCount, 'opponent'))
        pairLines.push(`Đối thủ: ${describePair(playerA, playerB)} (${projectedCount} lần)`)
      }
    }
  }

  const playerLines = [...playerRepeatMap.entries()]
    .map(([playerId, item]) => {
      const parts: string[] = []
      if (item.partners.length > 0) {
        parts.push(`partner ${item.partners.map(id => playerName(id, playersById)).join(', ')}`)
      }
      if (item.opponents.length > 0) {
        parts.push(`đối thủ ${item.opponents.map(id => playerName(id, playersById)).join(', ')}`)
      }
      return `${playerName(playerId, playersById)} lặp với ${parts.join('; ')}`
    })
    .slice(0, 4)

  return {
    pairLines: sentenceLines.slice(0, 4),
    playerLines: [],
    partnerPairs,
    opponentPairs,
    hiddenCount: Math.max(0, sentenceLines.length - 4),
  }
}

export type ForcedDecisionCard = {
  key: 'accept_repeat' | 'accept_imbalance' | 'wait'
  testId: string
  tone: 'play' | 'swap' | 'wait'
  title: string
  result: string
  cost: string
  selected: boolean
}

// Forced-court (no clean lineup) 3-way decision: derived from the engine's two Pareto endpoints
// (forced_tradeoff.acceptRepeat / acceptImbalance) rather than tradeoff_choices. Pure — no React,
// no I/O. Returns null when the match has no forced_tradeoff (non-forced court).
export function buildForcedDecision(
  match: SuggestedLiveMatchRow,
  state: SessionState,
  playersById: Map<string, ArrangementPlayer>,
  selection: 'accept_repeat' | 'accept_imbalance' | 'wait',
  cardCourtIdx: number,
): {
  forcedLineup: { team_a: [string, string]; team_b: [string, string] } | null
  cards: ForcedDecisionCard[]
  startMatch: SuggestedLiveMatchRow
} | null {
  const forced = match.forced_tradeoff
  if (!forced) return null
  const forcedWait = match.wait_rescue_options ?? []
  // "wait" keeps the default lineup (acceptRepeat) pending the re-suggest — it has no lineup of
  // its own, unlike the swap-to-alternative choices below.
  const forcedLineup = selection === 'accept_imbalance' ? forced.acceptImbalance : forced.acceptRepeat
  // The server only ever persists ONE forced-court lineup (whatever team_a/team_b the edge committed
  // — normally acceptRepeat). If the host's displayed choice differs from that persisted pair, Start
  // must not take the match_id-only "already committed" fast path (useLiveBoard's usePersistedMatchStart)
  // — it would silently start the persisted lineup instead of the host's pick. Stamping preview_source
  // here routes it through the manual persist-then-start path instead (see startLiveMatch).
  const teamsMatchUnordered = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every(id => b.includes(id))
  const forcedLineupIsPersisted =
    teamsMatchUnordered(forcedLineup.team_a, match.team_a) && teamsMatchUnordered(forcedLineup.team_b, match.team_b)
  const startMatch: SuggestedLiveMatchRow = {
    ...match,
    team_a: forcedLineup.team_a,
    team_b: forcedLineup.team_b,
    ...(forcedLineupIsPersisted ? {} : { preview_source: 'forced_tradeoff_manual' as const }),
  }

  // Forced-court decision costs: derived from the same pvna/repeat helpers the rest of the card
  // uses (getTeamPvna, getRepeatDetailLines), applied to the engine's two Pareto endpoints.
  const forcedAcceptRepeatGap = Math.abs(
    getTeamPvna(forced.acceptRepeat.team_a, state) - getTeamPvna(forced.acceptRepeat.team_b, state),
  )
  const forcedAcceptImbalanceGap = Math.abs(
    getTeamPvna(forced.acceptImbalance.team_a, state) - getTeamPvna(forced.acceptImbalance.team_b, state),
  )
  const forcedRepeatDetail = getRepeatDetailLines(
    { court_idx: cardCourtIdx, team_a: forced.acceptRepeat.team_a, team_b: forced.acceptRepeat.team_b },
    state,
    playersById,
  )
  const forcedRepeatPair = forcedRepeatDetail.opponentPairs[0] ?? forcedRepeatDetail.partnerPairs[0]
  const forcedRepeatCost = forcedRepeatPair
    ? `${playerName(forcedRepeatPair.playerA, playersById)} gặp lại ${playerName(forcedRepeatPair.playerB, playersById)} lần ${forcedRepeatPair.projectedCount}`
    : 'có người gặp lại'

  const cards: ForcedDecisionCard[] = [
    {
      key: 'accept_repeat', testId: `nrv2-decision-accept_repeat-${cardCourtIdx}`, tone: 'play',
      title: 'Chịu lặp', result: `Cân (chênh ${formatNumber(forcedAcceptRepeatGap, 2)})`, cost: forcedRepeatCost,
      selected: selection === 'accept_repeat',
    },
    {
      key: 'accept_imbalance', testId: `nrv2-decision-accept_imbalance-${cardCourtIdx}`, tone: 'swap',
      title: 'Chịu lệch', result: 'Tươi (không lặp)', cost: `Đội lệch ${formatNumber(forcedAcceptImbalanceGap, 2)}`,
      selected: selection === 'accept_imbalance',
    },
  ]
  if (forcedWait.length > 0) {
    cards.push({
      key: 'wait', testId: `nrv2-decision-wait-${cardCourtIdx}`, tone: 'wait',
      title: `Chờ Sân ${forcedWait[0].court_idx + 1}`, result: 'Xong sẽ xếp sạch được', cost: 'sân này để trống',
      selected: selection === 'wait',
    })
  }

  return { forcedLineup, cards, startMatch }
}
