import {
  computeEffectiveCourts,
  sortPlayersForSchedule,
  generateFixedSchedule,
  generateRoundRobinRound,
  type GeneratedMatch,
} from '@/features/host/session-detail/host-match/scheduleGenerators'

describe('computeEffectiveCourts', () => {
  it('caps requested courts by floor(playerCount / 4)', () => {
    expect(computeEffectiveCourts(8, 5)).toBe(2)
  })

  it('never returns less than 1 court', () => {
    expect(computeEffectiveCourts(4, 0)).toBe(1)
  })

  it('allows fewer requested courts than the player-count cap', () => {
    expect(computeEffectiveCourts(16, 2)).toBe(2)
  })
})

describe('sortPlayersForSchedule', () => {
  it('sorts by name then id, does not mutate input', () => {
    const players = [
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice' },
      { id: '3', name: 'Alice' },
    ]
    const original = [...players]
    const sorted = sortPlayersForSchedule(players)
    expect(sorted.map(p => p.id)).toEqual(['1', '3', '2'])
    expect(players).toEqual(original)
  })
})

describe('generateFixedSchedule', () => {
  const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']

  it('generates a full round-robin schedule covering every player without duplicate seats in a round', async () => {
    const result = await generateFixedSchedule({
      playerIds,
      courtCount: 2,
      mode: 'full',
      minGamesPerPlayer: 1,
      priority: 'balanced',
    })
    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.courtsPerRound).toBeGreaterThanOrEqual(1)

    const byRotation = new Map<number, GeneratedMatch[]>()
    result.matches.forEach(m => {
      const key = m.rotation ?? 0
      byRotation.set(key, [...(byRotation.get(key) ?? []), m])
    })
    byRotation.forEach(roundMatches => {
      const seen = new Set<string>()
      roundMatches.forEach(m => {
        [...m.teamA, ...m.teamB].forEach(pid => {
          expect(seen.has(pid)).toBe(false)
          seen.add(pid)
        })
      })
    })

    const gamesCount = new Map<string, number>()
    result.matches.forEach(m => {
      [...m.teamA, ...m.teamB].forEach(pid => gamesCount.set(pid, (gamesCount.get(pid) ?? 0) + 1))
    })
    playerIds.forEach(pid => {
      expect(gamesCount.get(pid) ?? 0).toBeGreaterThan(0)
    })
  })

  it('respects the limited mode minGamesPerPlayer target', async () => {
    const result = await generateFixedSchedule({
      playerIds,
      courtCount: 2,
      mode: 'limited',
      minGamesPerPlayer: 2,
      priority: 'balanced',
    })
    const gamesCount = new Map<string, number>()
    result.matches.forEach(m => {
      [...m.teamA, ...m.teamB].forEach(pid => gamesCount.set(pid, (gamesCount.get(pid) ?? 0) + 1))
    })
    playerIds.forEach(pid => {
      expect(gamesCount.get(pid) ?? 0).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('generateRoundRobinRound', () => {
  const makePlayer = (id: string, checkInStatus: string | null = 'checked_in') => ({ id, checkInStatus })

  it('returns not_enough_available_players when fewer than 4 players are free', () => {
    const players = [makePlayer('1'), makePlayer('2'), makePlayer('3')]
    const result = generateRoundRobinRound({
      activePlayers: players,
      busyPlayerIds: [],
      pendingMatches: [],
      matchesPlayed: new Map(),
      metMap: new Map(),
      partnerMap: new Map(),
    })
    expect(result.status).toBe('not_enough_available_players')
  })

  it('returns match_gap_exceeded when all free players are already ahead of the match-gap limit', () => {
    const players = [makePlayer('1'), makePlayer('2'), makePlayer('3'), makePlayer('4'), makePlayer('5')]
    const matchesPlayed = new Map([
      ['1', 0], ['2', 5], ['3', 5], ['4', 5], ['5', 5],
    ])
    const result = generateRoundRobinRound({
      activePlayers: players,
      busyPlayerIds: ['1'],
      pendingMatches: [],
      matchesPlayed,
      metMap: new Map(),
      partnerMap: new Map(),
    })
    expect(result.status).toBe('match_gap_exceeded')
  })

  it('produces a valid 2v2 match from 4 available players with no duplicate players across teams', () => {
    const players = [makePlayer('1'), makePlayer('2'), makePlayer('3'), makePlayer('4')]
    const result = generateRoundRobinRound({
      activePlayers: players,
      busyPlayerIds: [],
      pendingMatches: [],
      matchesPlayed: new Map(),
      metMap: new Map(),
      partnerMap: new Map(),
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.match.teamA.length).toBe(2)
    expect(result.match.teamB.length).toBe(2)
    const all = [...result.match.teamA, ...result.match.teamB]
    expect(new Set(all).size).toBe(4)
    all.forEach(pid => expect(['1', '2', '3', '4']).toContain(pid))
  })

  it('excludes busy and already-pending players from the sitting-out list and from selection', () => {
    const players = [
      makePlayer('1'), makePlayer('2'), makePlayer('3'), makePlayer('4'),
      makePlayer('5'), makePlayer('6'),
    ]
    const result = generateRoundRobinRound({
      activePlayers: players,
      busyPlayerIds: ['1', '2'],
      pendingMatches: [],
      matchesPlayed: new Map(),
      metMap: new Map(),
      partnerMap: new Map(),
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const selected = new Set([...result.match.teamA, ...result.match.teamB])
    expect(selected.has('1')).toBe(false)
    expect(selected.has('2')).toBe(false)
    result.sittingOutPlayerIds.forEach(pid => {
      expect(pid === '1' || pid === '2').toBe(false)
      expect(selected.has(pid)).toBe(false)
    })
  })

  it('prefers players who have not met each other over players who have', () => {
    const players = [makePlayer('1'), makePlayer('2'), makePlayer('3'), makePlayer('4'), makePlayer('5')]
    const metMap = new Map<string, Set<string>>([
      ['1', new Set(['2', '3', '4'])],
      ['2', new Set(['1'])],
      ['3', new Set(['1'])],
      ['4', new Set(['1'])],
      ['5', new Set()],
    ])
    const result = generateRoundRobinRound({
      activePlayers: players,
      busyPlayerIds: [],
      pendingMatches: [],
      matchesPlayed: new Map(),
      metMap,
      partnerMap: new Map(),
      rng: () => 0.42,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const selected = [...result.match.teamA, ...result.match.teamB]
    expect(selected).toContain('5')
  })
})
