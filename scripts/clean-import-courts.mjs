import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import readline from 'readline'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const districtMap = {
  'Hai Chau': 'Hải Châu',
  'Thanh Khe': 'Thanh Khê',
  'Son Tra': 'Sơn Trà',
  'Ngu Hanh Son': 'Ngũ Hành Sơn',
  'Lien Chieu': 'Liên Chiểu',
  'Cam Le': 'Cẩm Lệ',
  'Hoa Vang': 'Hòa Vang',
  'An Hai': 'Sơn Trà',
  'An Hai Tay': 'Sơn Trà',
  'An Hai Bac': 'Sơn Trà',
  'An Hai Dong': 'Sơn Trà',
  'Bac My An': 'Ngũ Hành Sơn',
  'Khuê Trung': 'Cẩm Lệ',
  'Hòa Xuân': 'Cẩm Lệ',
  'Hòa Khánh': 'Liên Chiểu',
  'Hòa Minh': 'Liên Chiểu',
  'Hòa Thọ': 'Cẩm Lệ',
  'Hòa Cường': 'Hải Châu',
  'Hòa Thuận': 'Hải Châu',
  'Hải Châu': 'Hải Châu',
  'Thanh Khê': 'Thanh Khê',
  'Ngũ Hành Sơn': 'Ngũ Hành Sơn',
  'Sơn Trà': 'Sơn Trà',
  'Liên Chiểu': 'Liên Chiểu',
  'Cẩm Lệ': 'Cẩm Lệ',
  'Hòa Vang': 'Hòa Vang',
  'Hoi An': 'Hội An',
  'Dien Ban': 'Điện Bàn',
  'Điện Bàn': 'Điện Bàn',
  'Hội An': 'Hội An'
}

const _cityMap = {
  'Da Nang': 'Đà Nẵng',
  'DaNang': 'Đà Nẵng',
  'Đà Nẵng': 'Đà Nẵng',
  'Hoi An': 'Hội An',
  'Hội An': 'Hội An',
  'Quang Nam': 'Quảng Nam'
}

function cleanAddress(data) {
  const complete = data.complete_address
  let addr = ''
  
  if (complete?.street && complete.street !== 'Unnamed Road') {
    addr = complete.street
  } else {
    addr = data.address || ''
    // If it's a full address, try to take only the first part before the first comma
    if (addr.includes(',')) {
      const parts = addr.split(',')
      // If the first part is just a Plus Code, skip it
      if (/[A-Z0-9]{4}\+[A-Z0-9]{2,4}/.test(parts[0])) {
        addr = parts.slice(1).join(',').trim()
      } else {
        // Check if the address contains ward/district names and trim them
        addr = parts[0].trim()
      }
    }
  }

  // Remove Plus Codes (e.g., 34VR+GR6)
  addr = addr.replace(/[A-Z0-9]{4}\+[A-Z0-9]{2,4}\s*/g, '')
  // Remove redundant city/country info if it leaked into the street address
  addr = addr.replace(/,?\s*(Vietnam|VN|Việt Nam|Da Nang|Đà Nẵng)$/gi, '')
  
  return addr.trim()
}

function getDistrict(data) {
  const borough = data.complete_address?.borough
  const state = data.complete_address?.state
  const address = data.address
  const title = data.title
  
  // Combine all strings to search in
  const searchStr = `${borough} ${state} ${address} ${title}`.toLowerCase()
  
  for (const [key, value] of Object.entries(districtMap)) {
    if (searchStr.includes(key.toLowerCase())) {
      return value
    }
  }
  
  return 'Đà Nẵng' // Default
}

function getCity(data) {
  const city = data.complete_address?.city
  const state = data.complete_address?.state
  const address = data.address
  
  const searchStr = `${city} ${state} ${address}`.toLowerCase()
  
  if (searchStr.includes('hoi an') || searchStr.includes('hội an')) return 'Hội An'
  if (searchStr.includes('dien ban') || searchStr.includes('điện bàn')) return 'Điện Bàn'
  
  return 'Đà Nẵng'
}


const shopKeywords = ['store', 'shop', 'vợt', 'showroom', 'bán', 'giày', 'quần áo', 'phụ kiện']

async function cleanImport() {
  const filePath = path.resolve(process.cwd(), 'results_depth20_hq2.json')
  console.log(`Checking file at: ${filePath}`)
  if (!fs.existsSync(filePath)) {
    // Fallback to parent dir if running from different context
    const fallbackPath = path.resolve(process.cwd(), '../results_depth20_hq2.json')
    if (fs.existsSync(fallbackPath)) {
      console.log(`Using fallback path: ${fallbackPath}`)
    } else {
      console.error('File NOT found!')
      return
    }
  }

  // 1. Prepare cleaned data from JSON first (Memory-safe since it's only 114 entries)
  const courtsMap = new Map()
  let totalParsed = 0
  let totalFiltered = 0

  console.log('Reading and cleaning JSON data...')
  const streamPath = fs.existsSync(filePath) ? filePath : path.resolve(process.cwd(), '../results_depth20_hq2.json')
  const fileStream = fs.createReadStream(streamPath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  await new Promise((resolve) => {
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const data = JSON.parse(line)
        totalParsed++

        const isShop = shopKeywords.some(keyword => data.title.toLowerCase().includes(keyword))
        if (isShop) {
          totalFiltered++
          return
        }

        const cleanedAddr = cleanAddress(data)
        const district = getDistrict(data)
        const city = getCity(data)
        
        // Combine standard and extended reviews for more depth
        const allReviews = [
          ...(data.user_reviews || []),
          ...(data.user_reviews_extended || [])
        ]
        
        // Basic deduplication by name and description
        const seenReviews = new Set()
        const uniqueReviews = allReviews.filter(rev => {
          const key = `${rev.Name}-${rev.Description}`.slice(0, 100)
          if (seenReviews.has(key)) return false
          seenReviews.add(key)
          return true
        })

        // Improved thumbnail logic: Prioritize real photos over street view
        const images = data.images || []
        let bestThumbnail = data.thumbnail
        const realPhoto = images.find(img => img.image && !img.image.includes('streetviewpixels'))
        if (realPhoto) {
          bestThumbnail = realPhoto.image
        }

        const parseTimeRange = (open_hours) => {
          if (!open_hours) return { open: '06:00', close: '22:00' }
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
          let rangeStr = ''
          for (const day of days) {
            if (open_hours[day] && open_hours[day][0]) {
              rangeStr = open_hours[day][0]
              break
            }
          }
          if (!rangeStr) return { open: '06:00', close: '22:00' }

          const parts = rangeStr.split(/[–-—]/) // Handle en-dash, hyphen, em-dash
          if (parts.length !== 2) return { open: '06:00', close: '22:00' }

          const parseTime = (s) => {
            const match = s.match(/(\d+)(?::(\d+))?\s*(a\.m\.|p\.m\.|AM|PM)/i)
            if (!match) return null
            let h = parseInt(match[1])
            let m = parseInt(match[2] || '0')
            const ampm = match[3].toLowerCase()
            if (ampm.includes('p') && h < 12) h += 12
            if (ampm.includes('a') && h === 12) h = 0
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
          }

          const open = parseTime(parts[0])
          const close = parseTime(parts[1])
          return { open: open || '06:00', close: close || '22:00' }
        }

        const { open, close } = parseTimeRange(data.open_hours)

        const court = {
          name: data.title,
          address: cleanedAddr,
          city: city,
          district: district,
          lat: data.latitude,
          lng: data.longtitude,
          hours_open: open,
          hours_close: close,
          rating: data.review_rating || 0,
          rating_count: data.review_count || 0,
          phone: data.phone || null,
          thumbnail_url: bestThumbnail || null,
          images: images,
          reviews_data: uniqueReviews,
          amenities: data.about || [],
          popular_times: data.popular_times || {},
          opening_hours: data.open_hours || {},
          google_maps_url: data.link || null,
          place_id: data.place_id || null,
          created_at: new Date().toISOString(),
          num_courts: 4,
          price_per_hour: 200000,
          court_type: 'outdoor',
          surface: 'hard'
        }

        if (courtsMap.has(cleanedAddr)) {
          const existing = courtsMap.get(cleanedAddr)
          if (court.rating_count > existing.rating_count) {
            courtsMap.set(cleanedAddr, court)
          }
        } else {
          courtsMap.set(cleanedAddr, court)
        }
      } catch (e) {
        console.error('Error parsing line:', e)
      }
    })

    rl.on('close', () => {
      resolve()
    })
  })

  const finalCourts = Array.from(courtsMap.values())
  console.log(`Parsed: ${totalParsed}, Filtered: ${totalFiltered}, Unique: ${finalCourts.length}`)

  if (finalCourts.length === 0) {
    console.log('No courts to import. Exiting.')
    return
  }

  // 2. Get protected courts (those with slots)
  console.log('Fetching protected courts...')
  const { data: slotsData, error: slotsError } = await supabase.from('court_slots').select('court_id')
  if (slotsError) {
    console.error('Error fetching slots:', slotsError)
    return
  }
  const protectedIds = new Set(slotsData?.map(s => s.court_id) || [])
  console.log(`Found ${protectedIds.size} protected courts.`)

  // 3. Delete unprotected courts
  console.log('Deleting unprotected courts...')
  const idList = Array.from(protectedIds).join(',')
  const deleteQuery = supabase.from('courts').delete()
  
  if (protectedIds.size > 0) {
    deleteQuery.not('id', 'in', `(${idList})`)
  } else {
    deleteQuery.neq('id', '00000000-0000-0000-0000-000000000000')
  }

  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    console.log('Bulk delete failed or partially restricted, proceeding to upsert...', deleteError.message)
  }

  // 4. Upsert cleaned data
  console.log('Starting clean upsert...')
  const batchSize = 10
  for (let i = 0; i < finalCourts.length; i += batchSize) {
    const batch = finalCourts.slice(i, i + batchSize)
    const { error } = await supabase.from('courts').upsert(batch, { onConflict: 'place_id' })
    if (error) {
      console.error(`Error upserting batch ${i / batchSize}:`, error)
    } else {
      console.log(`Upserted batch ${i / batchSize + 1}/${Math.ceil(finalCourts.length / batchSize)}`)
    }
  }

  console.log('Clean import completed.')
}

cleanImport()
