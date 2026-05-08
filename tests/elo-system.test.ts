import { 
  getEloBandForElo, 
  getEloBandForSessionRange, 
  getLevelIdForElo 
} from '../lib/eloSystem'

describe('ELO System Logic', () => {
  it('should map ELO to the correct level band', () => {
    // Beginner
    expect(getLevelIdForElo(850)).toBe('pvna_1')
    
    // Novice midpoint
    expect(getLevelIdForElo(1100)).toBe('pvna_2')
    
    // Boundary check
    expect(getLevelIdForElo(999)).toBe('pvna_1')
    expect(getLevelIdForElo(1000)).toBe('pvna_2')
    
    // Advanced
    expect(getLevelIdForElo(1400)).toBe('pvna_4')
  })

  it('should handle out-of-bounds ELO values gracefully', () => {
    // Below minimum
    expect(getLevelIdForElo(100)).toBe('pvna_1')
    
    // Above maximum
    expect(getLevelIdForElo(3000)).toBe('pvna_6')
  })

  it('should calculate session range band correctly based on midpoint', () => {
    // 900 - 1100 midpoint is 1000 (PVNA 2)
    const band = getEloBandForSessionRange(900, 1100)
    expect(band.levelId).toBe('pvna_2')
    
    // 1100 - 1300 midpoint is 1200 (PVNA 3)
    const band2 = getEloBandForSessionRange(1100, 1300)
    expect(band2.levelId).toBe('pvna_3')
  })

  it('should return null for invalid ELO inputs if using getEloBandForElo', () => {
    // @ts-ignore
    expect(getEloBandForElo(null)).toBeNull()
    // @ts-ignore
    expect(getEloBandForElo(undefined)).toBeNull()
  })
})
