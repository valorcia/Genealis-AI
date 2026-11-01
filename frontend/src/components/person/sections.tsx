import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, FileText, Image as ImageIcon, MapPin, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { api, EVENT_LABEL, RELATION_LABEL, type CitationOut, type EventOut, type MediaOut, type Narrative, type PersonDetail, type PersonIn, type PersonSummary, type RelationOut } from '../../api'
import { useApp } from '../../store'
import { ConfidenceChip, ConfidenceDot, Empty, Field, Markdown, Panel, PersonLink, Spinner, formatDate } from '../ui'
import { ANALYSIS_STATUS_LABEL, RELIABILITY_CLASS, RELIABILITY_LABEL, errMsg, isImage } from './helpers'
import { EventModal } from './EventModal'
import { PersonPicker, type PickerMode } from './PersonPicker'
import { LinkSourceModal } from './LinkSourceModal'

type Props = { p: PersonDetail; reload: () => Promise<void> }


/* ---------------- Identité ---------------- */
export function IdentitySection({ p, reload }: Props) {
  const { notify } = useApp()
  const [form, setForm] = useState({ given_names: p.given_names ?? '', surname: p.surname ?? '', married_name: p.married_name ?? '', name_variants: p.name_variants.join(', '), sex: p.sex ?? '', nationality: p.nationality ?? '', occupation: p.occupation ?? '', is_living: p.is_living === null ? '' : p.is_living ? 'yes' : 'no', is_root: p.is_root, notes: p.notes ?? '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { setForm({ given_names: p.given_names ?? '', surname: p.surname ?? '', married_name: p.married_name ?? '', name_variants: p.name_variants.join(', '), sex: p.sex ?? '', nationality: p.nationality ?? '', occupation: p.occupation ?? '', is_living: p.is_living === null ? '' : p.is_living ? 'yes' : 'no', is_root: p.is_root, notes: p.notes ?? '' }) }, [p])
  const save = async () => {
    setBusy(true)
    try {
      const data: PersonIn = {
        given_names: form.given_names.trim() || null, surname: form.surname.trim() || null, married_name: form.married_name.trim() || null,
        name_variants: form.name_variants.split(',').map((s) => s.trim()).filter(Boolean), sex: form.sex || null, nationality: form.nationality.trim() || null,
        occupation: form.occupation.trim() || null, is_living: form.is_living === '' ? null : form.is_living === 'yes', is_root: form.is_root, notes: form.notes.trim() || null,
      }
      await api.updatePerson(p.id, data); notify('success', 'Identité enregistrée.'); await reload()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Panel title="Identité" actions={<button className="btn-primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Check size={15} />}Enregistrer</button>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Prénoms"><input className="input" value={form.given_names} onChange={(e) => setForm({ ...form, given_names: e.target.value })} /></Field>
        <Field label="Nom de naissance"><input className="input" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} /></Field>
        <Field label="Nom d’épouse / d’usage"><input className="input" value={form.married_name} onChange={(e) => setForm({ ...form, married_name: e.target.value })} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Variantes du nom (séparées par des virgules)"><input className="input" value={form.name_variants} onChange={(e) => setForm({ ...form, name_variants: e.target.value })} placeholder="ex. Lefebvre, Lefèvre, Le Febvre" /></Field></div>
        <Field label="Sexe">
          <select className="input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="">Inconnu</option><option value="M">Masculin</option><option value="F">Féminin</option></select>
        </Field>
        <Field label="Nationalité"><input className="input" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} /></Field>
        <Field label="Profession principale"><input className="input" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} /></Field>
        <Field label="Personne vivante ?">
          <select className="input" value={form.is_living} onChange={(e) => setForm({ ...form, is_living: e.target.value })}><option value="">Inconnu</option><option value="yes">Oui (données protégées)</option><option value="no">Non</option></select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={form.is_root} onChange={(e) => setForm({ ...form, is_root: e.target.checked })} />Racine de l’arbre (personne de référence)</label>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Notes"><textarea className="input" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
      <p className="mt-3 text-xs text-mist-500">Créée le {formatDate(p.created_at)} · modifiée le {formatDate(p.updated_at)}</p>
    </Panel>
  )
}

/* ---------------- Biographie ---------------- */
export function NarrativeSection({ p }: { p: PersonDetail }) {
  const [n, setN] = useState<Narrative | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setN(null); setErr(null); api.narrative(p.id).then(setN).catch((e: unknown) => setErr(errMsg(e))) }, [p.id])
  if (err) return <Panel title="Biographie documentée"><Empty>{err}</Empty></Panel>
  if (!n) return <Panel title="Biographie documentée"><Spinner /></Panel>
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel title="Biographie documentée">
        {n.paragraphs.length === 0 && <Empty>Pas encore assez de faits documentés pour rédiger une biographie.</Empty>}
        <div className="space-y-4">
          {n.paragraphs.map((par, i) => (
            <div key={i} className="rounded-xl border border-ivory-200 bg-white/60 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-mist-500">
                {par.year !== null && <span className="font-display text-base text-gold-600">{par.year}</span>}
                <ConfidenceChip level={par.confidence} />
              </div>
              <Markdown text={par.text} />
              {par.sources.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-mist-500 hover:text-night-900">Sources ({par.sources.length})</summary>
                  <ul className="mt-1 space-y-1">{par.sources.map((c) => <li key={c.id}><CitationLine c={c} /></li>)}</ul>
                </details>
              )}
            </div>
          ))}
        </div>
        {n.unsourced_count > 0 && <p className="mt-3 flex items-center gap-1.5 text-xs text-conf-orange"><AlertTriangle size={13} />{n.unsourced_count} affirmation(s) sans source : à vérifier avant toute publication.</p>}
      </Panel>
      <Panel title="Contexte historique">
        {n.historical_context.length === 0 ? <Empty>Aucun repère historique pour cette période.</Empty> : (
          <ul className="space-y-2 text-sm">
            {n.historical_context.map((h, i) => (
              <li key={i} className="border-l-2 border-gold-500/60 pl-3">
                <div className="font-display text-base text-night-900">{h.start}{h.end !== h.start ? `–${h.end}` : ''}</div>
                <div>{h.label}</div><div className="text-xs text-mist-500">{h.region}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-mist-500">Le contexte historique est fourni à titre indicatif et ne constitue pas une preuve.</p>
      </Panel>
    </div>
  )
}

function CitationLine({ c }: { c: CitationOut }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ConfidenceDot level={c.confidence} />
      <Link className="font-medium text-night-900 hover:text-gold-600" to={`/archives?source=${c.source_id}`}>{c.source_title ?? 'Source'}</Link>
      {c.source_reliability && <span className={`chip ${RELIABILITY_CLASS[c.source_reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[c.source_reliability] ?? c.source_reliability}</span>}
      {c.excerpt && <span className="italic text-mist-500">« {c.excerpt} »</span>}
    </span>
  )
}

/* ---------------- Chronologie ---------------- */
export function EventsSection({ p, reload }: Props) {
  const { notify } = useApp()
  const [modal, setModal] = useState<{ open: boolean; event: EventOut | null }>({ open: false, event: null })
  const events = useMemo(() => [...p.events].sort((a, b) => (a.sort_year ?? 99999) - (b.sort_year ?? 99999)), [p.events])
  const del = async (ev: EventOut) => {
    if (!window.confirm(`Supprimer l’événement « ${EVENT_LABEL[ev.event_type] ?? ev.event_type} » ?`)) return
    try { await api.deleteEvent(ev.id); notify('success', 'Événement supprimé.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  return (
    <Panel title="Chronologie personnelle" actions={<button className="btn-primary" onClick={() => setModal({ open: true, event: null })}><Plus size={15} />Ajouter un événement</button>}>
      {events.length === 0 ? <Empty>Aucun événement enregistré.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-mist-500"><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Lieu</th><th className="py-2 pr-3">Détails</th><th className="py-2 pr-3">Confiance</th><th className="py-2 pr-3">Sources</th><th className="py-2"></th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-ivory-200 align-top hover:bg-ivory-100/60">
                  <td className="py-2 pr-3 font-medium">{EVENT_LABEL[ev.event_type] ?? ev.event_type}{ev.family_id && <span className="ml-1 text-[10px] text-mist-500">(famille)</span>}</td>
                  <td className="py-2 pr-3" title={ev.date_original ? `Tel qu’écrit : ${ev.date_original}` : undefined}>{ev.date_display || <span className="text-mist-400">—</span>}{ev.calendar && ev.calendar !== 'gregorian' && <span className="ml-1 text-[10px] text-mist-500">({ev.calendar})</span>}</td>
                  <td className="py-2 pr-3">{ev.place_name ?? ev.place_original ?? <span className="text-mist-400">—</span>}</td>
                  <td className="py-2 pr-3 text-mist-500">{ev.description}{ev.value_original && <div className="font-display italic text-night-900">« {ev.value_original} »</div>}</td>
                  <td className="py-2 pr-3"><ConfidenceChip level={ev.confidence} /></td>
                  <td className="py-2 pr-3">{ev.citations.length}</td>
                  <td className="py-2 whitespace-nowrap"><button className="btn-ghost !px-2 !py-1" title="Modifier" onClick={() => setModal({ open: true, event: ev })}><Pencil size={14} /></button> <button className="btn-ghost !px-2 !py-1" title="Supprimer" onClick={() => del(ev)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal.open && <EventModal personId={p.id} event={modal.event} onClose={() => setModal({ open: false, event: null })} onSaved={reload} />}
    </Panel>
  )
}

/* ---------------- Famille ---------------- */
function RelationBadge({ r, onDelete }: { r: RelationOut; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const crit = r.confidence_details.criteria ?? []
  return (
    <div className="text-xs text-mist-500">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span>filiation {RELATION_LABEL[r.relation_type] ?? r.relation_type}</span>
        <ConfidenceChip level={r.confidence} />
        <button className="underline hover:text-night-900 cursor-pointer" onClick={() => setOpen((v) => !v)}>{open ? 'masquer' : 'détails'}</button>
        <button className="text-conf-red hover:underline cursor-pointer" onClick={onDelete} title="Supprimer le lien"><Trash2 size={12} /></button>
      </span>
      {open && (
        <div className="mt-1 rounded-lg bg-ivory-100 p-2">
          {crit.length === 0 ? <span>Aucun critère détaillé.</span> : <ul className="list-disc pl-4">{crit.map((c, i) => <li key={i}>{c}</li>)}</ul>}
          {typeof r.confidence_details.sources === 'number' && <div className="mt-1">Sources : {r.confidence_details.sources}</div>}
          {r.notes && <div className="mt-1 italic">{r.notes}</div>}
        </div>
      )}
    </div>
  )
}

function FamilyBlock({ title, items, action, onDeleteRel }: { title: string; items: { person: PersonSummary; rel?: RelationOut }[]; action?: ReactNode; onDeleteRel: (r: RelationOut) => void }) {
  return (
    <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
      <div className="mb-2 flex items-center justify-between"><h3 className="font-display text-lg text-night-900">{title}</h3>{action}</div>
      {items.length === 0 ? <p className="text-xs text-mist-500">Aucun.</p> : (
        <ul className="space-y-2">{items.map(({ person, rel }) => <li key={person.id}><PersonLink p={person} />{rel && <RelationBadge r={rel} onDelete={() => onDeleteRel(rel)} />}</li>)}</ul>
      )}
    </div>
  )
}

export function FamilySection({ p, reload }: Props) {
  const { notify } = useApp()
  const [picker, setPicker] = useState<PickerMode | null>(null)
  const byId = useMemo(() => { const m = new Map<string, PersonSummary>(); [...p.parents, ...p.children, ...p.spouses, ...p.siblings].forEach((x) => m.set(x.id, x)); return m }, [p])
  const delRel = async (r: RelationOut) => {
    if (!window.confirm('Supprimer ce lien de parenté ? Les personnes sont conservées.')) return
    try { await api.deleteRelation(r.id); notify('success', 'Lien supprimé.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  const exclude = useMemo(() => [p.id, ...byId.keys()], [p.id, byId])
  return (
    <Panel title="Famille">
      <div className="grid gap-4 md:grid-cols-2">
        <FamilyBlock onDeleteRel={delRel} title="Parents" items={p.parents.map((x) => ({ person: x, rel: p.parent_relations.find((r) => r.parent_id === x.id) }))} action={<button className="btn-ghost !py-1" onClick={() => setPicker('parent')}><Plus size={14} />Ajouter un parent</button>} />
        <FamilyBlock onDeleteRel={delRel} title="Frères et sœurs" items={p.siblings.map((x) => ({ person: x }))} />
        <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-display text-lg text-night-900">Unions</h3><button className="btn-ghost !py-1" onClick={() => setPicker('spouse')}><Plus size={14} />Ajouter un conjoint</button></div>
          {p.families.length === 0 && p.spouses.length === 0 && <p className="text-xs text-mist-500">Aucune union enregistrée.</p>}
          <ul className="space-y-3">
            {p.families.map((f) => {
              const otherId = f.partner1_id === p.id ? f.partner2_id : f.partner1_id
              const other = otherId ? byId.get(otherId) : undefined
              const marriages = f.events.filter((e) => ['marriage', 'marriage_banns', 'marriage_contract', 'divorce'].includes(e.event_type))
              return (
                <li key={f.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">{other ? <PersonLink p={other} /> : <span className="text-mist-500">Conjoint inconnu</span>}<ConfidenceChip level={f.confidence} /><span className="text-xs text-mist-500">{f.union_type === 'marriage' ? 'mariage' : f.union_type}</span></div>
                  {marriages.map((e) => <div key={e.id} className="ml-4 text-xs text-mist-500">{EVENT_LABEL[e.event_type] ?? e.event_type} : {e.date_display || '?'}{e.place_name ? ` à ${e.place_name}` : ''}</div>)}
                  {f.children_ids.length > 0 && <div className="ml-4 text-xs text-mist-500">{f.children_ids.length} enfant(s) de cette union</div>}
                </li>
              )
            })}
            {p.spouses.filter((s) => !p.families.some((f) => f.partner1_id === s.id || f.partner2_id === s.id)).map((s) => <li key={s.id}><PersonLink p={s} /></li>)}
          </ul>
        </div>
        <FamilyBlock onDeleteRel={delRel} title="Enfants" items={p.children.map((x) => ({ person: x, rel: p.child_relations.find((r) => r.child_id === x.id) }))} action={<button className="btn-ghost !py-1" onClick={() => setPicker('child')}><Plus size={14} />Ajouter un enfant</button>} />
      </div>
      {picker && <PersonPicker personId={p.id} mode={picker} exclude={exclude} onClose={() => setPicker(null)} onDone={reload} />}
    </Panel>
  )
}

/* ---------------- Lieux ---------------- */
export function PlacesSection({ p }: { p: PersonDetail }) {
  const places = useMemo(() => {
    const m = new Map<string, EventOut[]>()
    p.events.forEach((e) => { const n = e.place_name ?? e.place_original; if (n) m.set(n, [...(m.get(n) ?? []), e]) })
    return [...m.entries()].sort((a, b) => ((a[1][0]?.sort_year ?? 9999) - (b[1][0]?.sort_year ?? 9999)))
  }, [p.events])
  return (
    <Panel title="Lieux de vie" actions={<Link className="btn-ghost" to="/carte"><MapPin size={15} />Voir la carte</Link>}>
      {places.length === 0 ? <Empty>Aucun lieu connu : ajoutez des événements avec un lieu.</Empty> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {places.map(([name, evs]) => (
            <li key={name} className="rounded-xl border border-ivory-200 bg-white/60 p-3">
              <div className="flex items-center gap-1.5 font-medium text-night-900"><MapPin size={14} className="text-gold-600" />{name}</div>
              <ul className="mt-1 text-xs text-mist-500">{evs.map((e) => <li key={e.id}>{EVENT_LABEL[e.event_type] ?? e.event_type}{e.date_display ? ` · ${e.date_display}` : ''}</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ---------------- Documents ---------------- */
export function MediaSection({ p, reload }: Props) {
  const { notify } = useApp()
  const nav = useNavigate()
  const [kind, setKind] = useState('document')
  const [busy, setBusy] = useState(false)
  const upload = async (files: FileList | null, k: string) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      for (const f of Array.from(files)) await api.uploadMedia(f, { person_id: p.id, kind: k, analyze: k !== 'portrait' })
      notify('success', k === 'portrait' ? 'Portrait défini.' : `${files.length} document(s) importé(s) ; analyse lancée (suivi dans Enquêtes IA).`)
      await reload()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  const analyze = async (m: MediaOut) => { try { await api.analyzeMedia(m.id); notify('info', 'Analyse lancée : suivez-la dans Enquêtes IA.'); await reload() } catch (e) { notify('error', errMsg(e)) } }
  const del = async (m: MediaOut) => {
    if (!window.confirm(`Supprimer le document « ${m.title ?? m.original_filename ?? m.id} » ? Le fichier sera effacé.`)) return
    try { await api.deleteMedia(m.id); notify('success', 'Document supprimé.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  return (
    <Panel title="Documents originaux" actions={
      <div className="flex flex-wrap items-center gap-2">
        <select className="input !w-auto !py-1.5" value={kind} onChange={(e) => setKind(e.target.value)}><option value="document">Document</option><option value="photo">Photo</option></select>
        <label className="btn-primary">{busy ? <Spinner /> : <Upload size={15} />}Importer<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { upload(e.target.files, kind); e.target.value = '' }} /></label>
        <label className="btn-ghost"><ImageIcon size={15} />Définir comme portrait<input type="file" hidden accept="image/*" onChange={(e) => { upload(e.target.files, 'portrait'); e.target.value = '' }} /></label>
      </div>}>
      {p.media.length === 0 ? <Empty>Aucun document. Importez un acte, une photo ou un PDF : il sera transcrit et analysé localement.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {p.media.map((m) => (
            <div key={m.id} className="group overflow-hidden rounded-xl border border-ivory-200 bg-white/60">
              <button className="block aspect-[4/3] w-full cursor-pointer overflow-hidden bg-ivory-100" onClick={() => nav(`/archives?media=${m.id}`)}>
                {isImage(m.mime_type, m.original_filename) ? <img src={api.mediaFileUrl(m.id)} alt={m.title ?? ''} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-mist-400"><FileText size={40} strokeWidth={1.2} /></div>}
              </button>
              <div className="p-3">
                <div className="truncate text-sm font-medium text-night-900" title={m.title ?? m.original_filename ?? ''}>{m.title ?? m.original_filename ?? 'Sans titre'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mist-500">
                  <span className="chip conf-grey">{m.kind === 'portrait' ? 'Portrait' : m.kind === 'photo' ? 'Photo' : 'Document'}</span>
                  <span className={`chip ${m.analysis_status === 'done' ? 'conf-green' : m.analysis_status === 'failed' || m.analysis_status === 'error' ? 'conf-red' : m.analysis_status === 'running' ? 'conf-orange' : 'conf-grey'}`}>{ANALYSIS_STATUS_LABEL[m.analysis_status] ?? m.analysis_status}</span>
                </div>
                <div className="mt-2 flex gap-1">
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => nav(`/archives?media=${m.id}`)}>Ouvrir</button>
                  {m.kind !== 'portrait' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => analyze(m)}>Analyser</button>}
                  <button className="btn-ghost !px-2 !py-1 text-xs text-conf-red" onClick={() => del(m)} title="Supprimer"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/* ---------------- Sources ---------------- */
export function SourcesSection({ p, reload }: Props) {
  const { notify } = useApp()
  const [open, setOpen] = useState(false)
  const del = async (c: CitationOut) => {
    if (!window.confirm('Retirer cette citation ? La source est conservée.')) return
    try { await api.deleteCitation(c.id); notify('success', 'Citation retirée.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  return (
    <Panel title="Sources" actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={15} />Lier une source</button>}>
      {p.citations.length === 0 ? <Empty>Aucune source ne cite encore cette personne.</Empty> : (
        <ul className="divide-y divide-ivory-200">
          {p.citations.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-night-900 hover:text-gold-600" to={`/archives?source=${c.source_id}`}>{c.source_title ?? 'Source'}</Link>
                  {c.source_reliability && <span className={`chip ${RELIABILITY_CLASS[c.source_reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[c.source_reliability] ?? c.source_reliability}</span>}
                  <ConfidenceChip level={c.confidence} />
                  {c.target_type !== 'person' && <span className="text-xs text-mist-500">(cite : {c.target_type})</span>}
                </div>
                {c.excerpt && <p className="mt-1 font-display italic text-night-900">« {c.excerpt} »</p>}
                {c.note && <p className="text-xs text-mist-500">{c.note}</p>}
              </div>
              <button className="btn-ghost !px-2 !py-1" title="Retirer" onClick={() => del(c)}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {open && <LinkSourceModal targetType="person" targetId={p.id} onClose={() => setOpen(false)} onDone={reload} />}
    </Panel>
  )
}

/* ---------------- Hypothèses ---------------- */
const HYP_STATUS: Record<string, string> = { open: 'Ouverte', confirmed: 'Confirmée', rejected: 'Rejetée', superseded: 'Remplacée' }
export function HypothesesSection({ p, reload }: Props) {
  const { notify } = useApp()
  const set = async (id: string, status: string) => { try { await api.setHypothesisStatus(id, status); notify('success', `Hypothèse ${HYP_STATUS[status]?.toLowerCase() ?? status}.`); await reload() } catch (e) { notify('error', errMsg(e)) } }
  return (
    <Panel title="Hypothèses">
      <p className="mb-3 flex items-start gap-2 rounded-xl bg-gold-500/10 p-3 text-xs text-night-900"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-gold-600" />Confirmer une hypothèse n’ajoute aucun fait automatiquement à la fiche : c’est à vous de saisir l’événement ou le lien après vérification du document.</p>
      {p.hypotheses.length === 0 ? <Empty>Aucune hypothèse pour cette personne.</Empty> : (
        <ul className="space-y-2">
          {p.hypotheses.map((h) => (
            <li key={h.id} className="rounded-xl border border-ivory-200 bg-white/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-night-900">{h.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-mist-500">
                    <span className={`chip ${h.status === 'confirmed' ? 'conf-green' : h.status === 'rejected' ? 'conf-red' : 'conf-orange'}`}>{HYP_STATUS[h.status] ?? h.status}</span>
                    {h.score !== null && <span>Score {Math.round(h.score)} / 100</span>}
                    <span>par {h.created_by}</span><span>· {formatDate(h.created_at)}</span>
                    {h.task_id && <Link className="underline" to="/enquetes">enquête</Link>}
                  </div>
                </div>
                {h.status === 'open' && <div className="flex gap-1"><button className="btn-sage !py-1" onClick={() => set(h.id, 'confirmed')}><Check size={14} />Confirmer</button><button className="btn-ghost !py-1" onClick={() => set(h.id, 'rejected')}><X size={14} />Rejeter</button></div>}
              </div>
              {h.description && <p className="mt-2 text-sm text-mist-500">{h.description}</p>}
              {Array.isArray(h.score_details.criteria) && (
                <details className="mt-1 text-xs"><summary className="cursor-pointer text-mist-500">Critères du score</summary>
                  <ul className="mt-1 list-disc pl-4 text-mist-500">{(h.score_details.criteria as unknown[]).map((c, i) => <li key={i}>{typeof c === 'string' ? c : JSON.stringify(c)}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ---------------- Contradictions ---------------- */
export function ContradictionsSection({ p, reload }: Props) {
  const { notify } = useApp()
  const set = async (id: string, status: string) => { try { await api.setContradictionStatus(id, status); notify('success', 'Statut mis à jour.'); await reload() } catch (e) { notify('error', errMsg(e)) } }
  return (
    <Panel title="Contradictions">
      {p.contradictions.length === 0 ? <Empty>Aucune contradiction détectée.</Empty> : (
        <ul className="space-y-2">
          {p.contradictions.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-ivory-200 bg-white/60 p-3">
              <div className="text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className={`chip conf-${c.severity}`}><ConfidenceDot level={c.severity} />{c.severity === 'red' ? 'Bloquante' : 'À vérifier'}</span><span className="text-xs text-mist-500">{c.kind} · {c.status === 'open' ? 'ouverte' : c.status === 'resolved' ? 'résolue' : c.status === 'ignored' ? 'ignorée' : c.status}</span></div>
                <p className="mt-1">{c.description}</p>
                {c.resolution_note && <p className="text-xs text-mist-500">{c.resolution_note}</p>}
              </div>
              {c.status === 'open' && <div className="flex gap-1"><button className="btn-sage !py-1" onClick={() => set(c.id, 'resolved')}>Marquer résolue</button><button className="btn-ghost !py-1" onClick={() => set(c.id, 'ignored')}>Ignorer</button></div>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ---------------- Questions ---------------- */
export function QuestionsSection({ p }: { p: PersonDetail }) {
  return (
    <Panel title="Questions ouvertes" actions={<Link className="btn-ghost" to="/questions">Répondre dans Questions</Link>}>
      {p.questions.length === 0 ? <Empty>Aucune question en attente pour cette personne.</Empty> : (
        <ul className="space-y-2">
          {p.questions.map((qq) => (
            <li key={qq.id} className="rounded-xl border border-ivory-200 bg-white/60 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-night-900">{qq.title}</span><span className="chip conf-grey">priorité {qq.priority}</span><span className="text-xs text-mist-500">{qq.status === 'pending' ? 'en attente' : qq.status}</span></div>
              {qq.problem && <p className="mt-1 text-xs text-mist-500">{qq.problem}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

