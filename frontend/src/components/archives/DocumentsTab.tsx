import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ClipboardCopy, Download, ExternalLink, FileSearch, FileText, Save, Trash2, Upload, X } from 'lucide-react'
import { api, openExternal, type MediaOut, type PersonSummary } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, Spinner, formatDate } from '../ui'
import { ANALYSIS_STATUS_LABEL, JsonView, errMsg, isImage } from '../person/helpers'

const ROLE_LABEL: Record<string, string> = { subject: 'sujet', father: 'père', mother: 'mère', spouse: 'conjoint', witness: 'témoin', godfather: 'parrain', godmother: 'marraine', declarant: 'déclarant', child: 'enfant', other: 'autre' }
const DOC_TYPE_LABEL: Record<string, string> = { birth: 'Acte de naissance', baptism: 'Acte de baptême', marriage: 'Acte de mariage', death: 'Acte de décès', burial: 'Sépulture', census: 'Recensement', military: 'Registre matricule', other: 'Autre document' }
const STATUS_CLASS: Record<string, string> = { done: 'conf-green', failed: 'conf-red', error: 'conf-red', running: 'conf-orange', pending: 'conf-grey', queued: 'conf-grey', none: 'conf-grey' }

interface Word { page?: number; text?: string; conf?: number; x: number; y: number; w: number; h: number }
interface ExtractedPerson { role?: string; given_names?: string | null; surname?: string | null; age?: string | number | null; occupation?: string | null; confidence?: string; birth_date?: string | null }
interface Extraction { language?: string; document_type?: string; date?: string | null; place?: string | null; persons?: ExtractedPerson[]; relations?: unknown[]; translation_fr?: string | null; method?: string }

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null)
function methodLabel(m: string | null): string { if (!m || m === 'none') return 'Aucune transcription'; if (m === 'tesseract') return 'OCR Tesseract'; if (m === 'manual') return 'Saisie manuelle'; if (m.startsWith('ai:')) return `IA (${m.slice(3)})`; return m }

function HighlightedText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\[\?[^\]]*\])/g), [text])
  return (
    <p className="whitespace-pre-wrap font-display text-base leading-relaxed">
      {parts.map((part, i) => {
        const m = /^\[\?([^\]]*)\]$/.exec(part)
        return m ? <mark key={i} className="rounded bg-conf-orange/30 px-0.5 text-night-900" title="Passage incertain">{m[1] || '?'}</mark> : <span key={i}>{part}</span>
      })}
    </p>
  )
}

function ImageWithWords({ media, words }: { media: MediaOut; words: Word[] }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [scale, setScale] = useState<{ sx: number; sy: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const compute = useCallback(() => { const img = imgRef.current; if (!img || !img.naturalWidth) return; setScale({ sx: img.clientWidth / img.naturalWidth, sy: img.clientHeight / img.naturalHeight }) }, [])
  useEffect(() => { window.addEventListener('resize', compute); return () => window.removeEventListener('resize', compute) }, [compute])
  const pageWords = words.filter((w) => (w.page ?? 0) === 0)
  return (
    <div className="relative inline-block max-w-full">
      <img ref={imgRef} src={api.mediaFileUrl(media.id)} alt={media.title ?? ''} className="max-h-[70vh] max-w-full rounded-xl border border-ivory-300" onLoad={compute} />
      {scale && pageWords.map((w, i) => (
        <div key={i} title={`${w.text ?? ''}${typeof w.conf === 'number' && w.conf >= 0 ? ` (${Math.round(w.conf)} %)` : ''}`} onMouseEnter={() => setHover(w.text ?? null)} onMouseLeave={() => setHover(null)}
          className="absolute cursor-help border border-transparent hover:border-gold-500 hover:bg-gold-500/25"
          style={{ left: w.x * scale.sx, top: w.y * scale.sy, width: w.w * scale.sx, height: w.h * scale.sy }} />
      ))}
      {hover && <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-night-900/90 px-2 py-1 text-xs text-ivory-50">{hover}</div>}
      {pageWords.length > 0 && <p className="mt-1 text-[11px] text-mist-500">Survolez l’image : chaque mot reconnu par l’OCR est encadré pour montrer le passage qui justifie le texte.</p>}
    </div>
  )
}

/** Analyse via l'abonnement claude.ai / chatgpt.com de l'utilisateur : copier le texte, joindre l'image, coller la réponse. */
function ManualLlmPanel({ media, onDone }: { media: MediaOut; onDone: () => Promise<void> }) {
  const { notify } = useApp()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [source, setSource] = useState<'claude.ai' | 'chatgpt.com'>('claude.ai')
  const [busy, setBusy] = useState(false)
  const start = async () => { setOpen(true); if (!prompt) { try { setPrompt((await api.mediaPrompt(media.id)).prompt) } catch (e) { notify('error', errMsg(e)) } } }
  const copy = async () => { if (!prompt) return; try { await navigator.clipboard.writeText(prompt); notify('success', 'Texte copié : collez-le dans la conversation avec l’image du document.') } catch { notify('error', 'Copie impossible : sélectionnez le texte ci-dessous et copiez-le.') } }
  const submit = async () => {
    setBusy(true)
    try { await api.mediaManualAnalysis(media.id, answer, source); setAnswer(''); setOpen(false); notify('success', 'Réponse intégrée : transcription et personnes extraites enregistrées (à vérifier).'); await onDone() }
    catch (e) { notify('error', errMsg(e, 'Réponse illisible.')) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-gold-500/40 bg-gold-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-night-900">Analyser avec Claude ou ChatGPT (votre abonnement)</div>
        {!open && <button className="btn-gold !py-1" onClick={start}><ClipboardCopy size={14} /> Commencer</button>}
      </div>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li className="flex flex-wrap items-center gap-2"><span>Téléchargez l’image :</span><a className="btn-ghost !py-1" href={api.mediaFileUrl(media.id)} download={media.original_filename ?? undefined}><Download size={14} /> Image du document</a></li>
            <li className="flex flex-wrap items-center gap-2"><span>Copiez le texte :</span><button className="btn-ghost !py-1" onClick={copy} disabled={!prompt}><ClipboardCopy size={14} /> Copier le texte à coller</button></li>
            <li className="flex flex-wrap items-center gap-2"><span>Ouvrez votre assistant, joignez l’image et collez le texte :</span>
              <button className="btn-ghost !py-1" onClick={() => { setSource('claude.ai'); openExternal('https://claude.ai/new') }}><ExternalLink size={14} /> claude.ai</button>
              <button className="btn-ghost !py-1" onClick={() => { setSource('chatgpt.com'); openExternal('https://chatgpt.com/') }}><ExternalLink size={14} /> chatgpt.com</button></li>
            <li>Collez ici la réponse complète (transcription + bloc JSON) :</li>
          </ol>
          {prompt && <details className="text-xs text-mist-500"><summary className="cursor-pointer">Voir le texte à coller</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ivory-100 p-2 font-sans">{prompt}</pre></details>}
          <textarea className="input font-mono text-xs" rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Collez la réponse de l’assistant…" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-mist-500">Source : <select className="input !w-auto !py-1" value={source} onChange={(e) => setSource(e.target.value as 'claude.ai' | 'chatgpt.com')}><option value="claude.ai">claude.ai</option><option value="chatgpt.com">chatgpt.com</option></select></label>
            <button className="btn-primary !py-1" disabled={busy || !answer.trim()} onClick={submit}>{busy ? <Spinner /> : <Save size={14} />} Intégrer la réponse</button>
            <button className="btn-ghost !py-1" onClick={() => setOpen(false)}>Fermer</button>
          </div>
          <p className="text-xs text-conf-orange">Une réponse d’assistant n’est jamais une preuve : l’application la traite comme une hypothèse et vous demandera confirmation avant toute filiation.</p>
        </div>
      )}
    </div>
  )
}

function MediaDetail({ id, persons, onClose, onChanged }: { id: string; persons: PersonSummary[]; onClose: () => void; onChanged: () => void }) {
  const { notify } = useApp()
  const [m, setM] = useState<MediaOut | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [personId, setPersonId] = useState('')
  const [transcription, setTranscription] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => { try { const d = await api.mediaDetail(id); setM(d); setTitle(d.title ?? ''); setPersonId(d.person_id ?? ''); setTranscription(d.ocr_text ?? str(d.analysis.transcription) ?? '') ; setErr(null) } catch (e) { setErr(errMsg(e)) } }, [id])
  useEffect(() => { setM(null); load() }, [load])
  useEffect(() => {
    const h = (ev: Event) => { const d = (ev as CustomEvent<{ type?: string; media_id?: string }>).detail; if (d?.type === 'task' || d?.media_id === id) load() }
    window.addEventListener('genealis:event', h); return () => window.removeEventListener('genealis:event', h)
  }, [id, load])
  if (err) return <section className="panel p-5"><Empty>{err}</Empty></section>
  if (!m) return <section className="panel p-5"><Spinner /></section>
  const a = m.analysis ?? {}
  const method = str(a.method)
  const words = Array.isArray(a.words) ? (a.words as unknown[]).filter((w): w is Word => typeof w === 'object' && w !== null && 'x' in w && 'w' in w) : []
  const uncertain = Array.isArray(a.uncertain) ? (a.uncertain as unknown[]).filter((u): u is string => typeof u === 'string') : []
  const warnings = Array.isArray(a.warnings) ? (a.warnings as unknown[]).filter((u): u is string => typeof u === 'string') : []
  const ex = (typeof a.extraction === 'object' && a.extraction !== null ? a.extraction : {}) as Extraction
  const exPersons = Array.isArray(ex.persons) ? ex.persons : []
  const image = isImage(m.mime_type, m.original_filename)
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); notify('success', msg); await load(); onChanged() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) } }
  const del = async () => { if (!window.confirm('Supprimer ce document ? Le fichier sera effacé du disque.')) return; try { await api.deleteMedia(m.id); notify('success', 'Document supprimé.'); onChanged(); onClose() } catch (e) { notify('error', errMsg(e)) } }
  return (
    <section className="panel fade-up p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl text-night-900">{m.title ?? m.original_filename ?? 'Document'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mist-500">
            <span className={`chip ${STATUS_CLASS[m.analysis_status] ?? 'conf-grey'}`}>{ANALYSIS_STATUS_LABEL[m.analysis_status] ?? m.analysis_status}</span>
            <span className="chip conf-grey">{methodLabel(method)}</span>
            {m.language && <span>langue : {m.language}</span>}
            <span>{m.mime_type ?? ''} · importé le {formatDate(m.created_at)}</span>
            {m.person_id && <Link className="underline" to={`/personnes/${m.person_id}`}>fiche liée</Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="btn-gold !py-1" disabled={busy !== null} onClick={() => act('an', () => api.analyzeMedia(m.id), 'Analyse lancée : suivez-la dans Enquêtes IA.')}>{busy === 'an' ? <Spinner /> : <FileSearch size={14} />}Analyser</button>
          <button className="btn-danger !py-1" onClick={del}><Trash2 size={14} /></button>
          <button className="btn-ghost !p-1.5" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-gold-500/40 bg-gold-500/10 p-3 text-sm"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-gold-600" />Une transcription automatique n’est jamais une preuve : vérifiez l’image.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          {image ? <ImageWithWords media={m} words={words} /> : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-ivory-300 bg-ivory-100 p-8 text-mist-500"><FileText size={48} strokeWidth={1.2} /><span className="text-xs">{m.original_filename}</span><button className="btn-ghost" onClick={() => openExternal(api.mediaFileUrl(m.id))}>Ouvrir le fichier</button></div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Titre"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Personne concernée"><select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">— aucune —</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></Field>
            <button className="btn-primary" disabled={busy !== null} onClick={() => act('meta', () => api.setTranscription(m.id, { title: title || undefined, person_id: personId || undefined }), 'Document mis à jour.')}>{busy === 'meta' ? <Spinner /> : <Save size={14} />}Enregistrer</button>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="label">Transcription</div>
            {transcription ? <div className="max-h-64 overflow-auto scrollbar-thin rounded-xl bg-ivory-100 p-3"><HighlightedText text={m.ocr_text ?? str(a.transcription) ?? ''} /></div> : <p className="text-xs text-mist-500">Aucune transcription. Lancez l’analyse ou saisissez-la ci-dessous.</p>}
            {uncertain.length > 0 && <p className="mt-1 text-xs text-mist-500">Passages incertains : {uncertain.map((u, i) => <mark key={i} className="mr-1 rounded bg-conf-orange/30 px-1">{u || '?'}</mark>)}</p>}
          </div>
          <ManualLlmPanel media={m} onDone={async () => { await load(); onChanged() }} />
          <div>
            <div className="label">Corriger la transcription</div>
            <textarea className="input font-display text-base" rows={6} value={transcription} onChange={(e) => setTranscription(e.target.value)} placeholder="Saisissez ou corrigez le texte tel qu’il figure sur le document." />
            <button className="btn-primary mt-2 !py-1" disabled={busy !== null} onClick={() => act('tr', () => api.setTranscription(m.id, { transcription }), 'Transcription enregistrée (méthode : manuelle).')}>{busy === 'tr' ? <Spinner /> : <Save size={14} />}Enregistrer la transcription</button>
          </div>
          {warnings.length > 0 && <ul className="space-y-1 text-xs text-conf-orange">{warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>}
          <div>
            <div className="label">Extraction</div>
            {Object.keys(ex).length === 0 ? <p className="text-xs text-mist-500">Aucune extraction disponible.</p> : (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2 text-xs">
                  {ex.document_type && <span className="chip bg-night-900/10 text-night-900">{DOC_TYPE_LABEL[ex.document_type] ?? ex.document_type}</span>}
                  {ex.language && <span className="chip conf-grey">langue : {ex.language}</span>}
                  {ex.date && <span className="chip conf-grey">date : {ex.date}</span>}
                  {ex.place && <span className="chip conf-grey">lieu : {ex.place}</span>}
                  {ex.method && <span className="chip conf-grey">{methodLabel(ex.method)}</span>}
                </div>
                {exPersons.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">{exPersons.map((p, i) => (
                    <div key={i} className="rounded-lg border border-ivory-200 bg-white/60 p-2">
                      <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-gold-600">{ROLE_LABEL[p.role ?? ''] ?? p.role ?? 'personne'}</span>{p.confidence && <span className={`chip ${p.confidence === 'high' ? 'conf-green' : p.confidence === 'medium' ? 'conf-orange' : 'conf-grey'}`}>{p.confidence === 'high' ? 'sûr' : p.confidence === 'medium' ? 'probable' : 'incertain'}</span>}</div>
                      <div className="font-medium text-night-900">{[p.given_names, p.surname].filter(Boolean).join(' ') || '—'}</div>
                      <div className="text-xs text-mist-500">{[p.age !== null && p.age !== undefined && p.age !== '' ? `${p.age} ans` : null, p.occupation, p.birth_date ? `né(e) ${p.birth_date}` : null].filter(Boolean).join(' · ')}</div>
                    </div>
                  ))}</div>
                )}
                {Array.isArray(ex.relations) && ex.relations.length > 0 && <JsonView value={ex.relations} label={`Relations extraites (${ex.relations.length})`} />}
                {ex.translation_fr && <div><div className="label">Traduction française</div><p className="whitespace-pre-wrap text-sm">{ex.translation_fr}</p></div>}
              </div>
            )}
          </div>
          <JsonView value={a} label="Analyse brute (JSON)" />
        </div>
      </div>
    </section>
  )
}

export function DocumentsTab({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { notify } = useApp()
  const [media, setMedia] = useState<MediaOut[] | null>(null)
  const [persons, setPersons] = useState<PersonSummary[]>([])
  const [filter, setFilter] = useState('')
  const [upPerson, setUpPerson] = useState('')
  const [upKind, setUpKind] = useState('document')
  const [upAnalyze, setUpAnalyze] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const load = useCallback(async () => { try { setMedia(await api.media(filter || undefined)) } catch (e) { notify('error', errMsg(e)); setMedia([]) } }, [filter, notify])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.persons().then(setPersons).catch(() => setPersons([])) }, [])
  useEffect(() => {
    const h = (ev: Event) => { const d = (ev as CustomEvent<{ type?: string }>).detail; if (d?.type === 'task') load() }
    window.addEventListener('genealis:event', h); return () => window.removeEventListener('genealis:event', h)
  }, [load])
  const personName = useMemo(() => new Map(persons.map((p) => [p.id, p.display_name])), [persons])
  const upload = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setUploading(true)
    let ok = 0
    for (const f of list) { try { await api.uploadMedia(f, { person_id: upPerson || undefined, kind: upKind, analyze: upAnalyze }); ok++ } catch (e) { notify('error', `${f.name} : ${errMsg(e)}`) } }
    if (ok > 0) notify('success', `${ok} document(s) importé(s)${upAnalyze ? ' ; analyse lancée (journal des Enquêtes IA)' : ''}.`)
    setUploading(false); load()
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }
  return (
    <div className="space-y-4">
      {selectedId && <MediaDetail id={selectedId} persons={persons} onClose={() => onSelect(null)} onChanged={load} />}
      <section className="panel fade-up p-5">
        <h2 className="mb-3 font-display text-xl text-night-900">Importer des documents</h2>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${drag ? 'border-gold-500 bg-gold-500/10' : 'border-ivory-300 bg-ivory-100/50'}`}>
          <Upload size={28} strokeWidth={1.4} className="text-gold-600" />
          <p className="text-sm">Glissez-déposez vos actes, photos ou PDF ici</p>
          <label className="btn-primary">{uploading ? <Spinner /> : <Upload size={15} />}Choisir des fichiers<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { upload(e.target.files); e.target.value = '' }} /></label>
          <p className="text-xs text-mist-500">Les fichiers restent sur votre ordinateur. L’analyse utilise les moteurs configurés dans Paramètres.</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="Personne concernée"><select className="input" value={upPerson} onChange={(e) => setUpPerson(e.target.value)}><option value="">— aucune —</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></Field>
          <Field label="Type"><select className="input" value={upKind} onChange={(e) => setUpKind(e.target.value)}><option value="document">Document (acte, registre…)</option><option value="photo">Photo</option><option value="portrait">Portrait</option></select></Field>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={upAnalyze} onChange={(e) => setUpAnalyze(e.target.checked)} />Analyser automatiquement</label>
        </div>
      </section>
      <section className="panel fade-up p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-night-900">Documents</h2><span className="text-xs text-mist-500">{media?.length ?? 0}</span>
          <select className="input ml-auto max-w-xs !py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Toutes les personnes</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select>
        </div>
        {media === null && <Spinner />}
        {media !== null && media.length === 0 && <Empty>Aucun document importé.</Empty>}
        {media && media.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">{media.map((m) => (
            <button key={m.id} onClick={() => onSelect(m.id)} className={`group overflow-hidden rounded-xl border bg-white/60 text-left cursor-pointer transition-shadow hover:shadow-md ${selectedId === m.id ? 'border-gold-500' : 'border-ivory-200'}`}>
              <div className="aspect-[4/3] overflow-hidden bg-ivory-100">{isImage(m.mime_type, m.original_filename) ? <img src={api.mediaFileUrl(m.id)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-mist-400"><FileText size={36} strokeWidth={1.2} /></div>}</div>
              <div className="p-2">
                <div className="truncate text-sm font-medium text-night-900">{m.title ?? m.original_filename ?? 'Sans titre'}</div>
                <div className="truncate text-xs text-mist-500">{m.person_id ? personName.get(m.person_id) ?? 'Personne' : 'Non rattaché'}</div>
                <span className={`chip mt-1 ${STATUS_CLASS[m.analysis_status] ?? 'conf-grey'}`}>{ANALYSIS_STATUS_LABEL[m.analysis_status] ?? m.analysis_status}</span>
              </div>
            </button>
          ))}</div>
        )}
      </section>
    </div>
  )
}
