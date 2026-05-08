import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function getSessionDetails() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, court_id, start_time, end_time, status')
    .eq('id', 'c28bc3a6-030c-44b0-93d4-74dc485828d5')
    .single()
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Session Details:', data)
  }
}

getSessionDetails()
