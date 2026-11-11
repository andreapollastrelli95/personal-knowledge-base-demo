import { useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import { cleanTag, db, descendants, exportJson, folderTree, highlight, rankNotes, searchNotes, tagMatches, tagTree, validateImport, type Folder, type Note } from './db'
import { restore } from './sync'
import { useLive } from './useLive'

const nav = [['/', 'Note'], ['/folders', 'Cartelle'], ['/tags', 'Tag'], ['/links', 'Link'], ['/search', 'Ricerca'], ['/assistant', 'Assistente'], ['/export', 'Esporta']]

export default function App() {
  return (
    <div className="flex flex-col md:flex-row h-screen text-slate-800">
      <aside className="md:w-44 bg-slate-900 text-slate-200 p-2 md:p-3 md:space-y-1 shrink-0 flex md:block gap-1 overflow-x-auto md:overflow-visible">
        <h1 className="font-bold mb-3 text-sm hidden md:block">Personal Knowledge Base</h1>
        {nav.map(([to, label]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `block px-2 py-1 rounded text-sm whitespace-nowrap ${isActive ? 'bg-indigo-600' : 'hover:bg-slate-700'}`}>{label}</NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-3 md:p-4 min-w-0">
        <Routes>
          <Route path="/" element={<NotesPage />} />
          <Route path="/notes/:id" element={<NotesPage />} />
          <Route path="/folders" element={<FoldersPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/links" element={<LinksPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/export" element={<ExportPage />} />
        </Routes>
      </main>
    </div>
  )
}

function renderMd(content: string, notes: Note[]) {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => {
    const n = notes.find((x) => x.title.toLowerCase() === t.trim().toLowerCase())
    return n ? `[${t}](#/notes/${n.id})` : `**${t}** (nota mancante)`
  })
}

function NotesPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const notes = useLive(() => db.notes.toArray(), [], [] as Note[])
  const folders = useLive(() => db.folders.toArray(), [], [])
  const cur = notes.find((n) => n.id === Number(id))
  const [filter, setFilter] = useState('')

  const create = async () => {
    const nid = await db.notes.add({ title: 'Nuova nota', content: '', tags: [], updatedAt: Date.now() })
    nav(`/notes/${nid}`)
  }
  const patch = (p: Partial<Note>) => cur && db.notes.update(cur.id!, { ...p, updatedAt: Date.now() })
  const del = async () => { if (cur && confirm('Eliminare la nota?')) { await db.notes.delete(cur.id!); nav('/') } }
  const backlinks = cur ? notes.filter((n) => n.id !== cur.id && n.content.toLowerCase().includes(`[[${cur.title.toLowerCase()}]]`)) : []

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-full">
      <div className="md:w-56 shrink-0 space-y-2 max-h-48 md:max-h-none overflow-auto">
        <button className="btn w-full" onClick={create}>+ Nuova nota</button>
        <input className="inp" placeholder="Filtra…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {notes.length === 0 && <p className="text-slate-500 text-sm">Nessuna nota. Creane una con il pulsante sopra.</p>}
        {notes.length > 0 && searchNotes(notes, filter).length === 0 && <p className="text-slate-500 text-sm">Nessuna nota corrisponde al filtro.</p>}
        {searchNotes(notes, filter).map((n) => (
          <div key={n.id} onClick={() => nav(`/notes/${n.id}`)} className={`p-2 rounded cursor-pointer text-sm ${n.id === cur?.id ? 'bg-indigo-100' : 'hover:bg-slate-100'}`}>{n.title}</div>
        ))}
      </div>
      {cur ? (
        <div className="flex-1 flex flex-col gap-2 min-w-0" key={cur.id}>
          <div className="flex gap-2 flex-wrap">
            <input className="inp font-bold flex-1 min-w-0" value={cur.title} onChange={(e) => patch({ title: e.target.value })} />
            <select className="inp w-40 max-w-full" value={cur.folderId ?? ''} onChange={(e) => patch({ folderId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Nessuna cartella</option>
              {folderTree(folders).map(({ folder: f, depth }) => <option key={f.id} value={f.id}>{'\u00A0\u00A0'.repeat(depth) + (depth ? '└ ' : '') + f.name}</option>)}
            </select>
            <button className="btn-ghost" onClick={del}>Elimina</button>
          </div>
          <input className="inp" placeholder="tag separati da virgola (sotto-tag con la barra: lavoro/progetti)" defaultValue={cur.tags.join(', ')} onBlur={(e) => patch({ tags: [...new Set(e.target.value.split(',').map(cleanTag).filter(Boolean))] })} />
          <div className="flex flex-col md:flex-row gap-3 flex-1 min-h-0">
            <textarea className="inp flex-1 font-mono resize-none min-h-48" value={cur.content} onChange={(e) => patch({ content: e.target.value })} />
            <div className="md flex-1 overflow-auto border rounded p-3 text-sm min-h-32 break-words"><Markdown>{renderMd(cur.content, notes)}</Markdown></div>
          </div>
          {backlinks.length > 0 && <div className="text-sm">Collegata da: {backlinks.map((b) => <a key={b.id} className="text-indigo-600 mr-2" href={`#/notes/${b.id}`}>{b.title}</a>)}</div>}
        </div>
      ) : <p className="text-slate-500">Seleziona o crea una nota. Usa [[titolo]] per collegare le note.</p>}
    </div>
  )
}

function FoldersPage() {
  const folders = useLive(() => db.folders.toArray(), [], [] as Folder[])
  const notes = useLive(() => db.notes.toArray(), [], [] as Note[])
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const tree = folderTree(folders)
  const add = async () => {
    if (!name.trim()) return
    await db.folders.add({ name: name.trim(), parentId: parent ? Number(parent) : undefined })
    setName('')
  }
  const remove = async (f: Folder) => {
    const kids = folders.filter((x) => x.parentId === f.id).length
    if (!confirm(`Eliminare la cartella "${f.name}"? Le note resteranno senza cartella${kids ? ' e le sottocartelle saliranno di un livello' : ''}.`)) return
    await db.transaction('rw', db.folders, db.notes, async () => {
      await db.notes.where('folderId').equals(f.id!).modify({ folderId: undefined })
      await db.folders.filter((x) => x.parentId === f.id).modify({ parentId: f.parentId })
      await db.folders.delete(f.id!)
    })
  }
  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-xl font-bold">Cartelle</h2>
      <div className="flex gap-2 flex-wrap md:flex-nowrap">
        <input className="inp" placeholder="Nome cartella" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="inp md:w-48" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Cartella madre">
          <option value="">Al primo livello</option>
          {tree.map(({ folder: f, path }) => <option key={f.id} value={f.id}>dentro: {path}</option>)}
        </select>
        <button className="btn shrink-0" onClick={add}>Aggiungi</button>
      </div>
      {folders.length === 0 && <p className="text-slate-500 text-sm">Nessuna cartella. Creane una per organizzare le note.</p>}
      {tree.map(({ folder: f, depth }) => {
        const blocked = descendants(folders, f.id!) // una cartella non può finire dentro se stessa o una sua sottocartella
        return (
          <div key={f.id} className="border rounded p-2" style={{ marginLeft: Math.min(depth, 4) * 20 }}>
            <div className="flex gap-2 flex-wrap md:flex-nowrap">
              <input className="inp font-semibold" defaultValue={f.name} onBlur={(e) => e.target.value.trim() && db.folders.update(f.id!, { name: e.target.value.trim() })} />
              <select className="inp md:w-44" value={f.parentId ?? ''} onChange={(e) => db.folders.update(f.id!, { parentId: e.target.value ? Number(e.target.value) : undefined })} aria-label={`Sposta la cartella ${f.name}`}>
                <option value="">Primo livello</option>
                {tree.filter((t) => !blocked.includes(t.folder.id!)).map(({ folder: o, path }) => <option key={o.id} value={o.id}>dentro: {path}</option>)}
              </select>
              <button className="btn-ghost shrink-0" onClick={() => remove(f)}>Elimina</button>
            </div>
            <ul className="text-sm mt-1">{notes.filter((n) => n.folderId === f.id).map((n) => <li key={n.id}><a className="text-indigo-600" href={`#/notes/${n.id}`}>{n.title}</a></li>)}</ul>
          </div>
        )
      })}
    </div>
  )
}

function TagsPage() {
  const notes = useLive(() => db.notes.toArray(), [], [] as Note[])
  const [sel, setSel] = useState('')
  const tags = tagTree(notes)
  const shown = notes.filter((n) => sel && n.tags.some((t) => tagMatches(t, sel)))
  return (
    <div className="space-y-3 max-w-xl">
      <h2 className="text-xl font-bold">Tag</h2>
      {tags.length === 0 && <p className="text-slate-500 text-sm">Nessun tag. Aggiungili dalla pagina di una nota; con la barra crei i sotto-tag (es. lavoro/progetti).</p>}
      <div className="space-y-1">
        {tags.map((t) => (
          <div key={t.tag} style={{ marginLeft: Math.min(t.depth, 4) * 20 }}>
            <button className={sel === t.tag ? 'btn' : 'btn-ghost'} onClick={() => setSel(sel === t.tag ? '' : t.tag)}>#{t.label} <span className="opacity-70">({t.count})</span></button>
          </div>
        ))}
      </div>
      {tags.length > 0 && !sel && <p className="text-slate-500 text-sm">Scegli un tag per vedere le note (sono comprese quelle dei sotto-tag).</p>}
      {sel && <h3 className="font-semibold text-sm">Note con #{sel}</h3>}
      <ul>{shown.map((n) => <li key={n.id}><a className="text-indigo-600" href={`#/notes/${n.id}`}>{n.title}</a> <span className="text-xs text-slate-500">{n.tags.filter((t) => tagMatches(t, sel)).map((t) => '#' + t).join(' ')}</span></li>)}</ul>
    </div>
  )
}

function LinksPage() {
  const links = useLive(() => db.links.toArray(), [], [])
  const [f, setF] = useState({ title: '', url: '', note: '' })
  return (
    <div className="max-w-2xl space-y-3">
      <h2 className="text-xl font-bold">Link salvati</h2>
      <div className="flex gap-2 flex-wrap">
        <input className="inp" placeholder="Titolo" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input className="inp" placeholder="https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <input className="inp" placeholder="Nota" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className="btn" onClick={async () => { if (f.url.trim()) { const url = /^https?:\/\//i.test(f.url.trim()) ? f.url.trim() : 'https://' + f.url.trim(); await db.links.add({ ...f, url, title: f.title || url, createdAt: Date.now() }); setF({ title: '', url: '', note: '' }) } }}>Salva</button>
      </div>
      {links.length === 0 && <p className="text-slate-500 text-sm">Nessun link salvato. Aggiungine uno qui sopra.</p>}
      {links.map((l) => (
        <div key={l.id} className="border rounded p-2 flex justify-between items-center">
          <div><a href={l.url} className="text-indigo-600 font-semibold" target="_blank" rel="noreferrer">{l.title}</a><div className="text-xs text-slate-500 break-all">{l.url} — {l.note}</div></div>
          <button className="btn-ghost" onClick={() => confirm(`Eliminare il link "${l.title}"?`) && db.links.delete(l.id!)}>Elimina</button>
        </div>
      ))}
    </div>
  )
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return <>{highlight(text, terms).map((p, i) => (p.hit ? <mark key={i} className="bg-yellow-200 rounded px-0.5">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>
}

function SearchPage() {
  const notes = useLive(() => db.notes.toArray(), [], [] as Note[])
  const folders = useLive(() => db.folders.toArray(), [], [] as Folder[])
  const [q, setQ] = useState('')
  const hits = rankNotes(notes, q)
  const paths = new Map(folderTree(folders).map((n) => [n.folder.id, n.path]))
  return (
    <div className="max-w-2xl space-y-3">
      <h2 className="text-xl font-bold">Ricerca full-text</h2>
      <input className="inp" autoFocus placeholder="Cerca in titoli, contenuti e tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim() && <p className="text-slate-500 text-sm">{hits.length === 0 ? `Nessun risultato per "${q}".` : `${hits.length} ${hits.length === 1 ? 'risultato' : 'risultati'}, dal più pertinente.`}</p>}
      {hits.map(({ note: n, snippet, terms }) => (
        <a key={n.id} href={`#/notes/${n.id}`} className="block border rounded p-2 hover:bg-slate-50">
          <div className="text-indigo-600 font-semibold"><Marked text={n.title} terms={terms} /></div>
          {snippet && <div className="text-sm text-slate-600 break-words"><Marked text={snippet} terms={terms} /></div>}
          <div className="text-xs text-slate-500 mt-1">
            {n.folderId !== undefined && paths.get(n.folderId) && <span className="mr-2">📁 {paths.get(n.folderId)}</span>}
            {n.tags.map((t) => <span key={t} className="mr-1">#{t}</span>)}
          </div>
        </a>
      ))}
    </div>
  )
}

function AssistantPage() {
  const notes = useLive(() => db.notes.toArray(), [], [] as Note[])
  const [noteId, setNoteId] = useState('')
  const [question, setQuestion] = useState('')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)

  const [check, setCheck] = useState('')
  // Traduce gli errori più comuni di Gemini in un messaggio chiaro.
  const explain = (err?: string) => {
    const e = err || 'errore sconosciuto'
    if (/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(e)) return 'Quota gratuita di Gemini esaurita per ora: riprova tra qualche minuto (il limite giornaliero si azzera il giorno dopo).'
    if (/\b40[13]\b|API key|PERMISSION_DENIED/i.test(e)) return 'Chiave Gemini non valida o non autorizzata: controlla GEMINI_API_KEY nel file gemini.env.'
    if (/\b404\b|not found|NOT_FOUND/i.test(e)) return 'Modello Gemini non trovato: controlla GEMINI_MODEL nel file gemini.env.'
    if (/\b50[03]\b|overloaded|UNAVAILABLE/i.test(e)) return 'Gemini è momentaneamente sovraccarico: riprova tra poco.'
    return e
  }
  const call = async (prompt: string) => {
    const r: { ok: boolean; text?: string; error?: string } = await (await fetch('/api/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })).json()
    return r
  }
  const run = async (prompt: string) => {
    setBusy(true); setOut('')
    try {
      const r = await call(prompt)
      setOut(r.ok ? r.text || '' : '⚠ ' + explain(r.error))
    } catch { setOut('⚠ Server locale non raggiungibile: l\'assistente funziona solo quando il PC è acceso.') }
    setBusy(false)
  }
  const verify = async () => {
    setBusy(true); setCheck('Verifico…')
    const t0 = Date.now()
    try {
      const r = await call('Rispondi solo con la parola: ok')
      setCheck(r.ok ? `✅ Gemini risponde (${((Date.now() - t0) / 1000).toFixed(1)} s): chiave valida e quota disponibile.` : '⚠ ' + explain(r.error))
    } catch { setCheck('⚠ Server locale non raggiungibile.') }
    setBusy(false)
  }
  const summarize = () => {
    const n = notes.find((x) => x.id === Number(noteId))
    if (n) run(`Riassumi in italiano la seguente nota.\n\nTitolo: ${n.title}\n\n${n.content}`)
  }
  const ask = () => {
    if (!question.trim()) return
    // Le note più pertinenti per ciascuna parola della domanda (max 5), in ordine di punteggio.
    const words = question.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3)
    const score = new Map<number, { n: Note; s: number }>()
    for (const w of words) for (const h of rankNotes(notes, w)) {
      const cur = score.get(h.note.id!) ?? { n: h.note, s: 0 }
      cur.s += h.score
      score.set(h.note.id!, cur)
    }
    const found = [...score.values()].sort((x, y) => y.s - x.s).slice(0, 5).map((x) => x.n)
    const ctx = found.map((n) => `### ${n.title}\n${n.content}`).join('\n\n') || '(nessuna nota trovata)'
    run(`Rispondi in italiano alla domanda usando solo le note seguenti. Se non bastano, dillo.\n\nNOTE:\n${ctx}\n\nDOMANDA: ${question}`)
  }
  return (
    <div className="max-w-2xl space-y-3">
      <h2 className="text-xl font-bold">Assistente Gemini</h2>
      <div className="flex gap-2">
        <select className="inp" value={noteId} onChange={(e) => setNoteId(e.target.value)}><option value="">Scegli una nota…</option>{notes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
        <button className="btn" disabled={busy || !noteId} onClick={summarize}>Riassumi</button>
      </div>
      <div className="flex gap-2">
        <input className="inp" placeholder="Fai una domanda alle tue note…" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button className="btn" disabled={busy} onClick={ask}>Chiedi</button>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn-ghost" disabled={busy} onClick={verify}>Verifica Gemini e quota</button>
        {check && <span className="text-sm">{check}</span>}
      </div>
      {busy && !check.startsWith('Verifico') && <p className="text-sm text-slate-500">Attendo Gemini…</p>}
      {out && <div className="md border rounded p-3 whitespace-pre-wrap text-sm">{out}</div>}
    </div>
  )
}

function ExportPage() {
  const [msg, setMsg] = useState('')
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = validateImport(JSON.parse(await file.text()))
      if (!confirm(`Il file contiene ${data.notes.length} note, ${data.folders.length} cartelle e ${data.links.length} link.\nI dati attuali verranno sostituiti (prima scarico un backup). Continuare?`)) return
      await exportJson('knowledge-base-backup-prima-import.json')
      await restore(data)
      setMsg('Importazione completata.')
    } catch (err) {
      setMsg('Importazione annullata: ' + (err instanceof Error ? err.message : 'file non valido') + '. I dati non sono stati modificati.')
    }
  }
  return (
    <div className="space-y-3 max-w-xl">
      <h2 className="text-xl font-bold">Esporta e importa</h2>
      <button className="btn" onClick={() => exportJson()}>Scarica JSON</button>
      <div><label className="block text-sm mb-1">Importa da file JSON (sostituisce i dati attuali)</label>
        <input type="file" accept="application/json,.json" onChange={onFile} className="text-sm" /></div>
      {msg && <p className="text-sm border rounded p-2">{msg}</p>}
    </div>
  )
}
