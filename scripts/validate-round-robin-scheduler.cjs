const fs = require('fs')
const path = require('path')
const ts = require('typescript')

require.extensions['.ts'] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

const { buildRoundRobinDoublesSchedule } = require('../lib/roundRobinScheduler.ts')

const priorities = ['balanced', 'partner', 'opponent']

function pairKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

function incrementPair(counts, a, b) {
  const key = pairKey(a, b)
  counts.set(key, (counts.get(key) || 0) + 1)
}

function analyzePairs(playerIds, counts) {
  let missing = 0
  let repeats = 0
  let maxCount = 0
  const uniqueByPlayer = new Map(playerIds.map(id => [id, new Set()]))

  for (let i = 0; i < playerIds.length; i += 1) {
    for (let j = i + 1; j < playerIds.length; j += 1) {
      const a = playerIds[i]
      const b = playerIds[j]
      const count = counts.get(pairKey(a, b)) || 0
      if (count === 0) missing += 1
      if (count > 1) repeats += count - 1
      maxCount = Math.max(maxCount, count)
      if (count > 0) {
        uniqueByPlayer.get(a)?.add(b)
        uniqueByPlayer.get(b)?.add(a)
      }
    }
  }

  return { missing, repeats, maxCount, uniqueByPlayer, counts }
}

function analyzeSchedule(schedule, playerIds, courtCount, caseName) {
  const issues = []
  const partnerCounts = new Map()
  const opponentCounts = new Map()
  const gamesCount = new Map(playerIds.map(id => [id, 0]))
  const rotations = new Map()

  schedule.matches.forEach((match, matchIndex) => {
    const allPlayers = [...match.teamA, ...match.teamB].map(String)
    const uniquePlayers = new Set(allPlayers)

    if (match.teamA.length !== 2 || match.teamB.length !== 2) {
      issues.push({ level: 'fail', caseName, message: `match ${matchIndex + 1} does not have 2v2 teams` })
    }
    if (allPlayers.length !== uniquePlayers.size) {
      issues.push({ level: 'fail', caseName, message: `match ${matchIndex + 1} contains duplicate player` })
    }
    if (match.court < 1 || match.court > courtCount) {
      issues.push({ level: 'fail', caseName, message: `match ${matchIndex + 1} has invalid court ${match.court}` })
    }
    allPlayers.forEach(id => {
      if (!gamesCount.has(id)) issues.push({ level: 'fail', caseName, message: `match ${matchIndex + 1} has unknown player ${id}` })
      gamesCount.set(id, (gamesCount.get(id) || 0) + 1)
    })

    incrementPair(partnerCounts, String(match.teamA[0]), String(match.teamA[1]))
    incrementPair(partnerCounts, String(match.teamB[0]), String(match.teamB[1]))
    match.teamA.forEach(a => match.teamB.forEach(b => incrementPair(opponentCounts, String(a), String(b))))

    const rotationMatches = rotations.get(match.rotation) || []
    rotationMatches.push({ court: match.court, players: allPlayers })
    rotations.set(match.rotation, rotationMatches)
  })

  rotations.forEach((matches, rotation) => {
    if (matches.length > courtCount) {
      issues.push({ level: 'fail', caseName, message: `rotation ${rotation} uses ${matches.length}/${courtCount} courts` })
    }

    const seenPlayers = new Set()
    matches.forEach(match => {
      match.players.forEach(id => {
        if (seenPlayers.has(id)) {
          issues.push({ level: 'fail', caseName, message: `player ${id} appears twice in rotation ${rotation}` })
        }
        seenPlayers.add(id)
      })
    })
  })

  const games = [...gamesCount.values()]
  const gamesRange = games.length ? Math.max(...games) - Math.min(...games) : 0
  const partnerStats = analyzePairs(playerIds, partnerCounts)
  const opponentStats = analyzePairs(playerIds, opponentCounts)

  return { issues, gamesCount, gamesRange, partnerStats, opponentStats }
}

function validateFullCase(n, courts, priority) {
  const playerIds = Array.from({ length: n }, (_, index) => `P${index + 1}`)
  const caseName = `full n=${n} courts=${courts} priority=${priority}`
  const started = performance.now()
  const schedule = buildRoundRobinDoublesSchedule(playerIds, courts, undefined, { priority })
  const runtimeMs = performance.now() - started
  const analysis = analyzeSchedule(schedule, playerIds, courts, caseName)
  const issues = [...analysis.issues]
  const minimumPartnerRepeats = (n * (n - 1) / 2) % 2

  if (analysis.partnerStats.missing > 0) {
    issues.push({ level: 'fail', caseName, message: `missing ${analysis.partnerStats.missing} partner pairs` })
  }
  if (analysis.partnerStats.repeats > minimumPartnerRepeats) {
    issues.push({ level: 'fail', caseName, message: `partner repeats ${analysis.partnerStats.repeats}, expected <= ${minimumPartnerRepeats}` })
  }
  if (analysis.gamesRange > 1) {
    issues.push({ level: 'warn', caseName, message: `games range is ${analysis.gamesRange}` })
  }
  if (analysis.opponentStats.missing > 0) {
    issues.push({ level: 'warn', caseName, message: `missing ${analysis.opponentStats.missing} opponent pairs` })
  }
  if (runtimeMs > 150) {
    issues.push({ level: 'warn', caseName, message: `runtime ${runtimeMs.toFixed(1)}ms` })
  }

  return { caseName, schedule, analysis, runtimeMs, issues }
}

function validateLimitedCase(n, courts, priority, minGamesPerPlayer) {
  const playerIds = Array.from({ length: n }, (_, index) => `P${index + 1}`)
  const caseName = `limited n=${n} courts=${courts} min=${minGamesPerPlayer} priority=${priority}`
  const started = performance.now()
  const schedule = buildRoundRobinDoublesSchedule(playerIds, courts, undefined, { priority, minGamesPerPlayer })
  const runtimeMs = performance.now() - started
  const analysis = analyzeSchedule(schedule, playerIds, courts, caseName)
  const issues = [...analysis.issues]
  const games = [...analysis.gamesCount.values()]
  const minGames = games.length ? Math.min(...games) : 0

  if (minGames < minGamesPerPlayer) {
    issues.push({ level: 'fail', caseName, message: `min games ${minGames}, expected >= ${minGamesPerPlayer}` })
  }
  if (analysis.gamesRange > 1) {
    issues.push({ level: 'warn', caseName, message: `games range is ${analysis.gamesRange}` })
  }
  if (analysis.partnerStats.repeats > Math.ceil(n / 4)) {
    issues.push({ level: 'warn', caseName, message: `partner repeats ${analysis.partnerStats.repeats}` })
  }
  if (runtimeMs > 200) {
    issues.push({ level: 'warn', caseName, message: `runtime ${runtimeMs.toFixed(1)}ms` })
  }

  return { caseName, schedule, analysis, runtimeMs, issues }
}

function main() {
  const allIssues = []
  const summaries = []
  let caseCount = 0
  const isFullMatrix = process.argv.includes('--full')
  const showDetails = process.argv.includes('--details')
  const fullNs = Array.from({ length: 17 }, (_, index) => index + 4)
  const quickLimitedNs = new Set([8, 9, 12])

  for (const n of fullNs) {
    for (let courts = 1; courts <= Math.floor(n / 4); courts += 1) {
      priorities.forEach(priority => {
        const result = validateFullCase(n, courts, priority)
        caseCount += 1
        allIssues.push(...result.issues)
        summaries.push([
          result.caseName,
          `matches=${result.schedule.matches.length}`,
          `rounds=${result.schedule.rounds}`,
          `gamesRange=${result.analysis.gamesRange}`,
          `partnerMissing=${result.analysis.partnerStats.missing}`,
          `partnerRepeat=${result.analysis.partnerStats.repeats}`,
          `oppMissing=${result.analysis.opponentStats.missing}`,
          `oppMax=${result.analysis.opponentStats.maxCount}`,
          `ms=${result.runtimeMs.toFixed(1)}`,
        ].join(' | '))
      })

      if (!isFullMatrix && !quickLimitedNs.has(n)) continue
      if (!isFullMatrix && courts !== 1 && courts !== Math.floor(n / 4)) continue

      const limitedMins = isFullMatrix
        ? [...new Set([2, 4, Math.min(6, n - 1)].filter(value => value <= n - 1))]
        : [2, 4].filter(value => value <= n - 1)
      limitedMins.forEach(minGamesPerPlayer => {
        const limitedPriorities = isFullMatrix ? priorities : ['balanced']
        limitedPriorities.forEach(priority => {
          const result = validateLimitedCase(n, courts, priority, minGamesPerPlayer)
          caseCount += 1
          allIssues.push(...result.issues)
          summaries.push([
            result.caseName,
            `matches=${result.schedule.matches.length}`,
            `rounds=${result.schedule.rounds}`,
            `gamesRange=${result.analysis.gamesRange}`,
            `partnerMissing=${result.analysis.partnerStats.missing}`,
            `partnerRepeat=${result.analysis.partnerStats.repeats}`,
            `oppMissing=${result.analysis.opponentStats.missing}`,
            `oppMax=${result.analysis.opponentStats.maxCount}`,
            `ms=${result.runtimeMs.toFixed(1)}`,
          ].join(' | '))
        })
      })
    }
  }

  const failures = allIssues.filter(issue => issue.level === 'fail')
  const warnings = allIssues.filter(issue => issue.level === 'warn')

  console.log(`Round-robin scheduler validation (${isFullMatrix ? 'full' : 'quick'}): ${caseCount} cases`)
  console.log(`Failures: ${failures.length}`)
  console.log(`Warnings: ${warnings.length}`)

  if (failures.length > 0) {
    console.log('\nFAILURES')
    failures.slice(0, 80).forEach(issue => console.log(`- ${issue.caseName}: ${issue.message}`))
  }

  if (warnings.length > 0) {
    console.log('\nWARNINGS')
    warnings.slice(0, 80).forEach(issue => console.log(`- ${issue.caseName}: ${issue.message}`))
  }

  console.log('\nSAMPLE SUMMARY')
  summaries
    .filter(line => line.includes('full n=9 courts=1') || line.includes('full n=12 courts=3') || line.includes('limited n=9 courts=1 min=4'))
    .slice(0, 20)
    .forEach(line => console.log(`- ${line}`))

  if (showDetails) {
    console.log('\nFULL CASE SUMMARY')
    summaries.forEach(line => console.log(`- ${line}`))
  }

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

main()
