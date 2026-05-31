import { createClient } from '@supabase/supabase-js'

const url = 'https://mzqsxgfvtgmsscbqugni.supabase.co'
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(url, key)

async function test() {
  const { data: session } = await supabase.from('sessions').select('id').order('created_at', { ascending: false }).limit(1).single()
  console.log('Session ID:', session.id)

  const { data: { session: authSession } } = await supabase.auth.getSession()
  
  const token = process.env.SUPABASE_ACCESS_TOKEN // I'll just pass a token from env or manually construct a request

}
test()
