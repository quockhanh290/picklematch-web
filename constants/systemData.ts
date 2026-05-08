/**
 * PickleMatch System Data Constants
 * Centralized lists for districts, skill levels, ELO bands, and other application-wide categories.
 */

export const CITIES = [
  { id: 'hcm', label: 'TP. Hồ Chí Minh' },
  { id: 'dn', label: 'Đà Nẵng' },
]

export const DISTRICTS_BY_CITY: Record<string, string[]> = {
  hcm: [
    'Quận 1',
    'Quận 3',
    'Quận 4',
    'Quận 5',
    'Quận 6',
    'Quận 7',
    'Quận 8',
    'Quận 10',
    'Quận 11',
    'Quận 12',
    'Bình Thạnh',
    'Gò Vấp',
    'Phú Nhuận',
    'Tân Bình',
    'Tân Phú',
    'Bình Tân',
    'Thủ Đức',
    'Hóc Môn',
    'Củ Chi',
    'Nhà Bè',
    'Bình Chánh',
    'Cần Giờ',
  ],
  dn: [
    'Hải Châu',
    'Thanh Khê',
    'Sơn Trà',
    'Ngũ Hành Sơn',
    'Liên Chiểu',
    'Cẩm Lệ',
    'Hòa Vang',
    'Hoàng Sa',
  ],
}

/**
 * Flat list of all districts for simple selection components
 */
export const ALL_DISTRICTS = [
  ...DISTRICTS_BY_CITY.hcm,
  ...DISTRICTS_BY_CITY.dn,
]

export const TIME_SLOTS = [
  { id: 'morning', label: 'Sáng' },
  { id: 'afternoon', label: 'Chiều' },
  { id: 'evening', label: 'Tối' },
]

// PVNA (Pickleball Vietnam National Assessment) Skill Level Definitions
export type EloLevelId = 'pvna_1' | 'pvna_2' | 'pvna_3' | 'pvna_4' | 'pvna_5' | 'pvna_6'
export type EloTier = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'expert' | 'pro'
export type LegacySkillLabel = 'beginner' | 'basic' | 'intermediate' | 'advanced'

export type EloBand = {
  levelId: EloLevelId
  shortLabel: string
  simpleLabel: string
  userDescription: string
  tier: EloTier
  legacySkillLabel: LegacySkillLabel
  eloMin: number
  eloMax: number
  seedElo: number
  pvnaRange: string
}

export const ELO_BANDS: EloBand[] = [
  {
    levelId: 'pvna_1',
    shortLabel: '2.1',
    simpleLabel: 'Level 2.1 - 2.5',
    userDescription: 'Mới làm quen, đang học luật và kỹ thuật cơ bản.',
    tier: 'beginner',
    legacySkillLabel: 'beginner',
    eloMin: 800,
    eloMax: 999,
    seedElo: 900,
    pvnaRange: '2.1 - 2.5',
  },
  {
    levelId: 'pvna_2',
    shortLabel: '2.6',
    simpleLabel: 'Level 2.6 - 3.0',
    userDescription: 'Đã nắm luật, bắt đầu chơi ổn định và vào nhịp.',
    tier: 'novice',
    legacySkillLabel: 'basic',
    eloMin: 1000,
    eloMax: 1149,
    seedElo: 1075,
    pvnaRange: '2.6 - 3.0',
  },
  {
    levelId: 'pvna_3',
    shortLabel: '3.1',
    simpleLabel: 'Level 3.1 - 3.5',
    userDescription: 'Chơi đều, dink tốt, biết sử dụng chiến thuật cơ bản.',
    tier: 'intermediate',
    legacySkillLabel: 'intermediate',
    eloMin: 1150,
    eloMax: 1299,
    seedElo: 1225,
    pvnaRange: '3.1 - 3.5',
  },
  {
    levelId: 'pvna_4',
    shortLabel: '3.6',
    simpleLabel: 'Level 3.6 - 4.5',
    userDescription: 'Kỹ thuật tốt, xử lý tình huống linh hoạt, nhịp độ cao.',
    tier: 'advanced',
    legacySkillLabel: 'intermediate',
    eloMin: 1300,
    eloMax: 1449,
    seedElo: 1375,
    pvnaRange: '3.6 - 4.5',
  },
  {
    levelId: 'pvna_5',
    shortLabel: '4.6',
    simpleLabel: 'Level 4.6 - 5.2',
    userDescription: 'Xử lý ổn định dưới áp lực, chiến thuật chuyên sâu.',
    tier: 'expert',
    legacySkillLabel: 'advanced',
    eloMin: 1450,
    eloMax: 1599,
    seedElo: 1525,
    pvnaRange: '4.6 - 5.2',
  },
  {
    levelId: 'pvna_6',
    shortLabel: '5.5+',
    simpleLabel: 'Level 5.5+',
    userDescription: 'Trình độ thi đấu chuyên nghiệp, kỹ thuật hoàn hảo.',
    tier: 'pro',
    legacySkillLabel: 'advanced',
    eloMin: 1600,
    eloMax: 2500,
    seedElo: 1700,
    pvnaRange: '5.3+',
  },
]

export const CREATE_SESSION_ELO_LEVELS = ELO_BANDS.map((band) => ({ elo: band.seedElo }))

/**
 * Skill level mapping for dropdowns and filters
 */
export const SKILL_LEVELS = ELO_BANDS.map(band => ({
  id: band.levelId,
  label: `${band.shortLabel} (${band.pvnaRange})`
}))
