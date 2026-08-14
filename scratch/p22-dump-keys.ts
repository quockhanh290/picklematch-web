// Dump thật của kèo êm có đủ để replay qua engine không? Đây là điều kiện tiên quyết của "canary
// trên kèo lịch sử": không chạy được kèo đã kết thúc theo nghĩa live, nhưng request của nó còn nguyên.
import fs from 'node:fs'

async function main() {
  const src = fs.readFileSync('scripts/diagnose-session.ts', 'utf8')
  const baseUrl = src.match(/const SUPABASE_URL = '([^']+)'/)![1]
  const key = src.match(/const SERVICE_ROLE_KEY = '([^']+)'/)![1]
  const sid = process.argv[2] ?? '2ef92e06-aa39-4709-9c68-0f1c7a7a9634'
  const url = new URL(`${baseUrl}/rest/v1/debug_dumps`)
  url.searchParams.set('session_id', `eq.${sid}`)
  url.searchParams.set('select', 'created_at,payload')
  url.searchParams.set('order', 'created_at.desc')
  url.searchParams.set('limit', '1')
  const rows = await (await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json()
  if (!Array.isArray(rows) || rows.length === 0) { console.log('không có dump nào'); return }
  const p = rows[0].payload ?? {}
  console.log('dump_level:', p.dump_level, '| replay_schema_version:', p.replay_schema_version)
  console.log('top-level :', Object.keys(p).join(', '))
  console.log('request   :', Object.keys(p.request ?? {}).join(', '))
  const stateBlock = p.state ?? p.engine_state ?? p.snapshot ?? null
  console.log('state     :', stateBlock ? Object.keys(stateBlock).join(', ') : '(KHÔNG có khối state)')
}

main().catch(e => { console.error(e); process.exit(1) })
