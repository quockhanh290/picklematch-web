import { supabase } from '../lib/supabase'

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
