import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAnyValid() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, court_id, start_time')
    .not('court_id', 'is', null)
    .limit(5)
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Sessions with court_id:', data)
  }
}

checkAnyValid()
