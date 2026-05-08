import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl!, supabaseKey!, {
  auth: { persistSession: false }
})

async function checkSchema() {
  // Check sessions table
  const { data: sessData, error: sessErr } = await supabase
    .from('sessions')
    .select('*')
    .limit(1)
  
  if (sessErr) console.error('Sessions Error:', sessErr)
  else console.log('Sessions columns:', Object.keys(sessData?.[0] || {}))

  // Check owner_sessions table
  const { data: ownerData, error: ownerErr } = await supabase
    .from('owner_sessions')
    .select('*')
    .limit(1)
  
  if (ownerErr) console.error('OwnerSessions Error:', ownerErr)
  else console.log('OwnerSessions columns:', Object.keys(ownerData?.[0] || {}))
}

checkSchema()
