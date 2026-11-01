import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, BookOpen, Check, ChevronRight, FileText, Globe, GitCompare, HelpCircle, History, IdCard, Image as ImageIcon, Lightbulb,
  Link2, MapPin, Plus, Trash2, Upload, Users, X, CalendarDays, Library,
} from 'lucide-react'
import { api, RELATION_LABEL, type CitationOut, type EventOut, type FamilyOut, type LogOut, type MediaOut, type Narrative, type PersonDetail, type PersonIn, type PersonSummary, type RelationOut, type RelativeKind } from '../../api'
import { useApp } from '../../store'
import { ConfidenceChip, ConfidenceDot, Markdown, Spinner, formatDate } from '../ui'
import { ANALYSIS_STATUS_LABEL, Avatar, GroupCard, LinkButton, RELIABILITY_CLASS, RELIABILITY_LABEL, SoftEmpty, ageText, errMsg, isImage } from './helpers'
import { AddEventSheet, EventSheet, type FamilyChoice } from './EventModal'
import { MARRIAGE_TYPES, eventIcon, eventLabel } from './eventMeta'
import { LinkSourceModal } from './LinkSourceModal'

type Props = { p: PersonDetail; reload: () => Promise<void> }

/** Choix d'ajout d'un proche (même forme que celui attendu par AddRelativeSheet). */
export interface RelChoice { kind: RelativeKind; label: string; group: 'parents' | 'fratrie' | 'enfants' | 'couple' | 'grands-parents'; otherParent?: PersonSummary }
export type AddRequest = RelChoice | 'menu'

const fem = (p: { sex: 'M' | 'F' | null }) => (p.sex === 'F' ? 'e' : p.sex === 'M' ? '' : '(e)')

/** Libellé du conjoint d'une famille, vu depuis la personne. */
export function partnerOf(p: PersonDetail, f: FamilyOut): PersonSummary | undefined {
  const otherId = f.partner1_id === p.id ? f.partner2_id : f.partner1_id
  return otherId ? p.spouses.find((s) => s.id === otherId) : undefined
}
export function familyChoices(p: PersonDetail): FamilyChoice[] {
  return p.families.map((f) => ({ id: f.id, label: partnerOf(p, f)?.display_name ?? 'conjoint inconnu' }))
}

/* ---------------- Identité ---------------- */
function identityForm(p: PersonDetail) {
  return { given_names: p.given_names ?? '', surname: p.surname ?? '', married_name: p.married_name ?? '', name_variants: p.name_variants.join(', '), sex: p.sex ?? '', nationality: p.nationality ?? '', occupation: p.occupation ?? '', is_living: p.is_living === null ? '' : p.is_living ? 'yes' : 'no', is_root: p.is_root, notes: p.notes ?? '' }
}
export function IdentitySection({ p, reload }: Props) {
  const { notify } = useApp()
  const [form, setForm] = useState(() => identityForm(p))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setForm(identityForm(p)) }, [p])
  const dirty = JSON.stringify(form) !== JSON.stringify(identityForm(p))
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
  const age = ageText(p)
  const row = (label: string, node: ReactNode) => <label className="block"><span className="label">{label}</span>{node}</label>
  return (
    <GroupCard id="identite" title="Identité" tint="#2f6fd1" icon={<IdCard size={18} />}
      actions={dirty ? <button className="btn-primary !px-3 !py-1.5" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Check size={15} />}Enregistrer</button> : undefined}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {row('Prénom(s)', <input className="input" value={form.given_names} onChange={(e) => setForm({ ...form, given_names: e.target.value })} />)}
        {row('Nom de naissance', <input className="input" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />)}
        {row('Nom d’usage / marital', <input className="input" value={form.married_name} onChange={(e) => setForm({ ...form, married_name: e.target.value })} />)}
        {row('Autres noms (séparés par des virgules)', <input className="input" value={form.name_variants} onChange={(e) => setForm({ ...form, name_variants: e.target.value })} placeholder="ex. Lefebvre, Lefèvre" />)}
        {row('Sexe', <select className="input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="">Inconnu</option><option value="M">Homme</option><option value="F">Femme</option></select>)}
        {row('Profession', <input className="input" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />)}
        {row('Nationalité', <input className="input" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />)}
        {row(`Vivant${fem(p)} ?`, <select className="input" value={form.is_living} onChange={(e) => setForm({ ...form, is_living: e.target.value })}><option value="">Je ne sais pas</option><option value="yes">Oui (données protégées)</option><option value="no">Non, décédé{fem(p)}</option></select>)}
        <div className="sm:col-span-2">
          <span className="label">Âge</span>
          <div className="rounded-xl bg-mist-100 px-3 py-2 text-sm text-night-900">{age ?? <span className="text-mist-500">Pas calculable : il faut au moins une année de naissance (et de décès si la personne est décédée).</span>}</div>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.is_root} onChange={(e) => setForm({ ...form, is_root: e.target.checked })} />Personne de départ de l’arbre</label>
        <div className="sm:col-span-2">{row('Notes', <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />)}</div>
      </div>
      {dirty && <button className="btn-primary mt-3 w-full justify-center sm:hidden" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Check size={15} />}Enregistrer l’identité</button>}
      <p className="mt-3 text-xs text-mist-400">Créée le {formatDate(p.created_at)} · modifiée le {formatDate(p.updated_at)}</p>
    </GroupCard>
  )
}

/* ---------------- Événements (style MacFamilyTree) ---------------- */
type EditState = { event: EventOut | null; type?: string; familyId?: string; fromPicker?: boolean }

function EventRow({ ev, label, onClick }: { ev: EventOut; label?: string; onClick: () => void }) {
  const Icon = eventIcon(ev.event_type)
  const place = ev.place_name ?? ev.place_original
  return (
    <button onClick={onClick} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-black/[0.03]">
      <Icon size={22} className="mt-0.5 shrink-0 text-night-900" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-mist-500">{label ?? eventLabel(ev.event_type)}<ConfidenceDot level={ev.confidence} />{ev.citations.length > 0 && <span className="normal-case">· {ev.citations.length} source{ev.citations.length > 1 ? 's' : ''}</span>}</span>
        <span className="block text-[15px] text-night-900">{ev.date_display || <span className="text-mist-400">Date inconnue</span>}</span>
        {place && <span className="block text-sm text-night-900/80"><MapPin size={12} className="mr-1 inline text-mist-400" />{place}</span>}
        {ev.description && <span className="block text-sm text-mist-500">{ev.description}</span>}
        {ev.value_original && <span className="block text-xs italic text-mist-500">« {ev.value_original} »</span>}
      </span>
      <ChevronRight size={16} className="mt-1 shrink-0 text-mist-300" />
    </button>
  )
}
function MissingRow({ type, text, onClick }: { type: string; text: string; onClick: () => void }) {
  const Icon = eventIcon(type)
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 bg-[#f4f6fb] px-3 py-3 text-left text-[15px] text-mist-400 hover:bg-[#eaeef8]">
      <Icon size={22} className="shrink-0 text-mist-300" strokeWidth={1.7} /><span className="min-w-0 flex-1">{text}</span><Plus size={16} className="shrink-0 text-mist-300" />
    </button>
  )
}

export function EventsSection({ p, reload }: Props) {
  const [edit, setEdit] = useState<EditState | null>(null)
  const [picker, setPicker] = useState(false)
  const families = useMemo(() => familyChoices(p), [p])
  const rows = useMemo(() => {
    const out: ReactNode[] = []
    const used = new Set<string>()
    const personal = [...p.events].filter((e) => !e.family_id).sort((a, b) => (a.sort_year ?? 99999) - (b.sort_year ?? 99999))
    const push = (type: string, missingText: string, labelOf?: (e: EventOut) => string) => {
      const evs = personal.filter((e) => e.event_type === type)
      evs.forEach((e) => { used.add(e.id); out.push(<EventRow key={e.id} ev={e} label={labelOf?.(e)} onClick={() => setEdit({ event: e })} />) })
      if (evs.length === 0) out.push(<MissingRow key={`m-${type}`} type={type} text={missingText} onClick={() => setEdit({ event: null, type })} />)
    }
    push('birth', 'Naissance – Saisir l’information ici')
    push('baptism', 'Baptême – Saisir l’information ici')
    push('occupation', p.occupation ? `Profession – ${p.occupation} (ajouter la date et le lieu)` : 'Profession – Saisir l’information ici')
    for (const f of p.families) {
      const partner = partnerOf(p, f)
      const name = partner?.display_name ?? 'conjoint inconnu'
      const evs = [...f.events].sort((a, b) => (a.sort_year ?? 99999) - (b.sort_year ?? 99999))
      evs.forEach((e) => { used.add(e.id); out.push(<EventRow key={e.id} ev={e} label={`${eventLabel(e.event_type)} avec ${name}`} onClick={() => setEdit({ event: e })} />) })
      if (!evs.some((e) => MARRIAGE_TYPES.includes(e.event_type))) out.push(<MissingRow key={`m-mar-${f.id}`} type="marriage" text={`Mariage avec ${name} – Saisir les informations ici`} onClick={() => setEdit({ event: null, type: 'marriage', familyId: f.id })} />)
    }
    push('death', 'Décès – Saisir l’information ici')
    push('burial', 'Inhumation – Saisir l’information ici')
    const others = personal.filter((e) => !used.has(e.id))
    return { main: out, others }
  }, [p])
  return (
    <GroupCard id="evenements" title="Événements" tint="#e2574c" icon={<CalendarDays size={18} />} count={p.events.length + p.families.reduce((n, f) => n + f.events.length, 0)}
      actions={<LinkButton onClick={() => setPicker(true)}><Plus size={15} />Ajouter</LinkButton>}>
      <div className="-mx-1 overflow-hidden rounded-2xl ring-1 ring-black/5 [&>*+*]:border-t [&>*+*]:border-black/5">{rows.main}</div>
      {rows.others.length > 0 && (
        <>
          <div className="mb-1 mt-4 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">Autres événements</div>
          <div className="-mx-1 overflow-hidden rounded-2xl ring-1 ring-black/5 [&>*+*]:border-t [&>*+*]:border-black/5">{rows.others.map((e) => <EventRow key={e.id} ev={e} onClick={() => setEdit({ event: e })} />)}</div>
        </>
      )}
      <button onClick={() => setPicker(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#2f6fd1]/40 py-2.5 text-[15px] font-medium text-[#2f6fd1] hover:bg-[#2f6fd1]/5"><Plus size={16} />Ajouter un événement</button>
      {picker && <AddEventSheet hasPartner={families.length > 0} onClose={() => setPicker(false)} onPick={(t) => { setPicker(false); setEdit({ event: null, type: t, fromPicker: true }) }} />}
      {edit && <EventSheet personId={p.id} personName={p.display_name} event={edit.event} presetType={edit.type} presetFamilyId={edit.familyId} families={families}
        onClose={() => setEdit(null)} onSaved={reload} onBack={edit.fromPicker ? () => { setEdit(null); setPicker(true) } : undefined} />}
    </GroupCard>
  )
}

/* ---------------- Médias ---------------- */
export function MediaSection({ p, reload }: Props) {
  const { notify } = useApp()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const upload = async (files: FileList | null, kind: string) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      for (const f of Array.from(files)) await api.uploadMedia(f, { person_id: p.id, kind: kind === 'auto' ? (f.type.startsWith('image/') ? 'photo' : 'document') : kind, analyze: kind !== 'portrait' })
      notify('success', kind === 'portrait' ? 'Portrait défini.' : `${files.length} média(s) ajouté(s) ; l’analyse démarre.`)
      await reload()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  const archive = async () => {
    if (!url.trim()) return
    setBusy(true); setUrlMsg(null)
    try {
      const res = await api.archiveUrl(url.trim(), { person_id: p.id })
      setUrlMsg({ ok: true, text: `${res.length} document(s) archivé(s) dans l’application.` }); setUrl('')
      notify('success', 'Document archivé.'); await reload()
    } catch (e) { setUrlMsg({ ok: false, text: errMsg(e) }) } finally { setBusy(false) }
  }
  const del = async (m: MediaOut) => {
    if (!window.confirm(`Supprimer « ${m.title ?? m.original_filename ?? 'ce média'} » ? Le fichier sera effacé.`)) return
    try { await api.deleteMedia(m.id); notify('success', 'Média supprimé.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  const analyze = async (m: MediaOut) => { try { await api.analyzeMedia(m.id); notify('info', 'Analyse lancée.'); await reload() } catch (e) { notify('error', errMsg(e)) } }
  return (
    <GroupCard id="medias" title="Médias" tint="#3a9bf0" icon={<ImageIcon size={18} />} count={p.media.length}
      actions={<label className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[14px] font-medium text-[#2f6fd1] hover:bg-[#2f6fd1]/10">{busy ? <Spinner /> : <Upload size={15} />}Ajouter<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { upload(e.target.files, 'auto'); e.target.value = '' }} /></label>}>
      {p.media.length === 0 ? (
        <SoftEmpty title="Aucun média disponible">Ajoutez des photos, des actes scannés, des PDF ou archivez une page Internet.</SoftEmpty>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {p.media.map((m) => {
            const web = m.kind === 'webpage' || (m.mime_type ?? '').includes('html')
            const archived = typeof m.analysis?.archived_from === 'string'
            return (
              <div key={m.id} className="group relative overflow-hidden rounded-2xl bg-mist-100 ring-1 ring-black/5">
                <button className="block aspect-square w-full" onClick={() => nav(`/archives?media=${m.id}`)} title={m.title ?? m.original_filename ?? ''}>
                  {isImage(m.mime_type, m.original_filename) ? <img src={api.mediaFileUrl(m.id)} alt={m.title ?? ''} loading="lazy" className="h-full w-full object-cover" />
                    : <span className="flex h-full flex-col items-center justify-center gap-1 text-mist-400">{web ? <Globe size={30} strokeWidth={1.3} /> : <FileText size={30} strokeWidth={1.3} />}<span className="text-[10px] font-semibold uppercase">{web ? 'Page web' : (m.mime_type ?? '').includes('pdf') ? 'PDF' : 'Document'}</span></span>}
                </button>
                <div className="px-1.5 py-1">
                  <div className="truncate text-[11px] font-medium text-night-900">{web && archived ? 'Page web archivée' : m.kind === 'portrait' ? 'Portrait' : m.title ?? m.original_filename ?? 'Sans titre'}</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-mist-500">{ANALYSIS_STATUS_LABEL[m.analysis_status] ?? m.analysis_status}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {m.kind !== 'portrait' && m.analysis_status !== 'done' && <button className="rounded p-0.5 text-[#5b3fd6] hover:bg-[#ece6ff]" title="Analyser" onClick={() => analyze(m)}><Lightbulb size={12} /></button>}
                      <button className="rounded p-0.5 text-conf-red hover:bg-conf-red/10" title="Supprimer" onClick={() => del(m)}><Trash2 size={12} /></button>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="btn-ghost cursor-pointer !py-1.5 text-[13px]"><Upload size={14} />Ajouter un média<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { upload(e.target.files, 'auto'); e.target.value = '' }} /></label>
        <button className="btn-ghost !py-1.5 text-[13px]" onClick={() => setUrlOpen((v) => !v)}><Globe size={14} />Archiver depuis une adresse web</button>
        <label className="btn-ghost cursor-pointer !py-1.5 text-[13px]"><ImageIcon size={14} />Définir le portrait<input type="file" hidden accept="image/*" onChange={(e) => { upload(e.target.files, 'portrait'); e.target.value = '' }} /></label>
      </div>
      {urlOpen && (
        <div className="mt-3 space-y-2 rounded-2xl bg-mist-100 p-3">
          <p className="text-xs text-mist-500">Collez l’adresse d’un acte, d’une image, d’un PDF ou d’une page trouvée sur Internet : une copie est conservée dans l’application (si le site l’autorise).</p>
          <div className="flex gap-2">
            <input className="input" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') archive() }} />
            <button className="btn-primary shrink-0" disabled={busy || !url.trim()} onClick={archive}>{busy ? <Spinner /> : <Library size={15} />}Archiver</button>
          </div>
          {urlMsg && <p className={`text-sm ${urlMsg.ok ? 'text-sage-600' : 'text-conf-red'}`}>{urlMsg.text}</p>}
        </div>
      )}
    </GroupCard>
  )
}

/* ---------------- Famille ---------------- */
function RelationLine({ r, onDelete }: { r: RelationOut; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const crit = r.confidence_details.criteria ?? []
  return (
    <div className="mt-1 text-[11px] text-mist-500">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={`chip !px-1.5 !py-0 conf-${r.confidence}`}><ConfidenceDot level={r.confidence} />lien {RELATION_LABEL[r.relation_type] ?? r.relation_type}</span>
        <button className="underline" onClick={() => setOpen((v) => !v)}>{open ? 'masquer' : 'pourquoi ?'}</button>
        <button className="text-conf-red" onClick={onDelete} title="Supprimer le lien" aria-label="Supprimer le lien"><Trash2 size={11} /></button>
      </span>
      {open && (
        <div className="mt-1 rounded-lg bg-mist-100 p-2">
          {crit.length === 0 ? 'Aucun critère détaillé.' : <ul className="list-disc pl-4">{crit.map((c, i) => <li key={i}>{c}</li>)}</ul>}
          {typeof r.confidence_details.sources === 'number' && <div className="mt-1">Sources : {r.confidence_details.sources}</div>}
          {r.notes && <div className="mt-1 italic">{r.notes}</div>}
        </div>
      )}
    </div>
  )
}
function PersonCard({ person, extra, rel, onDeleteRel }: { person: PersonSummary; extra?: ReactNode; rel?: RelationOut; onDeleteRel?: (r: RelationOut) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[#f4f6fb] p-2.5">
      <Link to={`/personnes/${person.id}`} className="shrink-0"><Avatar p={person} size={42} /></Link>
      <div className="min-w-0 flex-1">
        <Link to={`/personnes/${person.id}`} className="block truncate text-[15px] font-medium text-night-900 hover:text-[#2f6fd1]">{person.display_name}</Link>
        <div className="text-xs text-mist-500">{person.birth_year ? `☆ ${person.birth_year}` : '☆ ?'}{person.death_year ? `  † ${person.death_year}` : person.is_living ? '  vivant' + fem(person) : ''}{person.age_display ? ` · ${person.age_display}` : ''}</div>
        {extra}
        {rel && onDeleteRel && <RelationLine r={rel} onDelete={() => onDeleteRel(rel)} />}
      </div>
      <ChevronRight size={16} className="mt-3 shrink-0 text-mist-300" />
    </div>
  )
}
function FamGroup({ title, count, actions, children }: { title: string; count: number; actions: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-mist-500">{title} <span className="font-normal">({count})</span></span>
        <span className="flex flex-wrap justify-end gap-1">{actions}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
const PlusChip = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} className="inline-flex items-center gap-0.5 rounded-full bg-[#2f6fd1]/10 px-2.5 py-1 text-[12px] font-medium text-[#2f6fd1] hover:bg-[#2f6fd1]/20"><Plus size={12} />{label}</button>
)

export function FamilySection({ p, reload, onAdd }: Props & { onAdd: (r: AddRequest) => void }) {
  const { notify } = useApp()
  const delRel = async (r: RelationOut) => {
    if (!window.confirm('Supprimer ce lien de parenté ? Les personnes sont conservées.')) return
    try { await api.deleteRelation(r.id); notify('success', 'Lien supprimé.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  const hasFather = p.parents.some((x) => x.sex === 'M')
  const hasMother = p.parents.some((x) => x.sex === 'F')
  const onlyPartner = p.spouses.length === 1 ? p.spouses[0] : undefined
  const childChoice = (kind: RelativeKind, label: string): AddRequest => (p.spouses.length > 1 ? 'menu' : { kind, label, group: 'enfants', otherParent: onlyPartner })
  const spouseKind: RelativeKind = p.sex === 'F' ? 'husband' : p.sex === 'M' ? 'wife' : 'spouse'
  const total = p.parents.length + p.spouses.length + p.children.length + p.siblings.length
  return (
    <GroupCard id="famille" title="Famille" tint="#34a853" icon={<Users size={18} />} count={total}>
      <div className="space-y-5">
        <FamGroup title="Parents" count={p.parents.length} actions={<>
          {!hasFather && <PlusChip label="Père" onClick={() => onAdd({ kind: 'father', label: 'Ajouter le père', group: 'parents' })} />}
          {!hasMother && <PlusChip label="Mère" onClick={() => onAdd({ kind: 'mother', label: 'Ajouter la mère', group: 'parents' })} />}
        </>}>
          {p.parents.length === 0 && <p className="px-1 text-sm text-mist-400">Parents inconnus. Ajoutez-les ou lancez « Retrouver ses parents ».</p>}
          {p.parents.map((x) => <PersonCard key={x.id} person={x} rel={p.parent_relations.find((r) => r.parent_id === x.id)} onDeleteRel={delRel} />)}
        </FamGroup>
        <FamGroup title="Partenaires" count={p.spouses.length} actions={<PlusChip label="Conjoint" onClick={() => onAdd({ kind: spouseKind, label: 'Ajouter un conjoint', group: 'couple' })} />}>
          {p.spouses.length === 0 && <p className="px-1 text-sm text-mist-400">Aucun conjoint enregistré.</p>}
          {p.families.map((f) => {
            const other = partnerOf(p, f)
            if (!other) return null
            const mar = f.events.filter((e) => MARRIAGE_TYPES.includes(e.event_type) || e.event_type === 'divorce')
            return <PersonCard key={f.id} person={other} extra={
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-mist-500">
                <ConfidenceChip level={f.confidence} />
                {mar.length === 0 ? <span>{f.union_type === 'marriage' ? 'Mariage (date inconnue)' : 'Union'}</span> : mar.map((e) => <span key={e.id}>{eventLabel(e.event_type)} {e.date_display || '?'}{e.place_name ? ` à ${e.place_name}` : ''}</span>)}
                {f.children_ids.length > 0 && <span>· {f.children_ids.length} enfant(s)</span>}
              </div>} />
          })}
          {p.spouses.filter((s) => !p.families.some((f) => f.partner1_id === s.id || f.partner2_id === s.id)).map((s) => <PersonCard key={s.id} person={s} />)}
        </FamGroup>
        <FamGroup title="Enfants" count={p.children.length} actions={<>
          <PlusChip label="Fils" onClick={() => onAdd(childChoice('son', 'Ajouter un fils'))} />
          <PlusChip label="Fille" onClick={() => onAdd(childChoice('daughter', 'Ajouter une fille'))} />
        </>}>
          {p.children.length === 0 && <p className="px-1 text-sm text-mist-400">Aucun enfant enregistré.</p>}
          {p.children.map((x) => <PersonCard key={x.id} person={x} rel={p.child_relations.find((r) => r.child_id === x.id)} onDeleteRel={delRel} />)}
        </FamGroup>
        <FamGroup title="Frères et sœurs" count={p.siblings.length} actions={<>
          <PlusChip label="Frère" onClick={() => onAdd({ kind: 'brother', label: 'Ajouter un frère', group: 'fratrie' })} />
          <PlusChip label="Sœur" onClick={() => onAdd({ kind: 'sister', label: 'Ajouter une sœur', group: 'fratrie' })} />
        </>}>
          {p.siblings.length === 0 && <p className="px-1 text-sm text-mist-400">Aucun frère ni sœur enregistré.</p>}
          {p.siblings.map((x) => <PersonCard key={x.id} person={x} />)}
        </FamGroup>
        <button onClick={() => onAdd('menu')} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#2f6fd1]/40 py-2.5 text-[15px] font-medium text-[#2f6fd1] hover:bg-[#2f6fd1]/5"><Plus size={16} />Ajouter des proches…</button>
      </div>
    </GroupCard>
  )
}

/* ---------------- Biographie ---------------- */
function CitationLine({ c }: { c: CitationOut }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ConfidenceDot level={c.confidence} />
      <Link className="font-medium text-night-900 hover:text-[#2f6fd1]" to={`/archives?source=${c.source_id}`}>{c.source_title ?? 'Source'}</Link>
      {c.source_reliability && <span className={`chip ${RELIABILITY_CLASS[c.source_reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[c.source_reliability] ?? c.source_reliability}</span>}
      {c.excerpt && <span className="italic text-mist-500">« {c.excerpt} »</span>}
    </span>
  )
}
function NarrativeBody({ p }: { p: PersonDetail }) {
  const [n, setN] = useState<Narrative | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setN(null); setErr(null); api.narrative(p.id).then(setN).catch((e: unknown) => setErr(errMsg(e))) }, [p.id])
  if (err) return <p className="text-sm text-conf-red">{err}</p>
  if (!n) return <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Rédaction…</div>
  return (
    <div className="space-y-3">
      {n.paragraphs.length === 0 && <SoftEmpty title="Pas encore de biographie">Il faut d’abord des faits documentés (naissance, mariage, décès…).</SoftEmpty>}
      {n.paragraphs.map((par, i) => (
        <div key={i} className="rounded-2xl bg-[#f4f6fb] p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-mist-500">{par.year !== null && <span className="text-base font-semibold text-night-900">{par.year}</span>}<ConfidenceChip level={par.confidence} /></div>
          <Markdown text={par.text} />
          {par.sources.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-mist-500">Sources ({par.sources.length})</summary><ul className="mt-1 space-y-1">{par.sources.map((c) => <li key={c.id}><CitationLine c={c} /></li>)}</ul></details>}
        </div>
      ))}
      {n.unsourced_count > 0 && <p className="flex items-center gap-1.5 text-xs text-conf-orange"><AlertTriangle size={13} />{n.unsourced_count} affirmation(s) sans source : à vérifier.</p>}
      {n.historical_context.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer text-mist-500">Contexte historique ({n.historical_context.length})</summary>
          <ul className="mt-2 space-y-1.5">{n.historical_context.map((h, i) => <li key={i} className="border-l-2 border-[#5b3fd6]/40 pl-3"><span className="font-semibold">{h.start}{h.end !== h.start ? `–${h.end}` : ''}</span> {h.label} <span className="text-xs text-mist-500">({h.region})</span></li>)}</ul>
          <p className="mt-2 text-xs text-mist-500">Repères indicatifs, ce ne sont pas des preuves.</p>
        </details>
      )}
    </div>
  )
}
export function NarrativeSection({ p }: { p: PersonDetail }) {
  const [opened, setOpened] = useState(false)
  return (
    <GroupCard title="Biographie" tint="#f29d38" icon={<BookOpen size={18} />} defaultOpen={false}>
      {opened ? <NarrativeBody p={p} /> : <button className="btn-ghost w-full justify-center" onClick={() => setOpened(true)}>Rédiger la biographie à partir des faits sourcés</button>}
    </GroupCard>
  )
}

/* ---------------- Lieux ---------------- */
export function PlacesSection({ p }: { p: PersonDetail }) {
  const places = useMemo(() => {
    const m = new Map<string, EventOut[]>()
    ;[...p.events, ...p.families.flatMap((f) => f.events)].forEach((e) => { const n = e.place_name ?? e.place_original; if (n) m.set(n, [...(m.get(n) ?? []), e]) })
    return [...m.entries()].sort((a, b) => ((a[1][0]?.sort_year ?? 9999) - (b[1][0]?.sort_year ?? 9999)))
  }, [p])
  return (
    <GroupCard title="Lieux de vie" tint="#e2574c" icon={<MapPin size={18} />} count={places.length} defaultOpen={false} actions={<Link className="text-[14px] font-medium text-[#2f6fd1]" to="/carte">Carte</Link>}>
      {places.length === 0 ? <SoftEmpty title="Aucun lieu connu">Ajoutez des événements avec un lieu.</SoftEmpty> : (
        <ul className="space-y-2">
          {places.map(([name, evs]) => (
            <li key={name} className="rounded-2xl bg-[#f4f6fb] p-3">
              <div className="flex items-center gap-1.5 font-medium text-night-900"><MapPin size={14} className="text-[#e2574c]" />{name}</div>
              <div className="mt-0.5 text-xs text-mist-500">{evs.map((e) => `${eventLabel(e.event_type)}${e.date_display ? ` (${e.date_display})` : ''}`).join(' · ')}</div>
            </li>
          ))}
        </ul>
      )}
    </GroupCard>
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
    <GroupCard id="sources" title="Sources" tint="#8e8e93" icon={<FileText size={18} />} count={p.citations.length} defaultOpen={p.citations.length > 0}
      actions={<LinkButton onClick={() => setOpen(true)}><Link2 size={14} />Lier</LinkButton>}>
      {p.citations.length === 0 ? <SoftEmpty title="Aucune source">Les actes trouvés par la recherche IA apparaîtront ici.</SoftEmpty> : (
        <ul className="divide-y divide-black/5">
          {p.citations.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link className="font-medium text-night-900 hover:text-[#2f6fd1]" to={`/archives?source=${c.source_id}`}>{c.source_title ?? 'Source'}</Link>
                  {c.source_reliability && <span className={`chip ${RELIABILITY_CLASS[c.source_reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[c.source_reliability] ?? c.source_reliability}</span>}
                  <ConfidenceChip level={c.confidence} />
                  {c.target_type !== 'person' && <span className="text-xs text-mist-500">(cite : {c.target_type === 'event' ? 'un événement' : c.target_type === 'relation' ? 'un lien' : c.target_type})</span>}
                </div>
                {c.excerpt && <p className="mt-1 italic text-night-900/80">« {c.excerpt} »</p>}
                {c.note && <p className="text-xs text-mist-500">{c.note}</p>}
              </div>
              <button className="rounded-full p-1.5 text-mist-400 hover:bg-black/5" title="Retirer" onClick={() => del(c)}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {open && <LinkSourceModal targetType="person" targetId={p.id} onClose={() => setOpen(false)} onDone={reload} />}
    </GroupCard>
  )
}

/* ---------------- Hypothèses ---------------- */
const HYP_STATUS: Record<string, string> = { open: 'À examiner', confirmed: 'Confirmée', rejected: 'Rejetée', superseded: 'Remplacée' }
export function HypothesesSection({ p, reload }: Props) {
  const { notify } = useApp()
  const open = p.hypotheses.filter((h) => h.status === 'open').length
  const set = async (id: string, status: string) => { try { await api.setHypothesisStatus(id, status); notify('success', `Piste ${HYP_STATUS[status]?.toLowerCase() ?? status}.`); await reload() } catch (e) { notify('error', errMsg(e)) } }
  return (
    <GroupCard id="pistes" title="Pistes trouvées par l’IA" tint="#5b3fd6" icon={<Lightbulb size={18} />} count={p.hypotheses.length} defaultOpen={open > 0}>
      {p.hypotheses.length === 0 ? <SoftEmpty title="Aucune piste pour l’instant">Lancez une recherche IA : les pistes trouvées apparaîtront ici.</SoftEmpty> : (
        <>
          <p className="mb-2 rounded-xl bg-[#ece6ff] p-2.5 text-xs text-[#3f2aa8]">Confirmer une piste n’ajoute rien automatiquement : vérifiez le document puis saisissez le fait ou le lien.</p>
          <ul className="space-y-2">
            {p.hypotheses.map((h) => (
              <li key={h.id} className="rounded-2xl bg-[#f4f6fb] p-3">
                <div className="font-medium text-night-900">{h.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-mist-500">
                  <span className={`chip ${h.status === 'confirmed' ? 'conf-green' : h.status === 'rejected' ? 'conf-red' : 'conf-orange'}`}>{HYP_STATUS[h.status] ?? h.status}</span>
                  {h.score !== null && <span>score {Math.round(h.score)}/100</span>}<span>· {formatDate(h.created_at)}</span>
                </div>
                {h.description && <p className="mt-1.5 text-sm text-mist-500">{h.description}</p>}
                {Array.isArray(h.score_details.criteria) && (
                  <details className="mt-1 text-xs"><summary className="cursor-pointer text-mist-500">Critères du score</summary>
                    <ul className="mt-1 list-disc pl-4 text-mist-500">{(h.score_details.criteria as unknown[]).map((c, i) => <li key={i}>{typeof c === 'string' ? c : JSON.stringify(c)}</li>)}</ul>
                  </details>
                )}
                {h.status === 'open' && <div className="mt-2 flex gap-2"><button className="btn-sage !py-1.5" onClick={() => set(h.id, 'confirmed')}><Check size={14} />Confirmer</button><button className="btn-ghost !py-1.5" onClick={() => set(h.id, 'rejected')}><X size={14} />Rejeter</button></div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </GroupCard>
  )
}

/* ---------------- Contradictions ---------------- */
export function ContradictionsSection({ p, reload }: Props) {
  const { notify } = useApp()
  const open = p.contradictions.filter((c) => c.status === 'open').length
  const set = async (id: string, status: string) => { try { await api.setContradictionStatus(id, status); notify('success', 'Statut mis à jour.'); await reload() } catch (e) { notify('error', errMsg(e)) } }
  if (p.contradictions.length === 0) return null
  return (
    <GroupCard title="Contradictions" tint="#d9932c" icon={<GitCompare size={18} />} count={open} defaultOpen={open > 0}>
      <ul className="space-y-2">
        {p.contradictions.map((c) => (
          <li key={c.id} className="rounded-2xl bg-[#f4f6fb] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className={`chip conf-${c.severity}`}><ConfidenceDot level={c.severity} />{c.severity === 'red' ? 'Bloquante' : 'À vérifier'}</span><span className="text-xs text-mist-500">{c.status === 'open' ? 'ouverte' : c.status === 'resolved' ? 'résolue' : c.status === 'ignored' ? 'ignorée' : c.status}</span></div>
            <p className="mt-1">{c.description}</p>
            {c.resolution_note && <p className="text-xs text-mist-500">{c.resolution_note}</p>}
            {c.status === 'open' && <div className="mt-2 flex gap-2"><button className="btn-sage !py-1.5" onClick={() => set(c.id, 'resolved')}>Résolue</button><button className="btn-ghost !py-1.5" onClick={() => set(c.id, 'ignored')}>Ignorer</button></div>}
          </li>
        ))}
      </ul>
    </GroupCard>
  )
}

/* ---------------- Questions ---------------- */
export function QuestionsSection({ p }: { p: PersonDetail }) {
  const pending = p.questions.filter((q) => q.status === 'pending')
  if (p.questions.length === 0) return null
  return (
    <GroupCard title="Questions de l’IA" tint="#5b3fd6" icon={<HelpCircle size={18} />} count={pending.length} defaultOpen={pending.length > 0} actions={<Link className="text-[14px] font-medium text-[#2f6fd1]" to="/questions">Répondre</Link>}>
      <ul className="space-y-2">
        {p.questions.map((qq) => (
          <li key={qq.id} className="rounded-2xl bg-[#f4f6fb] p-3 text-sm">
            <div className="font-medium text-night-900">{qq.title}</div>
            <div className="text-xs text-mist-500">{qq.status === 'pending' ? 'En attente de votre réponse' : 'Répondue'}</div>
            {qq.problem && <p className="mt-1 text-xs text-mist-500">{qq.problem}</p>}
          </li>
        ))}
      </ul>
    </GroupCard>
  )
}

/* ---------------- Historique des recherches ---------------- */
export function HistorySection({ p }: { p: PersonDetail }) {
  const [logs, setLogs] = useState<LogOut[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  useEffect(() => { if (!opened) return; setLogs(null); api.logs({ person_id: p.id, limit: 40 }).then(setLogs).catch((e: unknown) => setErr(errMsg(e))) }, [opened, p.id, p.updated_at])
  const done = Object.keys(p.research_status ?? {})
  return (
    <GroupCard title="Historique des recherches" tint="#636366" icon={<History size={18} />} defaultOpen={false}>
      {done.length > 0 && <p className="mb-2 text-xs text-mist-500">Déjà cherché : {done.join(', ')}</p>}
      {!opened ? <button className="btn-ghost w-full justify-center" onClick={() => setOpened(true)}>Afficher le journal</button>
        : err ? <p className="text-sm text-conf-red">{err}</p>
        : logs === null ? <Spinner />
        : logs.length === 0 ? <SoftEmpty title="Aucune recherche enregistrée" />
        : (
          <ul className="space-y-1.5 text-sm">
            {logs.map((l) => <li key={l.id} className="flex gap-2"><span className="shrink-0 text-xs tabular-nums text-mist-400">{formatDate(l.ts)}</span><span className={l.level === 'error' ? 'text-conf-red' : 'text-night-900'}>{l.message}</span></li>)}
          </ul>
        )}
      <Link to="/enquetes" className="mt-2 inline-block text-[14px] font-medium text-[#2f6fd1]">Toutes les enquêtes →</Link>
    </GroupCard>
  )
}
