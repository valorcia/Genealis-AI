import { useState } from 'react'
import { AlertTriangle, Briefcase, Cake, Eye, FileText, Home, Languages, MapPin, RefreshCw, ScanText, Sparkles, UserRound } from 'lucide-react'
import { api, type MediaOut } from '../../api'
import { extractionOf, transcriptionOf, type ExtractedPerson, type Extraction, type HouseholdMember } from '../../lib/interpretApi'
import { isImage } from '../person/helpers'
import { Callout, DOC_LABEL, HighlightedText, KIND_META, LANG_LABEL, kindIcon } from './shared'
import { ZoomViewer } from './ZoomViewer'

const ROLE_FR: Record<string, string> = {
  subject: 'personne principale', father: 'père', mother: 'mère', spouse: 'conjoint(e)', spouse_father: 'père du conjoint',
  spouse_mother: 'mère du conjoint', witness: 'témoin', declarant: 'déclarant', godfather: 'parrain', godmother: 'marraine',
  deceased: 'défunt(e)', head_of_household: 'chef de ménage', household_member: 'membre du ménage', other: 'autre',
}
function roleLabel(p: ExtractedPerson, doc: string | undefined): string {
  const r = p.role ?? 'other'
  if (doc === 'marriage') {
    const m: Record<string, string> = { subject: 'époux', spouse: 'épouse', father: 'père de l’époux', mother: 'mère de l’époux', spouse_father: 'père de l’épouse', spouse_mother: 'mère de l’épouse' }
    if (m[r]) return m[r]
  }
  if (r === 'subject') return ({ birth: 'enfant', baptism: 'baptisé(e)', military_register: 'conscrit', death: 'défunt(e)', burial: 'défunt(e)' } as Record<string, string>)[doc ?? ''] ?? 'personne principale'
  return ROLE_FR[r] ?? r
}
const ROLE_TINT: Record<string, string> = { subject: '#5b3fd6', deceased: '#52607d', spouse: '#d6456b', father: '#2f6fd1', mother: '#2f6fd1', spouse_father: '#2f6fd1', spouse_mother: '#2f6fd1', witness: '#697282', declarant: '#697282', godfather: '#2e9a52', godmother: '#2e9a52' }
const confChip = (c?: string) => c === 'high' ? <span className="chip conf-green">lecture sûre</span> : c === 'low' ? <span className="chip conf-red">lecture incertaine</span> : c === 'medium' ? <span className="chip conf-orange">à vérifier</span> : null
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** « 1956-04-12 » → « 12 avril 1956 » (null si la date n'est pas au format ISO). */
function frDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(iso ?? '')
  if (!m) return null
  const [, y, mo, d] = m
  return [d ? String(Number(d)) : null, mo ? MONTHS[Number(mo) - 1] : null, y].filter(Boolean).join(' ')
}
const full = (p: { given_names?: string | null; surname?: string | null }) => [p.given_names, p.surname?.toUpperCase()].filter(Boolean).join(' ') || '(nom illisible)'

function PersonCard({ p, doc }: { p: ExtractedPerson; doc: string | undefined }) {
  const tint = ROLE_TINT[p.role ?? ''] ?? '#697282'
  const facts: { icon: typeof Cake; text: string }[] = []
  if (p.age !== null && p.age !== undefined) facts.push({ icon: Cake, text: `${p.age} ans` })
  if (p.birth_date || p.birth_place) facts.push({ icon: Cake, text: `né(e) ${[p.birth_date, p.birth_place && `à ${p.birth_place}`].filter(Boolean).join(' ')}` })
  if (p.occupation) facts.push({ icon: Briefcase, text: p.occupation })
  if (p.residence) facts.push({ icon: Home, text: `domicile : ${p.residence}` })
  return (
    <div className="rounded-2xl border border-ivory-200 bg-white p-3 shadow-[0_1px_2px_rgba(28,35,51,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white" style={{ background: tint }}>{roleLabel(p, doc)}</span>
        {confChip(p.confidence)}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[16px] font-semibold text-night-900"><UserRound size={16} className="text-mist-400" />{full(p)}{p.deceased && <span className="text-xs font-normal text-mist-500">(décédé·e)</span>}</div>
      {p.relation && <div className="text-[13px] text-mist-500">{p.relation}</div>}
      {facts.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[13.5px] text-night-800">{facts.map((f, i) => <li key={i} className="flex items-start gap-1.5"><f.icon size={14} className="mt-0.5 shrink-0 text-mist-400" />{f.text}</li>)}</ul>}
    </div>
  )
}

function HouseholdTable({ h, i }: { h: { address?: string | null; number?: string | null; members?: HouseholdMember[] }; i: number }) {
  const ms = h.members ?? []
  return (
    <div className="rounded-2xl border border-ivory-200 bg-white">
      <div className="flex items-center gap-2 border-b border-ivory-200 px-3 py-2 text-[14px] font-semibold text-night-900"><Home size={15} className="text-ios-blue" />Ménage {h.number ?? i + 1}{h.address ? ` — ${h.address}` : ''}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead className="bg-ivory-100 text-[11px] uppercase tracking-wide text-mist-500"><tr>{['Nom', 'Prénoms', 'Lien', 'Âge', 'Né(e)', 'Lieu de naissance', 'Nationalité', 'Profession'].map((c) => <th key={c} className="px-2 py-1.5 font-semibold">{c}</th>)}</tr></thead>
          <tbody>{ms.map((m, j) => (
            <tr key={j} className="border-t border-ivory-200">
              <td className="px-2 py-1.5 font-medium">{m.surname ?? ''}</td><td className="px-2 py-1.5">{m.given_names ?? ''}</td>
              <td className="px-2 py-1.5"><span className="chip conf-grey">{m.relation_to_head ?? '?'}</span></td><td className="px-2 py-1.5">{m.age ?? ''}</td>
              <td className="px-2 py-1.5">{m.birth_year ?? ''}</td><td className="px-2 py-1.5">{m.birth_place ?? ''}</td><td className="px-2 py-1.5">{m.nationality ?? ''}</td><td className="px-2 py-1.5">{m.occupation ?? ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function Facts({ ex }: { ex: Extraction }) {
  const items = [
    ex.date && { icon: Cake, label: 'Date', value: ex.date },
    ex.event_date && { icon: Cake, label: 'Date de l’événement', value: ex.event_date },
    ex.place && { icon: MapPin, label: 'Lieu', value: ex.place },
    ex.act_number && { icon: FileText, label: 'N° d’acte', value: ex.act_number },
    ex.officer && { icon: UserRound, label: 'Rédigé par', value: ex.officer },
    ex.language && { icon: Languages, label: 'Langue', value: LANG_LABEL[ex.language] ?? ex.language },
  ].filter(Boolean) as { icon: typeof Cake; label: string; value: string }[]
  if (!items.length) return null
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-start gap-2 rounded-xl bg-ivory-100 px-3 py-2">
          <it.icon size={15} className="mt-0.5 shrink-0 text-mist-400" />
          <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-mist-500">{it.label}</dt><dd className="text-[14px] text-night-900"><HighlightedText text={it.value} className="!font-sans !text-[14px]" /></dd></div>
        </div>
      ))}
    </dl>
  )
}

/** Étape 3 : l'image et ce que l'IA y a lu, côte à côte. */
export function ReadingView({ media, onContinue, onReread, busy }: { media: MediaOut; onContinue: () => void; onReread: (kind: string) => void; busy: boolean }) {
  const ex = extractionOf(media)
  const text = transcriptionOf(media)
  const [view, setView] = useState<'both' | 'image' | 'text'>('both')
  const [rekind, setRekind] = useState(false)
  const doc = ex.document_type
  const DocIcon = kindIcon(doc)
  const persons = ex.persons ?? []
  const households = ex.households ?? []
  const entries = ex.entries ?? []
  const mil = ex.military
  const warnings = Array.isArray(media.analysis.warnings) ? (media.analysis.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : []
  const uncertain = (text.match(/\[\?[^\]]*\]/g) ?? []).length
  const pdf = (media.mime_type ?? '').includes('pdf') || (media.original_filename ?? '').toLowerCase().endsWith('.pdf')
  const image = isImage(media.mime_type, media.original_filename)

  return (
    <div className="space-y-4">
      <section className="panel fade-up p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-500/12 text-gold-600"><DocIcon size={22} /></span>
            <div className="min-w-0">
              <h2 className="font-display text-[19px] leading-tight text-night-900">3. Ce que dit le document</h2>
              <p className="text-[13.5px] text-mist-500">{[DOC_LABEL[doc ?? 'other'] ?? 'Document', ex.place?.split(',')[0], frDate(ex.date_iso) ?? ex.date].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost !py-1.5 text-[13px]" onClick={() => setRekind((v) => !v)} disabled={busy}><RefreshCw size={14} /> Relire</button>
        </div>
        {rekind && (
          <div className="mt-3 rounded-2xl bg-ivory-100 p-3">
            <p className="mb-2 text-[13px] text-night-900">Ce n’est pas le bon type ? Choisissez-le, l’IA relira le document :</p>
            <div className="flex flex-wrap gap-1.5">{KIND_META.map((k) => <button key={k.id} type="button" className="chip cursor-pointer border border-ivory-300 bg-white !py-1.5 text-[13px] hover:bg-ivory-200" onClick={() => { setRekind(false); onReread(k.id) }}><k.icon size={14} />{k.short}</button>)}</div>
          </div>
        )}
        {ex.summary_fr && <p className="mt-3 flex items-start gap-2 rounded-2xl bg-gold-500/8 p-3 text-[14.5px] text-night-900"><Sparkles size={16} className="mt-0.5 shrink-0 text-gold-600" />{ex.summary_fr}</p>}
        <div className="mt-3"><Callout tone="warn" icon={Eye}>Une lecture par l’IA peut se tromper : comparez avec l’image, surtout les noms et les dates{uncertain ? ` — ${uncertain} mot(s) incertain(s) surligné(s) en orange` : ''}.</Callout></div>
      </section>

      <div className="flex gap-1 rounded-xl bg-ivory-200/70 p-1 lg:hidden" role="tablist" aria-label="Affichage">
        {([['both', 'Les deux'], ['image', 'Image'], ['text', 'Texte']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`min-h-9 flex-1 cursor-pointer rounded-lg text-[14px] ${view === k ? 'bg-white font-medium text-night-900 shadow-sm' : 'text-mist-500'}`}>{l}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${view === 'text' ? 'hidden lg:block' : ''} min-w-0 lg:sticky lg:top-2 lg:self-start`}>
          {image || pdf ? <ZoomViewer src={api.mediaFileUrl(media.id)} alt={media.title ?? 'Document'} isPdf={pdf} className={view === 'image' ? 'h-[70vh]' : 'h-[42vh] lg:h-[75vh]'} />
            : <div className="flex h-40 items-center justify-center rounded-2xl border border-ivory-300 bg-ivory-100 text-mist-500"><FileText size={36} /></div>}
        </div>
        <div className={`${view === 'image' ? 'hidden lg:block' : ''} min-w-0 space-y-4`}>
          <section className="panel p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-night-900"><ScanText size={16} className="text-gold-600" />Transcription</h3>
            {text ? <div className="max-h-[50vh] overflow-auto scrollbar-thin rounded-xl bg-ivory-100 p-3"><HighlightedText text={text} /></div> : <p className="text-sm text-mist-500">Pas de transcription.</p>}
            {ex.translation_fr && (
              <details className="mt-3" open>
                <summary className="cursor-pointer text-[14px] font-medium text-night-900"><Languages size={14} className="mr-1 inline" />Traduction en français</summary>
                <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-ios-blue/5 p-3 text-[14.5px] leading-relaxed">{ex.translation_fr}</p>
              </details>
            )}
          </section>
          <section className="panel p-4">
            <h3 className="mb-2.5 text-[15px] font-semibold text-night-900">Qui est qui</h3>
            <Facts ex={ex} />
            {persons.length > 0 && <div className="mt-3 grid gap-2.5 sm:grid-cols-2">{persons.map((p, i) => <PersonCard key={i} p={p} doc={doc} />)}</div>}
            {households.length > 0 && <div className="mt-3 space-y-3">{households.map((h, i) => <HouseholdTable key={i} h={h} i={i} />)}</div>}
            {entries.length > 0 && (
              <ul className="mt-3 divide-y divide-ivory-200 rounded-2xl border border-ivory-200 bg-white text-[14px]">
                {entries.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="font-medium">{full(e)}{e.spouse ? ` × ${e.spouse}` : ''}</span><span className="text-mist-500">{({ birth: 'naissance', marriage: 'mariage', death: 'décès' } as Record<string, string>)[e.event_type ?? ''] ?? e.event_type} · {e.date ?? '?'}</span></li>)}
              </ul>
            )}
            {mil && (mil.matricule || mil.class_year) && (
              <div className="mt-3 rounded-2xl border border-ivory-200 bg-white p-3 text-[14px]">
                <div className="font-semibold text-night-900">Registre matricule {mil.matricule ? `n° ${mil.matricule}` : ''}{mil.class_year ? ` · classe ${mil.class_year}` : ''}</div>
                {mil.recruitment_office && <div className="text-mist-500">Bureau de recrutement : {mil.recruitment_office}</div>}
                {mil.physical_description && <div className="mt-1">Signalement : {Object.entries(mil.physical_description).filter(([, v]) => v).map(([k, v]) => `${({ height: 'taille', hair: 'cheveux', eyes: 'yeux', face: 'visage', marks: 'signes' } as Record<string, string>)[k] ?? k} ${v}`).join(', ')}</div>}
                {mil.campaigns && mil.campaigns.length > 0 && <div className="mt-1">Campagnes : {mil.campaigns.join(', ')}</div>}
              </div>
            )}
            {persons.length + households.length + entries.length === 0 && <p className="mt-2 text-sm text-mist-500">Aucune personne repérée. Vous pouvez relire le document en précisant son type.</p>}
          </section>
          {warnings.length > 0 && <ul className="space-y-1 text-xs text-conf-orange">{warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>}
        </div>
      </div>

      <div className="sticky bottom-2 z-20 rounded-2xl bg-white/85 p-2 shadow-[0_-6px_24px_-12px_rgba(28,35,51,0.35)] backdrop-blur">
        <button type="button" className="btn-primary w-full !min-h-13 !rounded-2xl !text-[17px]" onClick={onContinue} disabled={busy || persons.length + households.length + entries.length === 0}>
          Voir ce que je propose d’ajouter
        </button>
      </div>
    </div>
  )
}
