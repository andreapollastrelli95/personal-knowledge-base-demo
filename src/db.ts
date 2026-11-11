import Dexie, { type Table } from 'dexie'

export interface Folder { id?: number; name: string; parentId?: number }
export interface Note { id?: number; title: string; content: string; folderId?: number; tags: string[]; updatedAt: number }
export interface Link { id?: number; title: string; url: string; note: string; createdAt: number }

class KbDb extends Dexie {
  folders!: Table<Folder, number>
  notes!: Table<Note, number>
  links!: Table<Link, number>
  constructor() {
    super('personal-knowledge-base')
    this.version(1).stores({
      folders: '++id, name',
      notes: '++id, title, folderId, *tags, updatedAt',
      links: '++id, title, createdAt',
    })
  }
}
export const db = new KbDb()

export async function seed() {
  if ((await db.notes.count()) > 0) return
  const fid = await db.folders.add({ name: 'Generale' })
  await db.notes.bulkAdd([
    { title: 'Benvenuto', content: '# Benvenuto\n\nQuesta è la tua **Knowledge Base**. Vedi anche [[Idee]].', folderId: fid, tags: ['demo'], updatedAt: Date.now() },
    { title: 'Idee', content: '# Idee\n\n- Scrivere note in Markdown\n- Collegarle con [[Benvenuto]]', folderId: fid, tags: ['demo', 'idee'], updatedAt: Date.now() },
  ])
  await db.links.add({ title: 'Documentazione Markdown', url: 'https://www.markdownguide.org', note: 'Guida di riferimento', createdAt: Date.now() })
}

// Confronto senza maiuscole e senza accenti ("perche" trova "perché").
// Normalizzo carattere per carattere, cosi' le posizioni restano allineate al testo originale.
export const fold = (s: string) => Array.from(s, (c) => (c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || c).toLowerCase().charAt(0) || c).join('')

export interface Hit { note: Note; score: number; snippet: string; terms: string[] }

/** Ricerca con punteggio: titolo > tag > contenuto; tutte le parole devono comparire. */
export function rankNotes(notes: Note[], q: string): Hit[] {
  const terms = [...new Set(fold(q).split(/\s+/).filter(Boolean))]
  if (!terms.length) return []
  const phrase = fold(q.trim())
  const hits: Hit[] = []
  for (const note of notes) {
    const title = fold(note.title), body = fold(note.content), tags = note.tags.map(fold)
    let score = 0, all = true
    for (const t of terms) {
      const inTitle = title.includes(t), inTag = tags.some((x) => x.includes(t))
      const count = body.split(t).length - 1
      if (!inTitle && !inTag && !count) { all = false; break }
      if (inTitle) score += title === t ? 14 : title.startsWith(t) ? 10 : 7
      if (inTag) score += tags.includes(t) ? 6 : 4
      score += Math.min(count, 5)
    }
    if (!all) continue
    if (terms.length > 1 && (title.includes(phrase) || body.includes(phrase))) score += 6
    // Anteprima: il pezzo di testo attorno alla prima parola trovata nel contenuto.
    let pos = body.indexOf(phrase)
    if (pos < 0) pos = Math.min(...terms.map((t) => body.indexOf(t)).filter((i) => i >= 0), Infinity)
    let snippet = note.content.slice(0, 160)
    if (Number.isFinite(pos) && pos >= 0) {
      const start = Math.max(0, pos - 60)
      snippet = (start > 0 ? '…' : '') + note.content.slice(start, pos + 120) + (pos + 120 < note.content.length ? '…' : '')
    }
    hits.push({ note, score, snippet: snippet.replace(/\s+/g, ' '), terms })
  }
  return hits.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
}

export function searchNotes(notes: Note[], q: string) {
  return q.trim() ? rankNotes(notes, q).map((h) => h.note) : notes
}

/** Divide un testo in pezzi, segnando quelli che corrispondono alle parole cercate. */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const f = fold(text)
  const marks: [number, number][] = []
  for (const t of terms) for (let i = f.indexOf(t); i >= 0 && t; i = f.indexOf(t, i + t.length)) marks.push([i, i + t.length])
  marks.sort((a, b) => a[0] - b[0])
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [s, e] of marks) {
    if (s < at) continue
    if (s > at) out.push({ text: text.slice(at, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    at = e
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

// ---- Cartelle annidate ----
export interface FolderNode { folder: Folder; depth: number; path: string }
/** Cartelle in ordine ad albero (figlie sotto la madre), con profondita' e percorso completo. */
export function folderTree(folders: Folder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id))
  const out: FolderNode[] = []
  const seen = new Set<number>()
  const walk = (parent: number | undefined, depth: number, prefix: string) => {
    folders.filter((f) => (f.parentId !== undefined && ids.has(f.parentId) ? f.parentId : undefined) === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => {
        if (seen.has(f.id!)) return
        seen.add(f.id!)
        const path = prefix ? `${prefix} / ${f.name}` : f.name
        out.push({ folder: f, depth, path })
        walk(f.id, depth + 1, path)
      })
  }
  walk(undefined, 0, '')
  // Eventuali cartelle rimaste fuori (cicli nei dati importati) vanno in fondo, al primo livello.
  folders.filter((f) => !seen.has(f.id!)).forEach((f) => out.push({ folder: f, depth: 0, path: f.name }))
  return out
}
/** Id della cartella e di tutte le sue sottocartelle. */
export function descendants(folders: Folder[], id: number): number[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) folders.forEach((f) => { if (f.parentId === out[i] && !out.includes(f.id!)) out.push(f.id!) })
  return out
}

// ---- Tag annidati: "lavoro/progetti" e' figlio di "lavoro" ----
export interface TagNode { tag: string; label: string; depth: number; count: number }
export const tagMatches = (noteTag: string, sel: string) => noteTag === sel || noteTag.startsWith(sel + '/')
export function tagTree(notes: Note[]): TagNode[] {
  const all = new Set<string>()
  for (const n of notes) for (const t of n.tags) {
    const parts = t.split('/').map((p) => p.trim()).filter(Boolean)
    parts.forEach((_p, i) => all.add(parts.slice(0, i + 1).join('/')))
  }
  return [...all].sort((a, b) => a.localeCompare(b)).map((tag) => ({
    tag, label: tag.split('/').pop()!, depth: tag.split('/').length - 1,
    count: notes.filter((n) => n.tags.some((t) => tagMatches(t, tag))).length,
  }))
}
/** Normalizza un tag digitato: niente #, spazi attorno alle barre o barre doppie. */
export const cleanTag = (t: string) => t.replace(/^#/, '').split('/').map((p) => p.trim()).filter(Boolean).join('/')

export function validateImport(raw: unknown) {
  const r = raw as { folders?: unknown; notes?: unknown; links?: unknown }
  if (!r || typeof r !== 'object' || !Array.isArray(r.folders) || !Array.isArray(r.notes) || !Array.isArray(r.links))
    throw new Error('il file non ha il formato atteso (servono folders, notes, links)')
  const ok = (a: unknown[], f: (x: any) => boolean) => a.every((x) => x && typeof x === 'object' && f(x))
  if (!ok(r.folders, (x) => typeof x.name === 'string' && (x.parentId === undefined || x.parentId === null || typeof x.parentId === 'number'))) throw new Error('cartelle non valide')
  if (!ok(r.notes, (x) => typeof x.title === 'string' && typeof x.content === 'string' && Array.isArray(x.tags) && x.tags.every((t: unknown) => typeof t === 'string')))
    throw new Error('note non valide')
  if (!ok(r.links, (x) => typeof x.url === 'string' && typeof x.title === 'string')) throw new Error('link non validi')
  const norm = (a: Folder[]) => a.map((x) => ({ ...x, id: typeof x.id === 'number' ? x.id : undefined, parentId: typeof x.parentId === 'number' ? x.parentId : undefined }))
  return {
    folders: norm(r.folders as Folder[]),
    notes: (r.notes as Note[]).map((n) => ({ ...n, updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now() })) as Note[],
    links: (r.links as Link[]).map((l) => ({ ...l, note: l.note ?? '', createdAt: typeof l.createdAt === 'number' ? l.createdAt : Date.now() })) as Link[],
  }
}

export async function exportJson(filename = 'knowledge-base.json') {
  const data = { exportedAt: new Date().toISOString(), folders: await db.folders.toArray(), notes: await db.notes.toArray(), links: await db.links.toArray() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}
