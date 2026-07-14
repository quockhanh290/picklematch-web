// @ts-ignore Deno edge-function bundling needs the local .ts extension.
import type { Team } from '../types.ts'

export type PlannedBoardMatch = { team_a: Team; team_b: Team }

export type PairSwapCheckpoint = {
  board: PlannedBoardMatch[]
  pass: number
  left: number
  right: number
  improved_in_pass: boolean
}

type PairSwapSearchOptions<Metrics> = {
  initialBoard: PlannedBoardMatch[]
  passes: number
  evaluate: (board: PlannedBoardMatch[]) => Metrics
  evaluateReplacement?: (otherMatches: PlannedBoardMatch[], replacement: PlannedBoardMatch[]) => Metrics
  isBetter: (candidate: Metrics, current: Metrics) => boolean
  isAllowed?: (candidate: Metrics) => boolean
  checkpoint?: PairSwapCheckpoint
  maxCourtPairs?: number
  maxRuntimeMs?: number
}

function cloneBoard(board: PlannedBoardMatch[]) {
  return board.map(match => ({
    team_a: [...match.team_a] as Team,
    team_b: [...match.team_b] as Team,
  }))
}

function teamSplits(ids: string[]): Array<[Team, Team]> {
  return [
    [[ids[0], ids[1]], [ids[2], ids[3]]],
    [[ids[0], ids[2]], [ids[1], ids[3]]],
    [[ids[0], ids[3]], [ids[1], ids[2]]],
  ]
}

export function buildTwoCourtBoards(ids: string[]): PlannedBoardMatch[][] {
  if (ids.length !== 8 || new Set(ids).size !== 8) {
    throw new Error('Pair-swap search requires eight unique player IDs')
  }
  const boards: PlannedBoardMatch[][] = []
  const first = ids[0]
  for (let a = 1; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      for (let c = b + 1; c < ids.length; c += 1) {
        const firstFour = [first, ids[a], ids[b], ids[c]]
        const firstSet = new Set(firstFour)
        const secondFour = ids.filter(id => !firstSet.has(id))
        for (const [teamA, teamB] of teamSplits(firstFour)) {
          for (const [teamC, teamD] of teamSplits(secondFour)) {
            boards.push([{ team_a: teamA, team_b: teamB }, { team_a: teamC, team_b: teamD }])
          }
        }
      }
    }
  }
  return boards
}

function advanceCursor(checkpoint: PairSwapCheckpoint, courtCount: number) {
  checkpoint.right += 1
  if (checkpoint.right < courtCount) return
  checkpoint.left += 1
  checkpoint.right = checkpoint.left + 1
}

export function runPairSwapSearch<Metrics>(options: PairSwapSearchOptions<Metrics>) {
  const courtCount = options.initialBoard.length
  const cursor: PairSwapCheckpoint = options.checkpoint
    ? { ...options.checkpoint, board: cloneBoard(options.checkpoint.board) }
    : { board: cloneBoard(options.initialBoard), pass: 0, left: 0, right: 1, improved_in_pass: false }
  const deadline = options.maxRuntimeMs === undefined
    ? Number.POSITIVE_INFINITY
    : performance.now() + options.maxRuntimeMs
  let courtPairsProcessed = 0
  let candidatesEvaluated = 0
  let timedOut = false

  while (cursor.pass < options.passes) {
    if (cursor.left >= courtCount - 1) {
      if (!cursor.improved_in_pass) {
        return { board: cursor.board, checkpoint: null, completed: true, timedOut, courtPairsProcessed, candidatesEvaluated }
      }
      cursor.pass += 1
      cursor.left = 0
      cursor.right = 1
      cursor.improved_in_pass = false
      continue
    }
    if (courtPairsProcessed >= (options.maxCourtPairs ?? Number.POSITIVE_INFINITY)) break
    if (performance.now() >= deadline) {
      timedOut = true
      break
    }

    const { left, right } = cursor
    const otherMatches = cursor.board.filter((_, index) => index !== left && index !== right)
    const ids = [
      ...cursor.board[left].team_a,
      ...cursor.board[left].team_b,
      ...cursor.board[right].team_a,
      ...cursor.board[right].team_b,
    ]
    let bestBoard = cursor.board
    let bestMetrics = options.evaluate(cursor.board)
    for (const pair of buildTwoCourtBoards(ids)) {
      candidatesEvaluated += 1
      const candidateMetrics = options.evaluateReplacement
        ? options.evaluateReplacement(otherMatches, pair)
        : options.evaluate([...otherMatches, ...pair])
      if (options.isAllowed && !options.isAllowed(candidateMetrics)) continue
      if (options.isBetter(candidateMetrics, bestMetrics)) {
        bestBoard = [...otherMatches, ...pair]
        bestMetrics = candidateMetrics
      }
    }
    if (bestBoard !== cursor.board) {
      cursor.board = bestBoard
      cursor.improved_in_pass = true
    }
    courtPairsProcessed += 1
    advanceCursor(cursor, courtCount)
  }

  if (cursor.pass >= options.passes) {
    return { board: cursor.board, checkpoint: null, completed: true, timedOut, courtPairsProcessed, candidatesEvaluated }
  }
  return {
    board: cursor.board,
    checkpoint: cursor,
    completed: false,
    timedOut,
    courtPairsProcessed,
    candidatesEvaluated,
  }
}
