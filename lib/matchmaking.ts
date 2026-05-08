export type MatchStatus = 'WAITLIST' | 'MATCHED' | 'LOWER_SKILL'

export function getMatchStatus(
  userElo: number,
  matchElo: number,
  currentSlots: number,
  maxSlots: number
): MatchStatus {
  if (currentSlots >= maxSlots) return 'WAITLIST'
  
  // Use 800 as the baseline for comparison since it's the minimum level in the system.
  // We also add a 75-point buffer to matchElo to account for sessions using 'Seed ELO' 
  // (midpoints) as their minimum requirement instead of the absolute band minimum.
  const effectiveUserElo = Math.max(userElo, 800)
  const effectiveMatchElo = Math.max(matchElo - 75, 0)
  
  if (effectiveUserElo >= effectiveMatchElo) return 'MATCHED'
  return 'LOWER_SKILL'
}
