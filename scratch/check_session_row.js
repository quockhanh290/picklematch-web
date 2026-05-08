const https = require('https');
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const url = `${supabaseUrl}/rest/v1/sessions?select=*&limit=1`;

const options = {
  headers: {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  }
};

https.get(url, options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Session row sample:', JSON.stringify(json[0] || {}, null, 2));
    } catch (e) {
      console.error('Parse error:', e, data);
    }
  });
}).on('error', (err) => {
  console.error('Request error:', err);
});
