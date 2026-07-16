import type { SessionLiveMatchRow } from '../../../lib/next-round-suggester/types'
import type { RollingPlanTarget } from '../../../lib/next-round-suggester/planner/rolling-horizon'
import { serializeStateToDbRows } from '../helpers/db-rows'
import { createPlayers, createState } from '../helpers/factories'
import { persistPreviewRows, runProductionLiveChain, type AuthoritativeLiveSnapshot } from '../helpers/production-live-chain'

const SESSION_ID = 'rolling-horizon-chain-test'

describe('rolling horizon across asynchronous court completion', () => {
  it.each([
    ['court order', [0, 1, 2, 3, 4, 5], false],
    ['reverse order', [5, 4, 3, 2, 1, 0], false],
    ['slow middle courts', [0, 5, 1, 4, 2, 3], false],
    ['court order with enriched target', [0, 1, 2, 3, 4, 5], true],
  ])('keeps every lane feasible under %s', (_label, courtOrder, withTarget) => {
    let snapshot = buildSnapshot()
    const rollingPlanTarget = withTarget ? buildEnrichedTarget(snapshot) : null
    let sequence = snapshot.liveMatchRows.length
    const selectedCounts = new Map<string, number>()
    const partnerCounts = new Map<string, number>()
    const opponentCounts = new Map<string, number>()
    let maxTeamGap = 0
    let totalTeamGap = 0
    let maxIntraGap = 0
    let totalIntraGap = 0
    let warningMatchCount = 0
    let maxElapsedMs = 0
    let totalMatches = 0

    for (let cycle = 0; cycle < 2; cycle += 1) {
      for (const courtIdx of courtOrder) {
        const completing = latestLiveOnCourt(snapshot.liveMatchRows, courtIdx)
        expect(completing).toBeDefined()
        const events: string[] = []
        const dumps: Array<{ missing_courts: number[]; payload: unknown }> = []
        const result = runProductionLiveChain({
          snapshot,
          count: 1,
          completingLiveMatchIds: new Set([completing!.id]),
          stripPersistedPreviews: true,
          options: {
            courtIdxs: [courtIdx],
            ignoreCapacityLock: true,
            rollingHorizon: true,
            rollingPlanTarget,
            onInstrumentEvent: event => events.push(`${event.event}:${event.detail}`),
            onIncompleteDump: dump => dumps.push({ missing_courts: dump.missing_courts, payload: dump.payload }),
          },
        })
        expect(result.elapsedMs).toBeLessThan(2000)
        maxElapsedMs = Math.max(maxElapsedMs, result.elapsedMs)
        if (result.payloads.length !== 1) {
          throw new Error(`missing rolling payload cycle=${cycle} court=${courtIdx} elapsed=${result.elapsedMs.toFixed(1)}ms events=${events.join('|')} dumps=${JSON.stringify(dumps)}`)
        }
        const payload = result.payloads[0]
        const selectedIds = [...payload.team_a, ...payload.team_b]
        selectedIds.forEach(playerId => selectedCounts.set(playerId, (selectedCounts.get(playerId) ?? 0) + 1))
        for (const team of [payload.team_a, payload.team_b]) {
          const key = [...team].sort().join('|')
          partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1)
        }
        for (const playerA of payload.team_a) for (const playerB of payload.team_b) {
          const key = [playerA, playerB].sort().join('|')
          opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
        }
        const pvna = (playerId: string) => result.state.players.get(playerId)?.pvna ?? 0
        const teamGap = Math.abs(
          pvna(payload.team_a[0]) + pvna(payload.team_a[1])
            - pvna(payload.team_b[0]) - pvna(payload.team_b[1]),
        )
        const intraGap = Math.max(
          Math.abs(pvna(payload.team_a[0]) - pvna(payload.team_a[1])),
          Math.abs(pvna(payload.team_b[0]) - pvna(payload.team_b[1])),
        )
        maxTeamGap = Math.max(maxTeamGap, teamGap)
        totalTeamGap += teamGap
        maxIntraGap = Math.max(maxIntraGap, intraGap)
        totalIntraGap += intraGap
        warningMatchCount += (payload.warnings?.length ?? 0) > 0 || (payload.tradeoffs?.length ?? 0) > 0 ? 1 : 0
        totalMatches += 1
        const otherBusy = new Set(snapshot.liveMatchRows
          .filter(row => row.status === 'live' && row.id !== completing!.id)
          .flatMap(row => [...row.team_a, ...row.team_b]))
        expect([...payload.team_a, ...payload.team_b].some(id => otherBusy.has(id))).toBe(false)

        const completedAt = new Date(Date.parse(completing!.started_at ?? completing!.suggested_at) + 60_000).toISOString()
        const replacement = persistPreviewRows({
          payloads: result.payloads,
          snapshot,
          sequenceStart: sequence,
          suggestedAt: completedAt,
        })[0]
        sequence += 1
        snapshot = {
          ...snapshot,
          liveStateVersion: snapshot.liveStateVersion + 1,
          liveMatchRows: [
            ...snapshot.liveMatchRows.map(row => row.id === completing!.id
              ? { ...row, status: 'completed' as const, ended_at: completedAt }
              : row),
            { ...replacement, status: 'live' as const, started_at: completedAt },
          ],
        }
      }
    }

    const counts = [...snapshot.playerRows]
      .filter(row => row.checked_out_at === null && !row.opted_rest)
      .map(row => selectedCounts.get(row.player_id) ?? 0)
    const initialCounts = new Map<string, number>()
    buildSnapshot().liveMatchRows.forEach(row => {
      [...row.team_a, ...row.team_b].forEach(playerId => {
        initialCounts.set(playerId, (initialCounts.get(playerId) ?? 0) + 1)
      })
    })
    const sessionCounts = [...snapshot.playerRows]
      .filter(row => row.checked_out_at === null && !row.opted_rest)
      .map(row => (selectedCounts.get(row.player_id) ?? 0) + (initialCounts.get(row.player_id) ?? 0))
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2)
    expect(Math.max(...sessionCounts) - Math.min(...sessionCounts)).toBeLessThanOrEqual(2)
    expect(Math.max(0, ...partnerCounts.values())).toBeLessThanOrEqual(2)
    expect(maxTeamGap).toBeLessThanOrEqual(1)
    expect(maxElapsedMs).toBeLessThan(2000)
    expect(totalMatches).toBe(12)
    if (!withTarget) expect(Math.min(...counts)).toBe(1)
    expect(Math.max(...counts)).toBe(2)
    expect(repeatEvents(partnerCounts)).toBeLessThanOrEqual(6)
    expect(repeatEvents(opponentCounts)).toBeLessThanOrEqual(10)
    expect(warningMatchCount).toBeLessThanOrEqual(totalMatches)
    expect(rounded(totalTeamGap / totalMatches)).toBeLessThanOrEqual(0.15)
    expect(rounded(maxTeamGap)).toBeLessThanOrEqual(1)
    expect(rounded(totalIntraGap / totalMatches)).toBeLessThanOrEqual(1.2)
    expect(rounded(maxIntraGap)).toBeLessThanOrEqual(3)
  }, 90_000)
})

function repeatEvents(counts: ReadonlyMap<string, number>) {
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function rounded(value: number) {
  return Number(value.toFixed(3))
}

function buildEnrichedTarget(snapshot: AuthoritativeLiveSnapshot): RollingPlanTarget {
  const targetMatches = (playerId: string) => playerId <= 'p06' ? 3 : 2
  const players = Object.fromEntries(snapshot.playerRows.map(row => [row.player_id, {
    matches: targetMatches(row.player_id),
    rests: 1,
    quality_debt: 2,
    partner_diversity: 2,
    opponent_diversity: 6,
    partner_repeat_exposure: 1,
    opponent_repeat_exposure: 2,
    max_consecutive_rest: 1,
    max_consecutive_play: 3,
  }]))
  return {
    plan_version_id: 'enriched-target-test',
    target_matches_by_player: Object.fromEntries(snapshot.playerRows.map(row => [
      row.player_id,
      targetMatches(row.player_id),
    ])),
    preferred_team_gap: 0.5,
    preferred_intra_team_gap: 1.5,
    players,
  }
}

function buildSnapshot(): AuthoritativeLiveSnapshot {
  const players = createPlayers(33).map((player, index) => ({
    ...player,
    pvna: Number((2 + (index % 11) * 0.28).toFixed(2)),
  }))
  const state = createState({ players, courts: 6, pvnaTolerance: 0.5 })
  state.session_id = SESSION_ID
  const rows = serializeStateToDbRows(state)
  const startedAt = '2026-07-16T12:00:00.000Z'
  const liveMatchRows = Array.from({ length: 6 }, (_, courtIdx): SessionLiveMatchRow => ({
    id: `seed-live-${courtIdx}`,
    session_id: SESSION_ID,
    sequence_no: courtIdx,
    round_no: 0,
    court_idx: courtIdx,
    status: 'live',
    team_a: [`p${String(courtIdx * 4 + 1).padStart(2, '0')}`, `p${String(courtIdx * 4 + 2).padStart(2, '0')}`],
    team_b: [`p${String(courtIdx * 4 + 3).padStart(2, '0')}`, `p${String(courtIdx * 4 + 4).padStart(2, '0')}`],
    resting: [],
    score_a: 0,
    score_b: 0,
    suggested_at: startedAt,
    started_at: new Date(Date.parse(startedAt) + courtIdx * 10_000).toISOString(),
    ended_at: null,
  }))
  return {
    ...rows,
    sessionId: SESSION_ID,
    courtCount: 6,
    pvnaTolerance: 0.5,
    liveStateVersion: 1,
    liveMatchRows,
  }
}

function latestLiveOnCourt(rows: SessionLiveMatchRow[], courtIdx: number) {
  return rows
    .filter(row => row.status === 'live' && row.court_idx === courtIdx)
    .sort((left, right) => right.sequence_no - left.sequence_no)[0]
}
