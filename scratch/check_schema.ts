import { supabase } from './lib/supabase'

async function checkSchema() {
  const { data, error } = await supabase.from('players').select('*').limit(1)
  if (error) {
    console.error('Error fetching players:', error)
    return
  }
  if (data && data.length > 0) {
    console.log('Columns in players:', Object.keys(data[0]))
  } else {
    console.log('No players found to check columns')
    // Try to get table info via RPC or just assume it's missing if we can't find it in migrations
  }
}

checkSchema()
