import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import readline from 'readline'
import crypto from 'crypto'

function stringToUuid(str) {
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Namespace for UUID v5 (arbitrary, but consistent)


async function importCourts() {
  const filePath = path.resolve(process.cwd(), '../results_depth20.json')
  const fileStream = fs.createReadStream(filePath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  const courts = []
  let count = 0

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const data = JSON.parse(line)
      
      // Transform data
      const _courtId = data.place_id ? stringToUuid(data.place_id) : stringToUuid(data.title + data.address)
      
      const court = {
        name: data.title,
        address: data.address,
        city: (data.complete_address?.city === 'Da Nang' ? 'Đà Nẵng' : (data.complete_address?.city || 'Đà Nẵng')),
        district: data.complete_address?.borough || data.complete_address?.state || null,
        lat: data.latitude,
        lng: data.longtitude,
        rating: data.review_rating || 0,
        rating_count: data.review_count || 0,
        phone: data.phone || null,
        thumbnail_url: data.thumbnail || null,
        images: data.images || [],
        reviews_data: data.user_reviews || [],
        amenities: data.about || [],
        popular_times: data.popular_times || {},
        opening_hours: data.open_hours || {},
        google_maps_url: data.link || null,
        place_id: data.place_id || null,
        created_at: new Date().toISOString(),
        // Default values for other fields
        num_courts: 4, // Default estimate
        price_per_hour: 200000, // Default estimate
        court_type: 'outdoor', // Default
        surface: 'hard' // Default
      }
      
      courts.push(court)
      count++
    } catch (e) {
      console.error('Error parsing line:', e)
    }
  }

  console.log(`Parsed ${count} courts. Starting upsert...`)

  // Batch upsert to avoid issues with large payloads
  const batchSize = 10
  for (let i = 0; i < courts.length; i += batchSize) {
    const batch = courts.slice(i, i + batchSize)
    const { error } = await supabase.from('courts').upsert(batch, { onConflict: 'place_id' })
    if (error) {
      console.error(`Error upserting batch ${i / batchSize}:`, error)
    } else {
      console.log(`Upserted batch ${i / batchSize + 1}/${Math.ceil(courts.length / batchSize)}`)
    }
  }

  console.log('Import completed.')
}

importCourts()
