import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkCourtSlotsSchema() {
  const { data, error } = await supabase.from('court_slots').select('*').limit(1)
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('CourtSlots columns:', Object.keys(data[0] || {}))
  }
}

checkCourtSlotsSchema()
