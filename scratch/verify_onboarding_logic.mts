// Mocking the parts needed for calculation
const getTierForElo = (elo: number) => 'mock-tier'

function calculateInitialElo(
  answers: Record<string, number>,
  timePlayingId: string,
  preference: string
): {
  elo: number
  tier: string
  preference: string
} {
  const totalScore = Object.entries(answers)
    .filter(([key]) => key !== 'play_preference')
    .reduce((sum, [, score]) => sum + (score ?? 0), 0)

  let elo: number
  if (totalScore <= 35) elo = 800
  else if (totalScore <= 70) elo = 900
  else if (totalScore <= 105) elo = 1000
  else if (totalScore <= 140) elo = 1100
  else if (totalScore <= 180) elo = 1200
  else if (totalScore <= 215) elo = 1300
  else elo = 1375

  const ceilings: Record<string, number> = {
    'time_none': 900,
    'time_beginner': 1050,
    'time_intermediate': 1200,
    'time_advanced': 1350,
    'time_expert': 1425,
  }

  const ceiling = ceilings[timePlayingId] ?? 1350
  elo = Math.min(elo, ceiling)

  return { elo, tier: getTierForElo(elo), preference }
}

const testCases = [
  {
    answers: {
      time_playing: 0,
      sport_background: 0,
      rally: 0,
      kitchen: 0,
      overhead: 0,
      win_rate: 0,
    },
    timePlayingId: 'time_none',
    preference: 'Ai cũng được',
    expectedElo: 800,
  },
  {
    answers: {
      time_playing: 55,
      sport_background: 20,
      rally: 45,
      kitchen: 40,
      overhead: 30,
      win_rate: 50,
    },
    timePlayingId: 'time_expert',
    preference: 'Người cùng trình',
    expectedElo: 1375, // Total score 240, ceiling 1425
  },
  {
    answers: {
      time_playing: 55,
      sport_background: 20,
      rally: 45,
      kitchen: 40,
      overhead: 30,
      win_rate: 50,
    },
    timePlayingId: 'time_none',
    preference: 'Người cùng trình',
    expectedElo: 900, // Total score 240, ceiling 900
  }
]

testCases.forEach((tc, i) => {
  const result = calculateInitialElo(tc.answers, tc.timePlayingId, tc.preference)
  console.log(`Test Case ${i + 1}: Expected ${tc.expectedElo}, Got ${result.elo}`)
  if (result.elo !== tc.expectedElo) {
    console.error('FAILED')
    process.exit(1)
  } else {
    console.log('PASSED')
  }
})
