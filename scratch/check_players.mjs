import { createClient } from '@supabase/supabase-js'

// Hardcoded for now based on what I saw in .env and seed script
const supabaseUrl = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16cXN4Z2Z2dGdtc3NjYnF1Z25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjI4NzIsImV4cCI6MjA4OTUzODg3Mn0.U4aLAFVO64PmR4E_1QJh-6mt1wiayj2wrPpKTbDv4j8'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkUser() {
  console.log('Fetching players...')
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .limit(10)

  if (error) {
    console.error('Error fetching players:', error.message)
    return
  }

  if (!data || data.length === 0) {
    console.log('No players found (possibly due to RLS).')
    return
  }

  console.log('PLAYERS FOUND:')
  if (data[0]) {
    console.log('Columns:', Object.keys(data[0]).join(', '))
  }
  data.forEach(p => {
    console.log(`- ${p.name} (ID: ${p.id}): ELO=${p.current_elo}, Level=${p.self_assessed_level}, Label=${p.skill_label}`)
  })
}

checkUser()
