import path from 'path'
import fs from 'fs'
import readline from 'readline'

async function generateSQL() {
  const filePath = path.resolve(process.cwd(), '../results_depth20.json')
  const outputFilePath = path.resolve(process.cwd(), 'migrate_danang_courts_updated.sql')
  const fileStream = fs.createReadStream(filePath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  const sqlStatements = []
  let count = 0

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const data = JSON.parse(line)
      
      const escape = (str) => {
        if (str === null || str === undefined) return 'NULL'
        if (typeof str === 'string') return `'${str.replace(/'/g, "''")}'`
        if (typeof str === 'object') return `'${JSON.stringify(str).replace(/'/g, "''")}'::jsonb`
        return str
      }

      const city = (data.complete_address?.city === 'Da Nang' ? 'Đà Nẵng' : (data.complete_address?.city || 'Đà Nẵng'))
      const district = data.complete_address?.borough || data.complete_address?.state || null
      const tags = data.about ? data.about.flatMap(a => a.options.map(o => o.name)) : []

      const stmt = `INSERT INTO public.courts (name, address, city, district, lat, lng, rating, rating_count, phone, google_maps_url, place_id, thumbnail_url, images, opening_hours, reviews_data, popular_times, amenities, tags) VALUES (${escape(data.title)}, ${escape(data.address)}, ${escape(city)}, ${escape(district)}, ${data.latitude}, ${data.longitude}, ${data.review_rating || 0}, ${data.review_count || 0}, ${escape(data.phone)}, ${escape(data.link)}, ${escape(data.place_id)}, ${escape(data.thumbnail)}, ${escape(data.images)}, ${escape(data.open_hours)}, ${escape(data.user_reviews)}, ${escape(data.popular_times)}, ${escape(data.about)}, ARRAY[${tags.map(t => escape(t)).join(', ')}]::text[]) ON CONFLICT (place_id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, district = EXCLUDED.district, lat = EXCLUDED.lat, lng = EXCLUDED.lng, rating = EXCLUDED.rating, rating_count = EXCLUDED.rating_count, phone = EXCLUDED.phone, google_maps_url = EXCLUDED.google_maps_url, thumbnail_url = EXCLUDED.thumbnail_url, images = EXCLUDED.images, opening_hours = EXCLUDED.opening_hours, reviews_data = EXCLUDED.reviews_data, popular_times = EXCLUDED.popular_times, amenities = EXCLUDED.amenities, tags = EXCLUDED.tags;`
      
      sqlStatements.push(stmt)
      count++
    } catch (e) {
      console.error('Error parsing line:', e)
    }
  }

  fs.writeFileSync(outputFilePath, sqlStatements.join('\n'))
  console.log(`Generated ${count} SQL statements in ${outputFilePath}`)
}

generateSQL()
