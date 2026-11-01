import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, openExternal, type CitationOut, type SourceIn, type SourceOut } from '../../api'
import { useApp } from '../../store'
import { ConfidenceDot, Empty, Field, Spinner, formatDate } from '../ui'
import { JsonView, Modal, RELIABILITY_CLASS, RELIABILITY_LABEL, errMsg } from '../person/helpers'

const REGISTER_TYPES: [string, string][] = [['', '—'], ['birth', 'Naissance'], ['baptism', 'Baptême'], ['marriage', 'Mariage'], ['death', 'Décès'], ['burial', 'Sépulture'], ['census', 'Recensement'], ['military', 'Registre matricule'], ['notarial', 'Notarial'], ['table', 'Table décennale'], ['other', 'Autre']]
const REGISTER_LABEL: Record<string, string> = Object.fromEntries(REGISTER_TYPES.filter(([k]) => k))

type FormState = { title: string; repository: string; fonds: string; commune: string; register_type: string; reference: string; year: string; page: string; url: string; consulted_at: string; local_copy_allowed: boolean; transcription: string; translation: string; interpretation: string; language: string; reliability: string }
const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z'); if (isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const fromSource = (s: SourceOut | null): FormState => ({ title: s?.title ?? '', repository: s?.repository ?? '', fonds: s?.fonds ?? '', commune: s?.commune ?? '', register_type: s?.register_type ?? '', reference: s?.reference ?? '', year: s?.year ? String(s.year) : '', page: s?.page ?? '', url: s?.url ?? '', consulted_at: toLocalInput(s?.consulted_at ?? null), local_copy_allowed: s?.local_copy_allowed ?? false, transcription: s?.transcription ?? '', translation: s?.translation ?? '', interpretation: s?.interpretation ?? '', language: s?.language ?? '', reliability: s?.reliability ?? 'unknown' })

function SourceModal({ source, onClose, onSaved }: { source: SourceOut | null; onClose: () => void; onSaved: (s: SourceOut) => void }) {
  const { notify } = useApp()
  const [f, setF] = useState<FormState>(fromSource(source))
  const [busy, setBusy] = useState(false)
  const up = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!f.title.trim()) { notify('error', 'Le titre est obligatoire.'); return }
    setBusy(true)
    try {
      const data: Partial<SourceIn> = {
        title: f.title.trim(), repository: f.repository || null, fonds: f.fonds || null, commune: f.commune || null, register_type: f.register_type || null, reference: f.reference || null,
        year: f.year ? Number(f.year) : null, page: f.page || null, url: f.url || null, consulted_at: f.consulted_at ? new Date(f.consulted_at).toISOString() : null, local_copy_allowed: f.local_copy_allowed,
        transcription: f.transcription || null, translation: f.translation || null, interpretation: f.interpretation || null, language: f.language || null, reliability: f.reliability,
      }
      const s = source ? await api.updateSource(source.id, data) : await api.createSource(data)
      notify('success', source ? 'Source mise à jour.' : 'Source créée.'); onSaved(s); onClose()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title={source ? 'Modifier la source' : 'Nouvelle source'} onClose={onClose} wide
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Titre *"><input className="input" value={f.title} onChange={(e) => up('title', e.target.value)} placeholder="ex. Acte de naissance de Jean Martin, Lyon, 1895" /></Field></div>
        <Field label="Dépôt d’archives"><input className="input" value={f.repository} onChange={(e) => up('repository', e.target.value)} placeholder="ex. AD du Rhône" /></Field>
        <Field label="Fonds / série"><input className="input" value={f.fonds} onChange={(e) => up('fonds', e.target.value)} placeholder="ex. État civil, 4E" /></Field>
        <Field label="Commune"><input className="input" value={f.commune} onChange={(e) => up('commune', e.target.value)} /></Field>
        <Field label="Type de registre"><select className="input" value={f.register_type} onChange={(e) => up('register_type', e.target.value)}>{REGISTER_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Cote / référence"><input className="input" value={f.reference} onChange={(e) => up('reference', e.target.value)} /></Field>
        <Field label="Année"><input className="input" type="number" value={f.year} onChange={(e) => up('year', e.target.value)} /></Field>
        <Field label="Page / vue"><input className="input" value={f.page} onChange={(e) => up('page', e.target.value)} placeholder="ex. vue 112/340" /></Field>
        <div className="sm:col-span-2"><Field label="URL"><input className="input" value={f.url} onChange={(e) => up('url', e.target.value)} placeholder="https://…" /></Field></div>
        <Field label="Consultée le"><input className="input" type="datetime-local" value={f.consulted_at} onChange={(e) => up('consulted_at', e.target.value)} /></Field>
        <Field label="Langue"><input className="input" value={f.language} onChange={(e) => up('language', e.target.value)} placeholder="fr, it, la…" /></Field>
        <Field label="Fiabilité">
          <select className="input" value={f.reliability} onChange={(e) => up('reliability', e.target.value)}>{Object.entries(RELIABILITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.local_copy_allowed} onChange={(e) => up('local_copy_allowed', e.target.checked)} />Copie locale autorisée par les conditions du site</label>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Transcription (texte fidèle)"><textarea className="input font-display text-base" rows={4} value={f.transcription} onChange={(e) => up('transcription', e.target.value)} /></Field></div>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Traduction (si langue étrangère)"><textarea className="input" rows={2} value={f.translation} onChange={(e) => up('translation', e.target.value)} /></Field></div>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Interprétation (ce que l’on en déduit, à distinguer du texte)"><textarea className="input" rows={2} value={f.interpretation} onChange={(e) => up('interpretation', e.target.value)} /></Field></div>
      </div>
    </Modal>
  )
}

function SourceDrawer({ source, onClose, onEdit, onDeleted }: { source: SourceOut; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { notify } = useApp()
  const [cits, setCits] = useState<CitationOut[] | null>(null)
  useEffect(() => { setCits(null); api.sourceCitations(source.id).then(setCits).catch((e: unknown) => { notify('error', errMsg(e)); setCits([]) }) }, [source.id, notify])
  const del = async () => {
    if (!window.confirm(`Supprimer la source « ${source.title} » et ses ${source.citation_count} citation(s) ?`)) return
    try { await api.deleteSource(source.id); notify('success', 'Source supprimée.'); onDeleted() } catch (e) { notify('error', errMsg(e)) }
  }
  const rows: [string, string | null][] = [['Dépôt', source.repository], ['Fonds', source.fonds], ['Commune', source.commune], ['Registre', source.register_type ? REGISTER_LABEL[source.register_type] ?? source.register_type : null], ['Cote', source.reference], ['Année', source.year ? String(source.year) : null], ['Page / vue', source.page], ['Langue', source.language], ['Consultée le', source.consulted_at ? formatDate(source.consulted_at) : null], ['Connecteur', source.connector_id], ['Identifiant externe', source.external_id], ['Copie locale', source.local_copy_allowed === null ? null : source.local_copy_allowed ? 'autorisée' : 'non autorisée']]
  return (
    <aside className="panel fade-up flex h-fit flex-col gap-3 p-5 xl:sticky xl:top-0">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="font-display text-xl text-night-900">{source.title}</h2><span className={`chip ${RELIABILITY_CLASS[source.reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[source.reliability] ?? source.reliability}</span></div>
        <button className="btn-ghost !p-1.5" onClick={onClose}><X size={15} /></button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{rows.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="font-semibold text-mist-500">{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {source.transcription && <div><div className="label">Transcription</div><p className="whitespace-pre-wrap rounded-lg bg-ivory-100 p-2 font-display text-base">{source.transcription}</p></div>}
      {source.translation && <div><div className="label">Traduction</div><p className="whitespace-pre-wrap text-sm">{source.translation}</p></div>}
      {source.interpretation && <div><div className="label">Interprétation</div><p className="whitespace-pre-wrap text-sm text-mist-500">{source.interpretation}</p></div>}
      <JsonView value={source.extra} label="Données complémentaires" />
      <div>
        <div className="label">Citations ({source.citation_count})</div>
        {cits === null && <Spinner />}
        {cits !== null && cits.length === 0 && <p className="text-xs text-mist-500">Cette source ne cite encore aucune personne ni événement.</p>}
        <ul className="space-y-1 text-sm">{(cits ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-1.5"><ConfidenceDot level={c.confidence} />
            {c.target_type === 'person' ? <Link className="text-night-900 underline hover:text-gold-600" to={`/personnes/${c.target_id}`}>Personne</Link> : <span className="text-mist-500">{c.target_type}</span>}
            {c.excerpt && <span className="text-xs italic text-mist-500">« {c.excerpt} »</span>}
          </li>
        ))}</ul>
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        {source.url && <button className="btn-ghost !py-1" onClick={() => openExternal(source.url ?? '')}><ExternalLink size={14} />Ouvrir l’URL</button>}
        <button className="btn-ghost !py-1" onClick={onEdit}><Pencil size={14} />Modifier</button>
        <button className="btn-danger !py-1" onClick={del}><Trash2 size={14} />Supprimer</button>
      </div>
    </aside>
  )
}

export function SourcesTab({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { notify } = useApp()
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState<SourceOut[] | null>(null)
  const [modal, setModal] = useState<{ open: boolean; source: SourceOut | null }>({ open: false, source: null })
  const load = useCallback(async (qq: string) => { try { setSources(await api.sources(qq.trim() || undefined)) } catch (e) { notify('error', errMsg(e)); setSources([]) } }, [notify])
  useEffect(() => { const t = setTimeout(() => load(query), 250); return () => clearTimeout(t) }, [query, load])
  const [selected, setSelected] = useState<SourceOut | null>(null)
  useEffect(() => {
    if (!selectedId) { setSelected(null); return }
    const local = sources?.find((s) => s.id === selectedId)
    if (local) { setSelected(local); return }
    api.source(selectedId).then(setSelected).catch((e: unknown) => { notify('error', errMsg(e)); onSelect(null) })
  }, [selectedId, sources, notify, onSelect])
  return (
    <div className={`grid grid-cols-1 gap-4 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
      <section className="panel fade-up min-w-0 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-night-900">Sources</h2>
          <span className="text-xs text-mist-500">{sources?.length ?? 0} source(s)</span>
          <input className="input ml-auto max-w-xs" placeholder="Rechercher une source…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn-primary" onClick={() => setModal({ open: true, source: null })}><Plus size={15} />Nouvelle source</button>
        </div>
        {sources === null && <Spinner />}
        {sources !== null && sources.length === 0 && <Empty>Aucune source. Chaque fait de votre arbre devrait s’appuyer sur une source identifiée (acte, table, registre…).</Empty>}
        {sources && sources.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-mist-500"><th className="py-2 pr-3">Titre</th><th className="py-2 pr-3">Dépôt</th><th className="py-2 pr-3">Commune</th><th className="py-2 pr-3">Registre</th><th className="py-2 pr-3">Cote</th><th className="py-2 pr-3">Année</th><th className="py-2 pr-3">Page</th><th className="py-2 pr-3">Fiabilité</th><th className="py-2 pr-3">Cit.</th><th className="py-2">Connecteur</th></tr></thead>
            <tbody>{sources.map((s) => (
              <tr key={s.id} onClick={() => onSelect(s.id)} className={`cursor-pointer border-t border-ivory-200 hover:bg-ivory-100/60 ${selectedId === s.id ? 'bg-gold-500/10' : ''}`}>
                <td className="max-w-xs truncate py-2 pr-3 font-medium text-night-900" title={s.title}>{s.title}</td>
                <td className="py-2 pr-3">{s.repository ?? '—'}</td><td className="py-2 pr-3">{s.commune ?? '—'}</td>
                <td className="py-2 pr-3">{s.register_type ? REGISTER_LABEL[s.register_type] ?? s.register_type : '—'}</td>
                <td className="py-2 pr-3">{s.reference ?? '—'}</td><td className="py-2 pr-3">{s.year ?? '—'}</td><td className="py-2 pr-3">{s.page ?? '—'}</td>
                <td className="py-2 pr-3"><span className={`chip ${RELIABILITY_CLASS[s.reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[s.reliability] ?? s.reliability}</span></td>
                <td className="py-2 pr-3">{s.citation_count}</td><td className="py-2 text-xs text-mist-500">{s.connector_id ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {selected && <SourceDrawer source={selected} onClose={() => onSelect(null)} onEdit={() => setModal({ open: true, source: selected })} onDeleted={() => { onSelect(null); load(query) }} />}
      {modal.open && <SourceModal source={modal.source} onClose={() => setModal({ open: false, source: null })} onSaved={(s) => { load(query); onSelect(s.id) }} />}
    </div>
  )
}
