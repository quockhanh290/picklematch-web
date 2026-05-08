import { supabase } from '@/lib/supabase'

export type CourtReview = {
  name: string
  profile_picture: string | null
  rating: number
  description: string | null
  when: string | null
  images: string[] | null
}

export type CourtDetail = {
  id: string
  name: string
  address: string
  city: string
  district: string | null
  thumbnail_url: string | null
  images: string[]
  rating: number
  rating_count: number
  amenities: string[]
  highlight: string | null
  description: string | null
  google_maps_url: string | null
  booking_url: string | null
  phone: string | null
  reviews: CourtReview[]
  active_sessions_count: number
  sub_court_count: number
  popular_times?: Record<string, Record<string, number>>
  lat?: number
  lng?: number
  hours_open?: string | null
  hours_close?: string | null
  owner_id?: string | null
}

export async function fetchCourtDetailApi(courtId: string): Promise<CourtDetail | null> {
  // 1. Prepare queries
  const courtPromise = supabase
    .from('courts')
    .select('id, name, address, city, district, thumbnail_url, images, rating, rating_count, google_maps_url, phone, reviews_data, hours_open, hours_close, owner_id, sub_court_count')
    .eq('id', courtId)
    .single()

  const sessionsCountPromise = supabase
    .from('sessions')
    .select('id, slot:slot_id!inner(court_id, start_time)', { count: 'exact', head: true })
    .eq('slot.court_id', courtId)
    .eq('status', 'open')
    .gte('slot.start_time', new Date().toISOString())

  // 2. Fetch in parallel
  const [courtResult, sessionsCountResult] = await Promise.all([courtPromise, sessionsCountPromise])

  const { data, error } = courtResult
  const activeSessionsCount = sessionsCountResult.count

  if (error || !data) return null

  // Process Images
  const rawImages = (data.images && Array.isArray(data.images)) ? data.images : []
  const dbImages = rawImages.map((img: any) => {
    if (typeof img === 'string') return img
    if (typeof img === 'object' && img !== null && img.image) return img.image
    return null
  }).filter(Boolean)

  const images = dbImages.length > 0 
    ? dbImages 
    : (data.thumbnail_url ? [data.thumbnail_url] : [])

  // Process Reviews
  const rawReviews = (data.reviews_data && Array.isArray(data.reviews_data)) ? data.reviews_data : []
  const reviews: CourtReview[] = rawReviews.map((rev: any) => ({
    name: rev.Name || rev.name || 'Người dùng PickleMatch',
    profile_picture: rev.ProfilePicture || rev.profile_picture || null,
    rating: rev.Rating || rev.rating || 5,
    description: rev.Description || rev.description || null,
    when: rev.When || rev.when || null,
    images: rev.Images || rev.images || null
  }))

  // Amenities translation
  const amenityMap: Record<string, string> = {
    'wifi': 'Wifi miễn phí',
    'parking': 'Bãi đỗ xe',
    'car parking': 'Chỗ đậu ô tô',
    'motorbike parking': 'Bãi đỗ xe máy',
    'water': 'Nước uống miễn phí',
    'drinking water': 'Nước uống',
    'rental': 'Cho thuê vợt',
    'paddle rental': 'Cho thuê vợt',
    'lighting': 'Hệ thống đèn',
    'night lighting': 'Đèn đêm tiêu chuẩn',
    'restrooms': 'Nhà vệ sinh',
    'toilet': 'Nhà vệ sinh',
    'changing room': 'Phòng thay đồ',
    'cafe': 'Quán cà phê',
    'coffee': 'Giải khát & Cà phê',
    'locker': 'Tủ đồ cá nhân',
    'shop': 'Cửa hàng phụ kiện',
    'canteen': 'Căng tin',
    'shower': 'Phòng tắm hồ sơ',
    'fan': 'Quạt công nghiệp',
    'air conditioning': 'Máy lạnh',
    'pro shop': 'Shop dụng cụ chuyên nghiệp',
    'restaurant': 'Nhà hàng',
    'first aid': 'Y tế sơ cứu',
    'security': 'An ninh 24/7',
    'amenities': 'Tiện ích sân bãi',
    'gender neutral washroom': 'Nhà vệ sinh chung',
    'gender neutral restroom': 'Nhà vệ sinh chung',
    'washroom': 'Nhà vệ sinh',
    'restroom': 'Nhà vệ sinh',
    'playground': 'Khu vui chơi',
    'water station': 'Trạm tiếp nước',
    'ev charging': 'Sạc xe điện'
  }

  let amenities: string[] = []
  if (Array.isArray(data.amenities)) {
    data.amenities.forEach((group: any) => {
      const rawName = typeof group === 'string' ? group : group.name
      if (rawName) {
        const key = rawName.toLowerCase().trim()
        amenities.push(amenityMap[key] || rawName)
        
        if (group.options && Array.isArray(group.options)) {
          group.options.forEach((opt: any) => {
            if (opt.enabled) {
              const optKey = opt.name.toLowerCase().trim()
              amenities.push(amenityMap[optKey] || opt.name)
            }
          })
        }
      }
    })
  }
  
  amenities = Array.from(new Set(amenities)).slice(0, 12)

  return {
    id: data.id,
    name: data.name,
    address: data.address,
    city: data.city,
    district: data.district,
    thumbnail_url: data.thumbnail_url,
    images,
    rating: data.rating || 0,
    rating_count: data.rating_count || 0,
    amenities: amenities.length > 0 ? amenities : ['Wifi miễn phí', 'Bãi đỗ xe', 'Nước uống', 'Cho thuê vợt'],
    highlight: data.highlight,
    description: data.description || buildCourtDescription(data.name, data.city, amenities),
    google_maps_url: data.google_maps_url,
    booking_url: data.booking_url,
    phone: data.phone,
    reviews,
    active_sessions_count: activeSessionsCount || 0,
    popular_times: data.popular_times,
    hours_open: data.hours_open,
    hours_close: data.hours_close,
    owner_id: data.owner_id,
    sub_court_count: data.sub_court_count || 0,
  }
}

function buildCourtDescription(name: string, city: string, amenities: string[]): string {
  const templates = [
    (n: string, c: string, a: string) => `Chào mừng bạn đến với ${n}, một trong những không gian chơi Pickleball năng động nhất tại ${c}.${a ? ` Sân được đầu tư kỹ lưỡng với ${a}, hứa hẹn mang lại những trận đấu đầy cảm hứng.` : ' Mặt sân đạt chuẩn, không gian thoáng đãng, cực kỳ phù hợp cho các buổi tập luyện nâng trình.'} Đây là điểm hẹn lý tưởng cho cộng đồng đam mê Pickleball trong khu vực.`,
    (n: string, c: string, a: string) => `${n} tại ${c} sở hữu hệ thống sân chơi hiện đại và dịch vụ chuyên nghiệp.${a ? ` Tại đây bạn có thể tận hưởng các tiện ích như ${a}.` : ' Không gian rộng rãi, ánh sáng tiêu chuẩn giúp bạn thoải mái thi đấu vào bất kỳ thời điểm nào trong ngày.'} Một lựa chọn không thể bỏ qua nếu bạn đang tìm kiếm một nơi để giao lưu và rèn luyện sức khỏe.`,
    (n: string, c: string, a: string) => `Nếu bạn đang tìm một nơi chơi Pickleball chất lượng tại ${c}, thì ${n} chính là câu trả lời.${a ? ` Với lợi thế sẵn có về ${a}, sân luôn đảm bảo sự tiện nghi nhất cho người chơi.` : ' Sân luôn được bảo trì tốt, mặt sân êm và độ nảy chuẩn.'} Không khí thể thao sôi động tại đây chắc chắn sẽ làm bạn hài lòng ngay từ lần đầu trải nghiệm.`,
    (n: string, c: string, a: string) => `Trải nghiệm Pickleball chuyên nghiệp tại ${n} - ${c}. ${a ? `Sân không chỉ có mặt sân đẹp mà còn hỗ trợ tận tình với ${a}.` : 'Hệ thống sân được bố trí hợp lý, đảm bảo sự riêng tư và thoải mái cho từng trận đấu.'} Phù hợp cho cả người mới bắt đầu và các tay vợt kỳ cựu muốn tìm kiếm những trận cầu kịch tính.`
  ]

  // Use the name's length or first character to pick a consistent but varied template for the same court
  const seed = name.length + (name.charCodeAt(0) || 0)
  const template = templates[seed % templates.length]
  const amenityText = amenities.length > 0 ? amenities.slice(0, 3).join(', ').toLowerCase() : ''
  
  return template(name, city, amenityText)
}
