import { liveQuery } from 'dexie'
import { db } from './db'

const VKEY = 'pkb-version'
const snapshot = async () => ({ folders: await db.folders.toArray(), notes: await db.notes.toArray(), links: await db.links.toArray() })
type Snap = Awaited<ReturnType<typeof snapshot>>

export async function restore(d: Snap) {
  await db.transaction('rw', db.folders, db.notes, db.links, async () => {
    await Promise.all([db.folders.clear(), db.notes.clear(), db.links.clear()])
    await db.folders.bulkPut(d.folders || [])
    await db.notes.bulkPut(d.notes || [])
    await db.links.bulkPut(d.links || [])
  })
}

let last = ''
const getVersion = () => Number(localStorage.getItem(VKEY) || 0)

async function push() {
  const snap = await snapshot()
  const json = JSON.stringify(snap)
  if (json === last) return
  const r = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: getVersion(), data: snap }) })
  if (r.status === 409) {
    alert('I dati sono stati modificati su un altro dispositivo: ricarico la versione più recente.')
    const s = await (await fetch('/api/data')).json()
    if (s.data) await restore(s.data)
    localStorage.setItem(VKEY, String(s.version))
    location.reload()
    return
  }
  if (r.ok) { localStorage.setItem(VKEY, String((await r.json()).version)); last = json }
}

/** Scarica i dati dal server all'avvio. Ritorna true se il server ha dati. */
export async function pullOnStart() {
  try {
    const s = await (await fetch('/api/data')).json()
    if (s.data) {
      if (s.version !== getVersion()) await restore(s.data)
      localStorage.setItem(VKEY, String(s.version))
      last = JSON.stringify(await snapshot())
    }
  } catch { /* server non raggiungibile: si lavora in locale */ }
}

export function startSync() {
  let timer: ReturnType<typeof setTimeout> | undefined
  liveQuery(snapshot).subscribe({
    next: () => { clearTimeout(timer); timer = setTimeout(() => push().catch(() => {}), 1500) },
    error: () => {},
  })
}
