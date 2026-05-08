import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSessionsTable() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .limit(1)
  
  if (error) {
    console.error('Error fetching session:', error)
  } else {
    console.log('Session columns:', Object.keys(data[0] || {}))
  }
}

checkSessionsTable()
