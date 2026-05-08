import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DUMMY_PASSWORD = process.env.DUMMY_PASSWORD || 'Pickle123!'

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-dummy-data.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const IDS = {
  courts: {
    tanBinh: '11111111-1111-1111-1111-111111111111',
    vanPhuc: '22222222-2222-2222-2222-222222222222',
    thaoDien: '33333333-3333-3333-3333-333333333333',
  },
  slots: {
    openConfirmed: '44444444-4444-4444-4444-444444444441',
    openApproval: '44444444-4444-4444-4444-444444444442',
    fullConfirmed: '44444444-4444-4444-4444-444444444443',
    doneRecent: '44444444-4444-4444-4444-444444444444',
    cancelled: '44444444-4444-4444-4444-444444444445',
    provisionalHost: '44444444-4444-4444-4444-444444444446',
    doneHistorical: '44444444-4444-4444-4444-444444444447',
    resultsPending: '44444444-4444-4444-4444-444444444448',
    resultsDisputed: '44444444-4444-4444-4444-444444444449',
    pendingCompletion: '44444444-4444-4444-4444-444444444450',
    autoClosed: '44444444-4444-4444-4444-444444444451',
    ghostVoided: '44444444-4444-4444-4444-444444444452',
  },
  sessions: {
    openConfirmed: '55555555-5555-5555-5555-555555555551',
    openApproval: '55555555-5555-5555-5555-555555555552',
    fullConfirmed: '55555555-5555-5555-5555-555555555553',
    doneRecent: '55555555-5555-5555-5555-555555555554',
    cancelled: '55555555-5555-5555-5555-555555555555',
    provisionalHost: '55555555-5555-5555-5555-555555555556',
    doneHistorical: '55555555-5555-5555-5555-555555555557',
    resultsPending: '55555555-5555-5555-5555-555555555558',
    resultsDisputed: '55555555-5555-5555-5555-555555555559',
    pendingCompletion: '55555555-5555-5555-5555-555555555560',
    autoClosed: '55555555-5555-5555-5555-555555555561',
    ghostVoided: '55555555-5555-5555-5555-555555555562',
  },
  notifications: {
    joinRequest: '66666666-6666-6666-6666-666666666661',
    joinApproved: '66666666-6666-6666-6666-666666666662',
    joinRejected: '66666666-6666-6666-6666-666666666663',
    playerLeft: '66666666-6666-6666-6666-666666666664',
    sessionCancelled: '66666666-6666-6666-6666-666666666665',
    sessionUpdated: '66666666-6666-6666-6666-666666666666',
    joinRequestReply: '66666666-6666-6666-6666-666666666667',
    achievementUnlocked: '66666666-6666-6666-6666-666666666668',
    sessionPendingCompletion: '66666666-6666-6666-6666-666666666669',
    sessionResultsSubmitted: '66666666-6666-6666-6666-666666666670',
    sessionResultsDisputed: '66666666-6666-6666-6666-666666666671',
    sessionAutoClosed: '66666666-6666-6666-6666-666666666672',
    sessionReadyForRating: '66666666-6666-6666-6666-666666666673',
    ghostSessionVoided: '66666666-6666-6666-6666-666666666674',
    hostUnprofessionalReported: '66666666-6666-6666-6666-666666666675',
  },
  ratings: {
    r1: '77777777-7777-7777-7777-777777777771',
    r2: '77777777-7777-7777-7777-777777777772',
    r3: '77777777-7777-7777-7777-777777777773',
    r4: '77777777-7777-7777-7777-777777777774',
  },
}

const USERS = [
  {
    key: 'hostConfirmed',
    email: 'host.confirmed@picklematch.vn',
    phone: '+84990000001',
    name: 'Minh Tú',
    city: 'Hồ Chí Minh',
    level: 'level_4',
    skill_label: 'intermediate',
    elo: 1300,
    current_elo: 1315,
    auto_accept: true,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 18,
    no_show_count: 0,
    reliability_score: 98,
    host_reputation: 28,
    earned_badges: ['Friendly', 'On-time', 'Great Host'],
  },
  {
    key: 'hostApproval',
    email: 'host.approval@picklematch.vn',
    phone: '+84990000002',
    name: 'Thu Trang',
    city: 'Hồ Chí Minh',
    level: 'level_3',
    skill_label: 'intermediate',
    elo: 1150,
    current_elo: 1165,
    auto_accept: false,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 12,
    no_show_count: 1,
    reliability_score: 92,
    host_reputation: 15,
    earned_badges: ['Friendly'],
  },
  {
    key: 'matchedPlayer',
    email: 'player.matched@picklematch.vn',
    phone: '+84990000003',
    name: 'Kevin',
    city: 'Hồ Chí Minh',
    level: 'level_4',
    skill_label: 'intermediate',
    elo: 1300,
    current_elo: 1285,
    auto_accept: false,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 10,
    no_show_count: 0,
    reliability_score: 96,
    host_reputation: 0,
    earned_badges: ['Fair Play'],
  },
  {
    key: 'lowerSkillPlayer',
    email: 'player.lower@picklematch.vn',
    phone: '+84990000004',
    name: 'Bảo Ngọc',
    city: 'Hồ Chí Minh',
    level: 'level_2',
    skill_label: 'basic',
    elo: 1000,
    current_elo: 1020,
    auto_accept: false,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 7,
    no_show_count: 1,
    reliability_score: 88,
    host_reputation: 0,
    earned_badges: [],
  },
  {
    key: 'waitlistPlayer',
    email: 'player.waitlist@picklematch.vn',
    phone: '+84990000005',
    name: 'Đức Anh',
    city: 'Hồ Chí Minh',
    level: 'level_5',
    skill_label: 'advanced',
    elo: 1500,
    current_elo: 1490,
    auto_accept: false,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 15,
    no_show_count: 0,
    reliability_score: 97,
    host_reputation: 0,
    earned_badges: ['On-time'],
  },
  {
    key: 'provisionalHost',
    email: 'host.provisional@picklematch.vn',
    phone: '+84990000006',
    name: 'Phương Linh',
    city: 'Hồ Chí Minh',
    level: 'level_2',
    skill_label: 'basic',
    elo: 1000,
    current_elo: 1000,
    auto_accept: false,
    is_provisional: true,
    placement_matches_played: 2,
    sessions_joined: 4,
    no_show_count: 0,
    reliability_score: 100,
    host_reputation: 4,
    earned_badges: [],
  },
  {
    key: 'socialPlayer',
    email: 'player.social@picklematch.vn',
    phone: '+84990000007',
    name: 'Hoàng Nam',
    city: 'Hồ Chí Minh',
    level: 'level_3',
    skill_label: 'intermediate',
    elo: 1150,
    current_elo: 1175,
    auto_accept: false,
    is_provisional: false,
    placement_matches_played: 5,
    sessions_joined: 9,
    no_show_count: 0,
    reliability_score: 95,
    host_reputation: 0,
    earned_badges: ['Friendly'],
  },
  {
    key: 'freshOnboardingUser',
    email: 'player.fresh@picklematch.vn',
    phone: '+84990000008',
    name: 'Ngoc Mai',
    city: 'Ho Chi Minh',
    level: 'level_1',
    skill_label: 'beginner',
    elo: 800,
    current_elo: 800,
    auto_accept: false,
    is_provisional: true,
    placement_matches_played: 0,
    sessions_joined: 0,
    no_show_count: 0,
    reliability_score: 100,
    host_reputation: 0,
    earned_badges: [],
    seedPlayer: false,
  },
]

function isoAt(dayOffset, hour, minute) {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

function dateOnlyFromIso(iso) {
  return iso.slice(0, 10)
}

async function listAllUsers() {
  let page = 1
  const perPage = 200
  const all = []

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    all.push(...users)
    if (users.length < perPage) break
    page += 1
  }

  return all
}

async function ensureAuthUsers() {
  const existingUsers = await listAllUsers()
  const result = {}

  for (const userDef of USERS) {
    const existing = existingUsers.find((user) => user.email === userDef.email)

    if (existing) {
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
        email: userDef.email,
        password: DUMMY_PASSWORD,
        phone: userDef.phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: {
          name: userDef.name,
          seed: 'picklematch-dummy',
        },
      })
      if (error) throw error
      result[userDef.key] = data.user
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: userDef.email,
        password: DUMMY_PASSWORD,
        phone: userDef.phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: {
          name: userDef.name,
          seed: 'picklematch-dummy',
        },
      })
      if (error) throw error
      result[userDef.key] = data.user
    }
  }

  return result
}

async function resetDummyRows(authUsers) {
  const sessionIds = Object.values(IDS.sessions)
  const slotIds = Object.values(IDS.slots)
  const courtIds = Object.values(IDS.courts)
  const ratingIds = Object.values(IDS.ratings)
  const playerIds = Object.values(authUsers).map((user) => user.id)

  await supabase.from('player_achievements').delete().in('player_id', playerIds)
  await supabase.from('player_stats').delete().in('player_id', playerIds)
  await supabase.from('ratings').delete().in('id', ratingIds)
  await supabase.from('ratings').delete().in('session_id', sessionIds)
  await supabase.from('ratings').delete().in('rated_id', playerIds)
  await supabase.from('ratings').delete().in('rater_id', playerIds)
  await supabase.from('notifications').delete().in('player_id', playerIds)
  await supabase.from('join_requests').delete().in('match_id', sessionIds)
  await supabase.from('join_requests').delete().in('player_id', playerIds)
  await supabase.from('session_players').delete().in('session_id', sessionIds)
  await supabase.from('sessions').delete().in('id', sessionIds)
  await supabase.from('court_slots').delete().in('id', slotIds)
  await supabase.from('courts').delete().in('id', courtIds)
  await supabase.from('players').delete().in('id', playerIds)
}

async function seedPlayerStatsAndAchievements(authUsers) {
  const statsRows = [
    {
      player_id: authUsers.hostConfirmed.id,
      total_matches: 24,
      total_wins: 16,
      current_win_streak: 3,
      max_win_streak: 6,
      last_match_at: isoAt(-1, 21, 0),
      streak_fire_active: true,
      streak_fire_level: 1,
      host_average_rating: 4.92,
    },
    {
      player_id: authUsers.matchedPlayer.id,
      total_matches: 14,
      total_wins: 9,
      current_win_streak: 2,
      max_win_streak: 4,
      last_match_at: isoAt(-1, 21, 0),
      streak_fire_active: false,
      streak_fire_level: 0,
      host_average_rating: 0,
    },
    {
      player_id: authUsers.provisionalHost.id,
      total_matches: 4,
      total_wins: 2,
      current_win_streak: 1,
      max_win_streak: 2,
      last_match_at: isoAt(-1, 21, 0),
      streak_fire_active: false,
      streak_fire_level: 0,
      host_average_rating: 3.8,
    },
  ]

  const { error: statsError } = await supabase.from('player_stats').upsert(statsRows)
  if (statsError) throw statsError

  const achievementRows = [
    {
      player_id: authUsers.hostConfirmed.id,
      badge_key: 'active_member_20',
      badge_title: 'Hoi vien tich cuc',
      badge_category: 'progression',
      badge_description: 'Hoan thanh 20 tran pickleball tren PickleMatch.',
      icon: 'medal',
      earned_at: isoAt(-10, 8, 0),
      meta: { source: 'seed' },
    },
    {
      player_id: authUsers.hostConfirmed.id,
      badge_key: 'golden_host',
      badge_title: 'Host Vang',
      badge_category: 'conduct',
      badge_description: 'Giu diem host trung binh tu 4.9 tro len.',
      icon: 'shield',
      earned_at: isoAt(-4, 8, 0),
      meta: { source: 'seed' },
    },
    {
      player_id: authUsers.matchedPlayer.id,
      badge_key: 'giant_slayer',
      badge_title: 'Giant Slayer',
      badge_category: 'performance',
      badge_description: 'Thang mot keo co nguong trinh cao hon ban it nhat 100 Elo.',
      icon: 'swords',
      earned_at: isoAt(-6, 8, 0),
      meta: { source: 'seed' },
    },
    {
      player_id: authUsers.matchedPlayer.id,
      badge_key: 'win_streak_3',
      badge_title: 'Win Streak',
      badge_category: 'momentum',
      badge_description: 'Dat chuoi thang 3 tran lien tiep.',
      icon: 'flame',
      earned_at: isoAt(-2, 8, 0),
      meta: { source: 'seed', streak: 3 },
    },
  ]

  const { error: achievementError } = await supabase.from('player_achievements').insert(achievementRows)
  if (achievementError) throw achievementError
}

async function seedPlayers(authUsers) {
  const rows = USERS.filter((userDef) => userDef.seedPlayer !== false).map((userDef) => ({
    id: authUsers[userDef.key].id,
    phone: userDef.phone,
    name: userDef.name,
    city: userDef.city,
    skill_label: userDef.skill_label,
    self_assessed_level: userDef.level,
    elo: userDef.elo,
    current_elo: userDef.current_elo,
    auto_accept: userDef.auto_accept,
    is_provisional: userDef.is_provisional,
    placement_matches_played: userDef.placement_matches_played,
    sessions_joined: userDef.sessions_joined,
    no_show_count: userDef.no_show_count,
    reliability_score: userDef.reliability_score,
    host_reputation: userDef.host_reputation,
    earned_badges: userDef.earned_badges,
    favorite_court_ids: [IDS.courts.tanBinh, IDS.courts.vanPhuc],
  }))

  const { error } = await supabase.from('players').upsert(rows)
  if (error) throw error
}

async function seedCourts() {
  const rows = [
    {
      id: IDS.courts.tanBinh,
      name: 'Sân Pickleball Tân Bình',
      name_en: 'Tan Binh Pickleball',
      address: '123 Hoàng Văn Thụ',
      city: 'Hồ Chí Minh',
      district: 'Tân Bình',
      lat: 10.801,
      lng: 106.658,
      price_per_hour: 240000,
      num_courts: 4,
      rating: 4.7,
      rating_count: 48,
      phone: '0901111111',
      hours_open: '06:00',
      hours_close: '22:00',
      hours_note: 'Mở cả tuần',
      court_type: 'indoor',
      surface: 'hard',
      price_min: 180000,
      price_max: 260000,
      price_note: 'Giờ cao điểm cuối tuần tăng giá',
      highlight: 'Sân sáng, có chỗ gửi xe',
      tags: ['indoor', 'central', 'busy'],
      google_maps_url: 'https://maps.google.com/?q=123+Hoang+Van+Thu',
      booking_url: 'https://example.com/booking/tan-binh',
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.courts.vanPhuc,
      name: 'Sân Pickleball Vạn Phúc',
      name_en: 'Van Phuc Pickleball',
      address: 'Khu đô thị Vạn Phúc',
      city: 'Hồ Chí Minh',
      district: 'Thủ Đức',
      lat: 10.845,
      lng: 106.706,
      price_per_hour: 200000,
      num_courts: 6,
      rating: 4.5,
      rating_count: 31,
      phone: '0902222222',
      hours_open: '06:00',
      hours_close: '23:00',
      hours_note: 'Có khu cafe',
      court_type: 'outdoor',
      surface: 'hard',
      price_min: 150000,
      price_max: 220000,
      price_note: 'Giá ổn định',
      highlight: 'Nhiều sân, dễ ghép đội',
      tags: ['outdoor', 'social'],
      google_maps_url: 'https://maps.google.com/?q=Van+Phuc+City',
      booking_url: 'https://example.com/booking/van-phuc',
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.courts.thaoDien,
      name: 'Sân Pickleball Thảo Điền',
      name_en: 'Thao Dien Pickleball',
      address: '88 Xuân Thuỷ',
      city: 'Hồ Chí Minh',
      district: 'Thảo Điền',
      lat: 10.806,
      lng: 106.736,
      price_per_hour: 280000,
      num_courts: 2,
      rating: 4.9,
      rating_count: 19,
      phone: '0903333333',
      hours_open: '07:00',
      hours_close: '22:00',
      hours_note: 'Sân đẹp, ít slot',
      court_type: 'indoor',
      surface: 'acrylic',
      price_min: 250000,
      price_max: 320000,
      price_note: 'Premium court',
      highlight: 'Phù hợp kèo trình cao',
      tags: ['premium', 'indoor'],
      google_maps_url: 'https://maps.google.com/?q=88+Xuan+Thuy',
      booking_url: 'https://example.com/booking/thao-dien',
      created_at: new Date().toISOString(),
    },
  ]

  const { error } = await supabase.from('courts').upsert(rows)
  if (error) throw error
}

async function seedSlotsAndSessions(authUsers) {
  const times = {
    openConfirmedStart: isoAt(1, 18, 0),
    openConfirmedEnd: isoAt(1, 20, 0),
    openApprovalStart: isoAt(2, 19, 0),
    openApprovalEnd: isoAt(2, 21, 0),
    fullConfirmedStart: isoAt(1, 20, 30),
    fullConfirmedEnd: isoAt(1, 22, 0),
    doneRecentStart: isoAt(-1, 18, 30),
    doneRecentEnd: isoAt(-1, 20, 30),
    cancelledStart: isoAt(3, 18, 0),
    cancelledEnd: isoAt(3, 20, 0),
    provisionalHostStart: isoAt(2, 7, 0),
    provisionalHostEnd: isoAt(2, 9, 0),
    doneHistoricalStart: isoAt(-7, 19, 0),
    doneHistoricalEnd: isoAt(-7, 21, 0),
    resultsPendingStart: isoAt(-1, 21, 0),
    resultsPendingEnd: isoAt(-1, 22, 30),
    resultsDisputedStart: isoAt(-2, 18, 0),
    resultsDisputedEnd: isoAt(-2, 20, 0),
    pendingCompletionStart: isoAt(-1, 8, 0),
    pendingCompletionEnd: isoAt(-1, 10, 0),
    autoClosedStart: isoAt(-3, 19, 0),
    autoClosedEnd: isoAt(-3, 21, 0),
    ghostVoidedStart: isoAt(-4, 18, 30),
    ghostVoidedEnd: isoAt(-4, 20, 0),
  }

  const slots = [
    { id: IDS.slots.openConfirmed, court_id: IDS.courts.tanBinh, start_time: times.openConfirmedStart, end_time: times.openConfirmedEnd, price: 120000, status: 'booked' },
    { id: IDS.slots.openApproval, court_id: IDS.courts.vanPhuc, start_time: times.openApprovalStart, end_time: times.openApprovalEnd, price: 100000, status: 'booked' },
    { id: IDS.slots.fullConfirmed, court_id: IDS.courts.thaoDien, start_time: times.fullConfirmedStart, end_time: times.fullConfirmedEnd, price: 180000, status: 'booked' },
    { id: IDS.slots.doneRecent, court_id: IDS.courts.vanPhuc, start_time: times.doneRecentStart, end_time: times.doneRecentEnd, price: 110000, status: 'booked' },
    { id: IDS.slots.cancelled, court_id: IDS.courts.tanBinh, start_time: times.cancelledStart, end_time: times.cancelledEnd, price: 125000, status: 'booked' },
    { id: IDS.slots.provisionalHost, court_id: IDS.courts.tanBinh, start_time: times.provisionalHostStart, end_time: times.provisionalHostEnd, price: 90000, status: 'booked' },
    { id: IDS.slots.doneHistorical, court_id: IDS.courts.thaoDien, start_time: times.doneHistoricalStart, end_time: times.doneHistoricalEnd, price: 150000, status: 'booked' },
    { id: IDS.slots.resultsPending, court_id: IDS.courts.vanPhuc, start_time: times.resultsPendingStart, end_time: times.resultsPendingEnd, price: 105000, status: 'booked' },
    { id: IDS.slots.resultsDisputed, court_id: IDS.courts.thaoDien, start_time: times.resultsDisputedStart, end_time: times.resultsDisputedEnd, price: 165000, status: 'booked' },
    { id: IDS.slots.pendingCompletion, court_id: IDS.courts.tanBinh, start_time: times.pendingCompletionStart, end_time: times.pendingCompletionEnd, price: 95000, status: 'booked' },
    { id: IDS.slots.autoClosed, court_id: IDS.courts.vanPhuc, start_time: times.autoClosedStart, end_time: times.autoClosedEnd, price: 115000, status: 'booked' },
    { id: IDS.slots.ghostVoided, court_id: IDS.courts.tanBinh, start_time: times.ghostVoidedStart, end_time: times.ghostVoidedEnd, price: 130000, status: 'booked' },
  ]

  const { error: slotError } = await supabase.from('court_slots').upsert(slots)
  if (slotError) throw slotError

  const sessions = [
    {
      id: IDS.sessions.openConfirmed,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.openConfirmed,
      elo_min: 1150,
      elo_max: 1400,
      max_players: 4,
      status: 'open',
      require_approval: false,
      fill_deadline: isoAt(1, 15, 0),
      total_cost: 480000,
      court_fee_total: 480000,
      cost_per_player: 120000,
      start_time: times.openConfirmedStart,
      end_time: times.openConfirmedEnd,
      court_id: IDS.courts.tanBinh,
      session_date: dateOnlyFromIso(times.openConfirmedStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TB-BOOK-001',
      booking_name: 'Minh Tú',
      booking_phone: '+84990000001',
      booking_notes: 'Đã cọc sân',
      booking_confirmed_at: new Date().toISOString(),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.openApproval,
      host_id: authUsers.hostApproval.id,
      slot_id: IDS.slots.openApproval,
      elo_min: 1150,
      elo_max: 1300,
      max_players: 4,
      status: 'open',
      require_approval: true,
      fill_deadline: isoAt(2, 13, 0),
      total_cost: 400000,
      court_fee_total: 400000,
      cost_per_player: 100000,
      start_time: times.openApprovalStart,
      end_time: times.openApprovalEnd,
      court_id: IDS.courts.vanPhuc,
      session_date: dateOnlyFromIso(times.openApprovalStart),
      court_booking_status: 'unconfirmed',
      booking_reference: null,
      booking_name: null,
      booking_phone: null,
      booking_notes: null,
      booking_confirmed_at: null,
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.fullConfirmed,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.fullConfirmed,
      elo_min: 1300,
      elo_max: 1500,
      max_players: 4,
      status: 'open',
      require_approval: false,
      fill_deadline: isoAt(1, 18, 0),
      total_cost: 720000,
      court_fee_total: 720000,
      cost_per_player: 180000,
      start_time: times.fullConfirmedStart,
      end_time: times.fullConfirmedEnd,
      court_id: IDS.courts.thaoDien,
      session_date: dateOnlyFromIso(times.fullConfirmedStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TD-BOOK-002',
      booking_name: 'Minh Tú',
      booking_phone: '+84990000001',
      booking_notes: 'Slot premium',
      booking_confirmed_at: new Date().toISOString(),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.doneRecent,
      host_id: authUsers.hostApproval.id,
      slot_id: IDS.slots.doneRecent,
      elo_min: 1000,
      elo_max: 1300,
      max_players: 4,
      status: 'done',
      require_approval: false,
      fill_deadline: isoAt(-1, 16, 0),
      total_cost: 440000,
      court_fee_total: 440000,
      cost_per_player: 110000,
      start_time: times.doneRecentStart,
      end_time: times.doneRecentEnd,
      court_id: IDS.courts.vanPhuc,
      session_date: dateOnlyFromIso(times.doneRecentStart),
      court_booking_status: 'confirmed',
      booking_reference: 'VP-BOOK-003',
      booking_name: 'Thu Trang',
      booking_phone: '+84990000002',
      booking_notes: 'Vừa xong kèo để test rating',
      booking_confirmed_at: isoAt(-2, 12, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.cancelled,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.cancelled,
      elo_min: 1000,
      elo_max: 1200,
      max_players: 4,
      status: 'cancelled',
      require_approval: false,
      fill_deadline: isoAt(3, 14, 0),
      total_cost: 500000,
      court_fee_total: 500000,
      cost_per_player: 125000,
      start_time: times.cancelledStart,
      end_time: times.cancelledEnd,
      court_id: IDS.courts.tanBinh,
      session_date: dateOnlyFromIso(times.cancelledStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TB-BOOK-004',
      booking_name: 'Minh Tú',
      booking_phone: '+84990000001',
      booking_notes: 'Cancelled after full',
      booking_confirmed_at: new Date().toISOString(),
      was_full_when_cancelled: true,
    },
    {
      id: IDS.sessions.provisionalHost,
      host_id: authUsers.provisionalHost.id,
      slot_id: IDS.slots.provisionalHost,
      elo_min: 800,
      elo_max: 1050,
      max_players: 6,
      status: 'open',
      require_approval: false,
      fill_deadline: isoAt(2, 6, 0),
      total_cost: 540000,
      court_fee_total: 540000,
      cost_per_player: 90000,
      start_time: times.provisionalHostStart,
      end_time: times.provisionalHostEnd,
      court_id: IDS.courts.tanBinh,
      session_date: dateOnlyFromIso(times.provisionalHostStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TB-BOOK-005',
      booking_name: 'Phương Linh',
      booking_phone: '+84990000006',
      booking_notes: 'Host provisional để test badge',
      booking_confirmed_at: new Date().toISOString(),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.doneHistorical,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.doneHistorical,
      elo_min: 1200,
      elo_max: 1500,
      max_players: 4,
      status: 'done',
      require_approval: false,
      fill_deadline: isoAt(-7, 14, 0),
      total_cost: 600000,
      court_fee_total: 600000,
      cost_per_player: 150000,
      start_time: times.doneHistoricalStart,
      end_time: times.doneHistoricalEnd,
      court_id: IDS.courts.thaoDien,
      session_date: dateOnlyFromIso(times.doneHistoricalStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TD-BOOK-006',
      booking_name: 'Minh Tú',
      booking_phone: '+84990000001',
      booking_notes: 'Kèo cũ để seed review profile',
      booking_confirmed_at: isoAt(-8, 10, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.resultsPending,
      host_id: authUsers.hostApproval.id,
      slot_id: IDS.slots.resultsPending,
      elo_min: 1100,
      elo_max: 1300,
      max_players: 4,
      status: 'done',
      results_status: 'pending_confirmation',
      results_submitted_at: isoAt(-1, 23, 0),
      results_confirmation_deadline: isoAt(1, 23, 0),
      require_approval: false,
      fill_deadline: isoAt(-1, 17, 0),
      total_cost: 420000,
      court_fee_total: 420000,
      cost_per_player: 105000,
      start_time: times.resultsPendingStart,
      end_time: times.resultsPendingEnd,
      court_id: IDS.courts.vanPhuc,
      session_date: dateOnlyFromIso(times.resultsPendingStart),
      court_booking_status: 'confirmed',
      booking_reference: 'VP-BOOK-007',
      booking_name: 'Thu Trang',
      booking_phone: '+84990000002',
      booking_notes: 'Host da gui ket qua, dang cho xac nhan.',
      booking_confirmed_at: isoAt(-2, 8, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.resultsDisputed,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.resultsDisputed,
      elo_min: 1200,
      elo_max: 1450,
      max_players: 4,
      status: 'done',
      results_status: 'disputed',
      results_submitted_at: isoAt(-2, 21, 0),
      results_confirmation_deadline: isoAt(0, 21, 0),
      require_approval: false,
      fill_deadline: isoAt(-2, 14, 0),
      total_cost: 660000,
      court_fee_total: 660000,
      cost_per_player: 165000,
      start_time: times.resultsDisputedStart,
      end_time: times.resultsDisputedEnd,
      court_id: IDS.courts.thaoDien,
      session_date: dateOnlyFromIso(times.resultsDisputedStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TD-BOOK-008',
      booking_name: 'Minh Tu',
      booking_phone: '+84990000001',
      booking_notes: 'Dang co player dispute ket qua.',
      booking_confirmed_at: isoAt(-3, 11, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.pendingCompletion,
      host_id: authUsers.hostApproval.id,
      slot_id: IDS.slots.pendingCompletion,
      elo_min: 1000,
      elo_max: 1250,
      max_players: 4,
      status: 'pending_completion',
      results_status: 'not_submitted',
      pending_completion_marked_at: isoAt(-1, 10, 45),
      completion_reminder_sent_at: isoAt(-1, 10, 50),
      require_approval: false,
      fill_deadline: isoAt(-1, 7, 0),
      total_cost: 380000,
      court_fee_total: 380000,
      cost_per_player: 95000,
      start_time: times.pendingCompletionStart,
      end_time: times.pendingCompletionEnd,
      court_id: IDS.courts.tanBinh,
      session_date: dateOnlyFromIso(times.pendingCompletionStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TB-BOOK-009',
      booking_name: 'Thu Trang',
      booking_phone: '+84990000002',
      booking_notes: 'Dang cho host xac nhan ket qua.',
      booking_confirmed_at: isoAt(-2, 9, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.autoClosed,
      host_id: authUsers.hostApproval.id,
      slot_id: IDS.slots.autoClosed,
      elo_min: 1000,
      elo_max: 1250,
      max_players: 4,
      status: 'done',
      results_status: 'finalized',
      results_submitted_at: isoAt(-3, 22, 0),
      results_confirmation_deadline: isoAt(-3, 22, 0),
      pending_completion_marked_at: isoAt(-3, 21, 45),
      auto_closed_at: isoAt(-3, 23, 45),
      auto_closed_reason: 'timeout_no_host_completion',
      finalized_by: 'system',
      require_approval: false,
      fill_deadline: isoAt(-3, 15, 0),
      total_cost: 460000,
      court_fee_total: 460000,
      cost_per_player: 115000,
      start_time: times.autoClosedStart,
      end_time: times.autoClosedEnd,
      court_id: IDS.courts.vanPhuc,
      session_date: dateOnlyFromIso(times.autoClosedStart),
      court_booking_status: 'confirmed',
      booking_reference: 'VP-BOOK-010',
      booking_name: 'Thu Trang',
      booking_phone: '+84990000002',
      booking_notes: 'He thong auto-close vi host chua submit.',
      booking_confirmed_at: isoAt(-4, 10, 0),
      was_full_when_cancelled: false,
    },
    {
      id: IDS.sessions.ghostVoided,
      host_id: authUsers.hostConfirmed.id,
      slot_id: IDS.slots.ghostVoided,
      elo_min: 950,
      elo_max: 1200,
      max_players: 4,
      status: 'cancelled',
      results_status: 'void',
      results_submitted_at: isoAt(-4, 21, 0),
      results_confirmation_deadline: isoAt(-4, 21, 0),
      ghost_session_reported_at: isoAt(-4, 22, 0),
      finalized_by: 'players',
      require_approval: false,
      fill_deadline: isoAt(-4, 14, 0),
      total_cost: 520000,
      court_fee_total: 520000,
      cost_per_player: 130000,
      start_time: times.ghostVoidedStart,
      end_time: times.ghostVoidedEnd,
      court_id: IDS.courts.tanBinh,
      session_date: dateOnlyFromIso(times.ghostVoidedStart),
      court_booking_status: 'confirmed',
      booking_reference: 'TB-BOOK-011',
      booking_name: 'Minh Tu',
      booking_phone: '+84990000001',
      booking_notes: 'Nguoi choi bao tran khong dien ra.',
      booking_confirmed_at: isoAt(-5, 9, 0),
      was_full_when_cancelled: false,
    },
  ]

  const normalizedSessions = sessions.map((session) => ({
    results_status: session.status === 'done' ? 'finalized' : 'not_submitted',
    results_submitted_at: null,
    results_confirmation_deadline: null,
    ghost_session_reported_at: null,
    finalized_by: null,
    ...session,
  }))

  const { error: sessionError } = await supabase.from('sessions').upsert(normalizedSessions)
  if (sessionError) throw sessionError
}

async function seedSessionPlayersAndRequests(authUsers) {
  const sessionPlayers = [
    { session_id: IDS.sessions.openConfirmed, player_id: authUsers.hostConfirmed.id, status: 'confirmed' },
    { session_id: IDS.sessions.openConfirmed, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },

    { session_id: IDS.sessions.openApproval, player_id: authUsers.hostApproval.id, status: 'confirmed' },
    { session_id: IDS.sessions.openApproval, player_id: authUsers.socialPlayer.id, status: 'confirmed' },

    { session_id: IDS.sessions.fullConfirmed, player_id: authUsers.hostConfirmed.id, status: 'confirmed' },
    { session_id: IDS.sessions.fullConfirmed, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.fullConfirmed, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.fullConfirmed, player_id: authUsers.waitlistPlayer.id, status: 'confirmed' },

    { session_id: IDS.sessions.doneRecent, player_id: authUsers.hostApproval.id, status: 'confirmed' },
    { session_id: IDS.sessions.doneRecent, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.doneRecent, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.doneRecent, player_id: authUsers.provisionalHost.id, status: 'confirmed' },

    { session_id: IDS.sessions.cancelled, player_id: authUsers.hostConfirmed.id, status: 'confirmed' },
    { session_id: IDS.sessions.cancelled, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.cancelled, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.cancelled, player_id: authUsers.socialPlayer.id, status: 'confirmed' },

    { session_id: IDS.sessions.provisionalHost, player_id: authUsers.provisionalHost.id, status: 'confirmed' },
    { session_id: IDS.sessions.provisionalHost, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },

    { session_id: IDS.sessions.doneHistorical, player_id: authUsers.hostConfirmed.id, status: 'confirmed' },
    { session_id: IDS.sessions.doneHistorical, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.doneHistorical, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },
    {
      session_id: IDS.sessions.resultsPending,
      player_id: authUsers.hostApproval.id,
      status: 'confirmed',
      proposed_result: 'win',
      match_result: 'pending',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-1, 23, 0),
    },
    {
      session_id: IDS.sessions.resultsPending,
      player_id: authUsers.matchedPlayer.id,
      status: 'confirmed',
      proposed_result: 'loss',
      match_result: 'pending',
      result_confirmation_status: 'awaiting_player',
    },
    {
      session_id: IDS.sessions.resultsPending,
      player_id: authUsers.socialPlayer.id,
      status: 'confirmed',
      proposed_result: 'loss',
      match_result: 'pending',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-1, 23, 20),
    },
    {
      session_id: IDS.sessions.resultsDisputed,
      player_id: authUsers.hostConfirmed.id,
      status: 'confirmed',
      proposed_result: 'win',
      match_result: 'pending',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-2, 21, 0),
    },
    {
      session_id: IDS.sessions.resultsDisputed,
      player_id: authUsers.matchedPlayer.id,
      status: 'confirmed',
      proposed_result: 'loss',
      match_result: 'pending',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-2, 21, 15),
    },
    {
      session_id: IDS.sessions.resultsDisputed,
      player_id: authUsers.socialPlayer.id,
      status: 'confirmed',
      proposed_result: 'loss',
      match_result: 'pending',
      result_confirmation_status: 'disputed',
      result_disputed_at: isoAt(-2, 22, 0),
      result_dispute_note: 'Ty so host submit khong dung voi ket qua thuc te.',
    },
    { session_id: IDS.sessions.pendingCompletion, player_id: authUsers.hostApproval.id, status: 'confirmed' },
    { session_id: IDS.sessions.pendingCompletion, player_id: authUsers.matchedPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.pendingCompletion, player_id: authUsers.lowerSkillPlayer.id, status: 'confirmed' },
    { session_id: IDS.sessions.pendingCompletion, player_id: authUsers.socialPlayer.id, status: 'confirmed' },
    {
      session_id: IDS.sessions.autoClosed,
      player_id: authUsers.hostApproval.id,
      status: 'confirmed',
      proposed_result: 'draw',
      match_result: 'draw',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-3, 23, 45),
    },
    {
      session_id: IDS.sessions.autoClosed,
      player_id: authUsers.matchedPlayer.id,
      status: 'confirmed',
      proposed_result: 'draw',
      match_result: 'draw',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-3, 23, 45),
    },
    {
      session_id: IDS.sessions.autoClosed,
      player_id: authUsers.lowerSkillPlayer.id,
      status: 'confirmed',
      proposed_result: 'draw',
      match_result: 'draw',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-3, 23, 45),
      host_unprofessional_reported_at: isoAt(-3, 23, 55),
      host_unprofessional_report_note: 'Host de he thong auto-close, khong xac nhan ket qua dung han.',
    },
    {
      session_id: IDS.sessions.autoClosed,
      player_id: authUsers.socialPlayer.id,
      status: 'confirmed',
      proposed_result: 'draw',
      match_result: 'draw',
      result_confirmation_status: 'confirmed',
      result_confirmed_at: isoAt(-3, 23, 45),
    },
    {
      session_id: IDS.sessions.ghostVoided,
      player_id: authUsers.hostConfirmed.id,
      status: 'confirmed',
    },
    {
      session_id: IDS.sessions.ghostVoided,
      player_id: authUsers.matchedPlayer.id,
      status: 'confirmed',
      member_reported_result: 'not_played',
      member_reported_at: isoAt(-4, 20, 45),
      member_report_note: 'Host khong co mat, tran khong dien ra.',
    },
    {
      session_id: IDS.sessions.ghostVoided,
      player_id: authUsers.lowerSkillPlayer.id,
      status: 'confirmed',
      member_reported_result: 'not_played',
      member_reported_at: isoAt(-4, 20, 50),
      member_report_note: 'Den san nhung khong thay host.',
    },
    {
      session_id: IDS.sessions.ghostVoided,
      player_id: authUsers.socialPlayer.id,
      status: 'confirmed',
      member_reported_result: 'not_played',
      member_reported_at: isoAt(-4, 20, 55),
      member_report_note: 'Ca nhom xac nhan tran bi ghost.',
    },
  ]

  const normalizedSessionPlayers = sessionPlayers.map((player) => ({
    proposed_result: 'pending',
    match_result: 'pending',
    result_confirmation_status: 'not_submitted',
    member_reported_result: 'pending',
    member_reported_at: null,
    member_report_note: null,
    ...player,
  }))

  const { error: playersError } = await supabase.from('session_players').insert(normalizedSessionPlayers)
  if (playersError) throw playersError

  const joinRequests = [
    {
      match_id: IDS.sessions.openApproval,
      player_id: authUsers.waitlistPlayer.id,
      status: 'pending',
      intro_note: 'Mình đánh ổn và có thể cân kèo, host xem giúp nhé.',
      host_response_template: null,
    },
    {
      match_id: IDS.sessions.openApproval,
      player_id: authUsers.provisionalHost.id,
      status: 'pending',
      intro_note: 'Mình mới qua placement nhưng giữ bóng khá ổn.',
      host_response_template: 'Đợi mình gom đủ người rồi báo nhé',
    },
    {
      match_id: IDS.sessions.openConfirmed,
      player_id: authUsers.socialPlayer.id,
      status: 'accepted',
      intro_note: 'Mình vào giao lưu nhẹ nhàng.',
      host_response_template: null,
    },
  ]

  const { error: requestError } = await supabase.from('join_requests').upsert(joinRequests, {
    onConflict: 'match_id,player_id',
  })
  if (requestError) throw requestError
}

async function seedNotifications(authUsers) {
  const rows = [
    {
      id: IDS.notifications.joinRequest,
      player_id: authUsers.hostApproval.id,
      type: 'join_request',
      title: 'Có yêu cầu tham gia mới',
      body: `${authUsers.waitlistPlayer.user_metadata?.name ?? 'Đức Anh'} muốn vào kèo chờ duyệt của bạn.`,
      deep_link: `/session/${IDS.sessions.openApproval}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.joinApproved,
      player_id: authUsers.matchedPlayer.id,
      type: 'join_approved',
      title: 'Yêu cầu đã được chấp nhận',
      body: 'Host đã đồng ý cho bạn vào kèo.',
      deep_link: `/session/${IDS.sessions.openConfirmed}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.joinRejected,
      player_id: authUsers.waitlistPlayer.id,
      type: 'join_rejected',
      title: 'Yêu cầu chưa được chấp nhận',
      body: 'Host đã từ chối yêu cầu trước đó của bạn.',
      deep_link: `/session/${IDS.sessions.openApproval}`,
      is_read: true,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.playerLeft,
      player_id: authUsers.hostConfirmed.id,
      type: 'player_left',
      title: 'Có người rời kèo',
      body: 'Một người chơi vừa rời khỏi kèo của bạn.',
      deep_link: `/session/${IDS.sessions.openConfirmed}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.sessionCancelled,
      player_id: authUsers.lowerSkillPlayer.id,
      type: 'session_cancelled',
      title: 'Kèo đã bị huỷ',
      body: 'Host đã huỷ kèo trước giờ chơi.',
      deep_link: `/session/${IDS.sessions.cancelled}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.sessionUpdated,
      player_id: authUsers.matchedPlayer.id,
      type: 'session_updated',
      title: 'Kèo vừa được cập nhật',
      body: 'Host vừa thay đổi thời gian và giá của kèo.',
      deep_link: `/session/${IDS.sessions.openConfirmed}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.joinRequestReply,
      player_id: authUsers.provisionalHost.id,
      type: 'join_request_reply',
      title: 'Host đã phản hồi',
      body: 'Đợi mình gom đủ người rồi báo nhé.',
      deep_link: `/session/${IDS.sessions.openApproval}`,
      is_read: true,
      created_at: new Date().toISOString(),
    },
    {
      id: IDS.notifications.sessionPendingCompletion,
      player_id: authUsers.hostApproval.id,
      type: 'session_pending_completion',
      title: 'Keo da het gio',
      body: 'Hay vao xac nhan ket qua cho keo dang pending completion.',
      deep_link: `/session/${IDS.sessions.pendingCompletion}`,
      is_read: false,
      created_at: isoAt(-1, 10, 50),
    },
    {
      id: IDS.notifications.sessionResultsSubmitted,
      player_id: authUsers.matchedPlayer.id,
      type: 'session_results_submitted',
      title: 'Host da gui ket qua',
      body: 'Hay vao xem va xac nhan ket qua cua tran vua xong.',
      deep_link: `/session/${IDS.sessions.resultsPending}`,
      is_read: false,
      created_at: isoAt(-1, 23, 5),
    },
    {
      id: IDS.notifications.sessionResultsDisputed,
      player_id: authUsers.hostConfirmed.id,
      type: 'session_results_disputed',
      title: 'Co tranh chap ket qua',
      body: 'Mot nguoi choi vua bao sai ket qua tran dau.',
      deep_link: `/session/${IDS.sessions.resultsDisputed}`,
      is_read: false,
      created_at: isoAt(-2, 22, 5),
    },
    {
      id: IDS.notifications.sessionAutoClosed,
      player_id: authUsers.hostApproval.id,
      type: 'session_auto_closed',
      title: 'Keo da duoc tu dong dong',
      body: 'He thong da auto-close session vi host chua xac nhan ket qua dung han.',
      deep_link: `/session/${IDS.sessions.autoClosed}`,
      is_read: true,
      created_at: isoAt(-3, 23, 50),
    },
    {
      id: IDS.notifications.sessionReadyForRating,
      player_id: authUsers.socialPlayer.id,
      type: 'session_ready_for_rating',
      title: 'Keo da hoan tat',
      body: 'Ban co the vao danh gia tran dau va nguoi choi khac.',
      deep_link: `/session/${IDS.sessions.autoClosed}`,
      is_read: false,
      created_at: isoAt(-3, 23, 55),
    },
    {
      id: IDS.notifications.ghostSessionVoided,
      player_id: authUsers.hostConfirmed.id,
      type: 'ghost_session_voided',
      title: 'Keo bi danh dau khong dien ra',
      body: 'Nguoi choi da bao tran dau khong dien ra va session bi void.',
      deep_link: `/session/${IDS.sessions.ghostVoided}`,
      is_read: false,
      created_at: isoAt(-4, 22, 10),
    },
    {
      id: IDS.notifications.hostUnprofessionalReported,
      player_id: authUsers.hostApproval.id,
      type: 'host_unprofessional_reported',
      title: 'Host bi bao van hanh kem',
      body: 'Mot nguoi choi vua bao cao host khong xu ly ket qua dung han.',
      deep_link: `/session/${IDS.sessions.autoClosed}`,
      is_read: true,
      created_at: isoAt(-3, 23, 58),
    },
  ]

  const { error } = await supabase.from('notifications').upsert(rows)
  if (error) throw error
}

async function seedRatings(authUsers) {
  const oldDate = isoAt(-6, 12, 0)
  const rows = [
    {
      id: IDS.ratings.r1,
      session_id: IDS.sessions.doneHistorical,
      rater_id: authUsers.matchedPlayer.id,
      rated_id: authUsers.hostConfirmed.id,
      tags: ['friendly', 'fair_play', 'good_description', 'well_organized'],
      no_show: false,
      skill_validation: 'matched',
      is_hidden: false,
      reveal_at: oldDate,
      processed_at: oldDate,
      created_at: oldDate,
    },
    {
      id: IDS.ratings.r2,
      session_id: IDS.sessions.doneHistorical,
      rater_id: authUsers.lowerSkillPlayer.id,
      rated_id: authUsers.hostConfirmed.id,
      tags: ['on_time', 'good_description', 'fair_pairing'],
      no_show: false,
      skill_validation: 'outclass',
      is_hidden: false,
      reveal_at: oldDate,
      processed_at: oldDate,
      created_at: oldDate,
    },
    {
      id: IDS.ratings.r3,
      session_id: IDS.sessions.doneHistorical,
      rater_id: authUsers.hostConfirmed.id,
      rated_id: authUsers.matchedPlayer.id,
      tags: ['friendly', 'skilled', 'on_time'],
      no_show: false,
      skill_validation: 'matched',
      is_hidden: false,
      reveal_at: oldDate,
      processed_at: oldDate,
      created_at: oldDate,
    },
    {
      id: IDS.ratings.r4,
      session_id: IDS.sessions.doneHistorical,
      rater_id: authUsers.hostConfirmed.id,
      rated_id: authUsers.lowerSkillPlayer.id,
      tags: ['fair_play', 'friendly'],
      no_show: false,
      skill_validation: 'weaker',
      is_hidden: false,
      reveal_at: oldDate,
      processed_at: oldDate,
      created_at: oldDate,
    },
  ]

  const { error } = await supabase.from('ratings').upsert(rows)
  if (error) throw error
}

async function main() {
  console.log('Seeding dummy data...')
  const authUsers = await ensureAuthUsers()
  await resetDummyRows(authUsers)
  await seedPlayers(authUsers)
  await seedPlayerStatsAndAchievements(authUsers)
  await seedCourts()
  await seedSlotsAndSessions(authUsers)
  await seedSessionPlayersAndRequests(authUsers)
  await seedNotifications(authUsers)
  await seedRatings(authUsers)

  console.log('\nDummy data seeded successfully.\n')
  console.log('Dev login accounts:')
  for (const userDef of USERS) {
    console.log(`- ${userDef.email} / ${DUMMY_PASSWORD} (${userDef.name})`)
  }

  console.log('\nSuggested test flows:')
  console.log(`- Fresh onboarding user: player.fresh@picklematch.vn / ${DUMMY_PASSWORD}`)
  console.log(`- Home open confirmed: ${IDS.sessions.openConfirmed}`)
  console.log(`- Approval flow: ${IDS.sessions.openApproval}`)
  console.log(`- Full session / waitlist: ${IDS.sessions.fullConfirmed}`)
  console.log(`- Rating session: ${IDS.sessions.doneRecent}`)
  console.log(`- Cancelled session history: ${IDS.sessions.cancelled}`)
  console.log(`- Historical visible ratings: ${IDS.sessions.doneHistorical}`)
  console.log(`- Pending completion flow: ${IDS.sessions.pendingCompletion}`)
  console.log(`- Results awaiting confirmation: ${IDS.sessions.resultsPending}`)
  console.log(`- Results disputed: ${IDS.sessions.resultsDisputed}`)
  console.log(`- Auto-closed session: ${IDS.sessions.autoClosed}`)
  console.log(`- Ghost / voided session: ${IDS.sessions.ghostVoided}`)
}

main().catch((error) => {
  console.error('\nSeed failed:')
  console.error(error)
  process.exit(1)
})
