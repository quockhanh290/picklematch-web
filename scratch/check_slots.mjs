import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSlots() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, slot_id, status')
    .not('slot_id', 'is', null)
    .eq('status', 'open')
    .limit(5)
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Sessions with slots:', data)
    if (data.length > 0) {
        const { data: slot } = await supabase
            .from('slots')
            .select('court_id, start_time, end_time')
            .eq('id', data[0].slot_id)
            .single()
        console.log('Example Slot Details:', slot)
    }
  }
}

checkSlots()
