import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createServer } from 'node:http'

const root = normalize(join(process.cwd(), 'web-build'))
const port = Number(process.argv[2] ?? 4173)

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function safePathFromUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const relative = decoded === '/' ? '/index.html' : decoded
  const resolved = normalize(join(root, relative))
  if (!resolved.startsWith(root)) return null
  return resolved
}

const server = createServer((req, res) => {
  const requested = safePathFromUrl(req.url ?? '/')
  const fallback = join(root, 'index.html')

  let target = fallback
  if (requested && existsSync(requested)) {
    const stats = statSync(requested)
    target = stats.isDirectory() ? join(requested, 'index.html') : requested
  }

  if (!existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const ext = extname(target).toLowerCase()
  const type = contentTypes[ext] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  createReadStream(target).pipe(res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`web-build server running at http://127.0.0.1:${port}`)
})
