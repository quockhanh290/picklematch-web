import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl!, supabaseKey!, {
  auth: { persistSession: false }
})

async function checkSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .limit(1)
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Session row sample:', JSON.stringify(data?.[0] || {}, null, 2))
  }
}

checkSessions()
