import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Baby, Camera, Cross, FileText, Flower2, Heart, ListChecks, Medal, Search, Users, WandSparkles, X } from 'lucide-react'
import { api, type PersonSummary } from '../../api'
import { Spinner } from '../ui'

export const KIND_META: { id: string; label: string; short: string; icon: LucideIcon; hint: string }[] = [
  { id: 'auto', label: 'Détection automatique', short: 'Automatique', icon: WandSparkles, hint: 'L’IA reconnaît le type de document' },
  { id: 'birth', label: 'Acte de naissance / baptême', short: 'Naissance', icon: Baby, hint: 'Naissance, baptême' },
  { id: 'marriage', label: 'Acte de mariage', short: 'Mariage', icon: Heart, hint: 'Mariage civil ou religieux' },
  { id: 'death', label: 'Acte de décès / sépulture', short: 'Décès', icon: Cross, hint: 'Décès, inhumation' },
  { id: 'census', label: 'Table de recensement', short: 'Recensement', icon: Users, hint: 'Liste des habitants par maison' },
  { id: 'military_register', label: 'Registre matricule militaire', short: 'Matricule', icon: Medal, hint: 'Fiche du soldat' },
  { id: 'decennial_table', label: 'Table décennale', short: 'Table décennale', icon: ListChecks, hint: 'Index sur dix ans' },
  { id: 'death_notice', label: 'Faire-part / avis de décès', short: 'Faire-part', icon: Flower2, hint: 'Avis de décès, faire-part' },
  { id: 'family_photo', label: 'Photo de famille', short: 'Photo', icon: Camera, hint: 'Portrait, photo de groupe' },
  { id: 'other', label: 'Autre document', short: 'Autre', icon: FileText, hint: 'Lettre, livret, contrat…' },
]
export const DOC_LABEL: Record<string, string> = {
  birth: 'Acte de naissance', baptism: 'Acte de baptême', marriage: 'Acte de mariage', death: 'Acte de décès', burial: 'Acte de sépulture',
  census: 'Recensement', military_register: 'Registre matricule', decennial_table: 'Table décennale', death_notice: 'Faire-part de décès',
  family_photo: 'Photo de famille', other: 'Document',
}
export const kindIcon = (docType: string | undefined): LucideIcon => {
  const map: Record<string, string> = { baptism: 'birth', burial: 'death' }
  return KIND_META.find((k) => k.id === (map[docType ?? ''] ?? docType))?.icon ?? FileText
}
export const LANG_LABEL: Record<string, string> = { fr: 'français', la: 'latin', de: 'allemand', it: 'italien', pl: 'polonais', en: 'anglais', ru: 'russe', es: 'espagnol', nl: 'néerlandais' }

/** Transcription avec les mots incertains [?mot] surlignés. */
export function HighlightedText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(/(\[\?[^\]]*\])/g), [text])
  return (
    <p className={`whitespace-pre-wrap font-display text-[15px] leading-relaxed text-night-900 ${className}`}>
      {parts.map((part, i) => {
        const m = /^\[\?([^\]]*)\]$/.exec(part)
        return m
          ? <mark key={i} className="rounded bg-conf-orange/30 px-0.5 text-night-900 underline decoration-conf-orange decoration-dotted underline-offset-2" title="Mot incertain : vérifiez sur l’image">{m[1] || '?'}</mark>
          : <span key={i}>{part}</span>
      })}
    </p>
  )
}

/** Recherche d'une personne de l'arbre (champ + liste de résultats tactile). */
export function PersonSearch({ value, onChange, placeholder = 'Rechercher une personne de l’arbre…', exclude = [] }: {
  value: PersonSummary | null; onChange: (p: PersonSummary | null) => void; placeholder?: string; exclude?: string[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<PersonSummary[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const t = setTimeout(() => {
      api.persons(query.trim() || undefined, 30).then((r) => setResults(r.filter((p) => !exclude.includes(p.id)))).catch(() => setResults([])).finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [query, open, exclude])
  if (value && !open) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-xl border border-ivory-300 bg-white px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[15px] text-night-900">{value.display_name} <span className="text-xs text-mist-500">{lifespan(value)}</span></span>
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setOpen(true)}>Changer</button>
        <button type="button" aria-label="Retirer" className="btn-ghost !p-1.5" onClick={() => onChange(null)}><X size={15} /></button>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
        <input className="input !min-h-11 !pl-9" value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true) }} />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-ivory-300 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-ivory-200 px-3 py-1.5 text-xs text-mist-500">
            <span>{loading ? 'Recherche…' : `${results.length} personne(s)`}</span>
            <button type="button" className="cursor-pointer px-1 py-1 text-ios-blue" onClick={() => setOpen(false)}>Fermer</button>
          </div>
          {loading && <div className="p-3"><Spinner /></div>}
          {!loading && results.map((p) => (
            <button key={p.id} type="button" onClick={() => { onChange(p); setOpen(false); setQuery('') }}
              className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[15px] hover:bg-ivory-100">
              <span className="truncate">{p.display_name}</span><span className="shrink-0 text-xs text-mist-500">{lifespan(p)}</span>
            </button>
          ))}
          {!loading && results.length === 0 && <div className="p-3 text-sm text-mist-500">Aucune personne trouvée.</div>}
        </div>
      )}
    </div>
  )
}

export function lifespan(p: { birth_year: number | null; death_year: number | null }): string {
  if (!p.birth_year && !p.death_year) return ''
  return `${p.birth_year ?? '?'}–${p.death_year ?? ''}`
}

export function Callout({ tone = 'ai', icon: Icon, children }: { tone?: 'ai' | 'warn' | 'info'; icon: LucideIcon; children: ReactNode }) {
  const cls = tone === 'ai' ? 'border-gold-500/30 bg-gold-500/8 text-night-900' : tone === 'warn' ? 'border-conf-orange/40 bg-conf-orange/10 text-night-900' : 'border-ios-blue/25 bg-ios-blue/5 text-night-900'
  const ic = tone === 'ai' ? 'text-gold-600' : tone === 'warn' ? 'text-conf-orange' : 'text-ios-blue'
  return <div className={`flex items-start gap-2.5 rounded-2xl border p-3 text-[13.5px] leading-snug ${cls}`}><Icon size={17} className={`mt-0.5 shrink-0 ${ic}`} /><div className="min-w-0">{children}</div></div>
}

export function Stepper({ step }: { step: number }) {
  const steps = ['Document', 'Lecture', 'Ce qu’il dit', 'Ajouts']
  return (
    <ol className="flex items-center gap-1.5" aria-label="Étapes">
      {steps.map((s, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1" aria-current={state === 'current' ? 'step' : undefined}>
            <div className={`h-1.5 w-full rounded-full ${state === 'todo' ? 'bg-mist-200' : state === 'done' ? 'bg-ios-blue' : 'bg-gold-500'}`} />
            <span className={`truncate text-[11px] ${state === 'current' ? 'font-semibold text-night-900' : 'text-mist-500'}`}>{n}. {s}</span>
          </li>
        )
      })}
    </ol>
  )
}
