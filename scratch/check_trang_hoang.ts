import { supabase } from '../lib/supabase'

async function checkTrangHoangReviews() {
  const { data, error } = await supabase
    .from('courts')
    .select('name, reviews_data, rating_count')
    .ilike('name', '%Trang Hoàng%')
    .single()
  
  if (error) {
    console.error('Error fetching court:', error)
  } else {
    const reviews = Array.isArray(data.reviews_data) ? data.reviews_data : []
    console.log(`Court: ${data.name}`)
    console.log(`Rating Count (column): ${data.rating_count}`)
    console.log(`Reviews Data Length (JSON): ${reviews.length}`)
    console.log('Sample Review Names:', reviews.slice(0, 3).map((r: any) => r.Name || r.name))
  }
}

checkTrangHoangReviews()
