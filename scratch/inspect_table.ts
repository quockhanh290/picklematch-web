import { supabase } from './lib/supabase'

async function inspect() {
  const { data, error } = await supabase
    .from('session_players')
    .select('*')
    .limit(1)
  
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Columns:', Object.keys(data[0] || {}))
  }
}

inspect()
