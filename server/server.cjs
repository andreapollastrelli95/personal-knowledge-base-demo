const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')

const PORT = Number(process.env.PKB_PORT || 3104)
const DIST = path.join(__dirname, '..', 'dist')
const APPDIR = path.join(os.homedir(), '.app-personali')
const ENV_PATH = path.join(APPDIR, 'gemini.env')
const DATA_PATH = path.join(APPDIR, 'data', 'personal-knowledge-base.json')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

function readGeminiEnv() {
  if (!fs.existsSync(ENV_PATH)) throw new Error('File di configurazione non trovato: ' + ENV_PATH)
  const out = {}
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!out.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY mancante in ' + ENV_PATH)
  return { key: out.GEMINI_API_KEY, model: out.GEMINI_MODEL || 'gemini-2.0-flash' }
}

async function askGemini(prompt) {
  try {
    const { key, model } = readGeminiEnv()
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: String(prompt) }] }] }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: `Errore Gemini (${res.status}): ${data?.error?.message || res.statusText}`.replaceAll(key, '***') }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
    return text ? { ok: true, text } : { ok: false, error: 'Gemini non ha restituito alcuna risposta.' }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) } catch { return { version: 0, data: null } }
}
function saveStore(s) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true })
  const tmp = DATA_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(s))
  fs.renameSync(tmp, DATA_PATH)
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > 25e6) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true })
    if (url.pathname === '/api/gemini' && req.method === 'POST') {
      const { prompt } = await body(req)
      return send(res, 200, await askGemini(prompt))
    }
    if (url.pathname === '/api/data') {
      const store = loadStore()
      if (req.method === 'GET') return send(res, 200, store)
      if (req.method === 'PUT') {
        const { baseVersion, data } = await body(req)
        if (store.data && Number(baseVersion) !== store.version) return send(res, 409, { version: store.version })
        const next = { version: Math.max(Date.now(), store.version + 1), data }
        saveStore(next)
        return send(res, 200, { version: next.version })
      }
      return send(res, 405, { error: 'method' })
    }
    // static
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    if (!p) p = 'index.html'
    const file = path.join(DIST, p)
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  } catch (err) {
    send(res, 500, { error: 'Errore del server' })
  }
})

function start() {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', resolve)
  })
}

module.exports = { start }
if (require.main === module) start().catch((e) => { console.error(e.message); process.exit(1) })
