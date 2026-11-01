import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Baby, Heart, Search, Sparkles, UserPlus, Users, X } from 'lucide-react'
import { api, ApiError, type PersonDetail, type PersonIn, type PersonSummary, type RelativeKind } from '../../api'
import { useApp } from '../../store'
import { pulseEngine } from '../../store'

/** Personne minimale nécessaire pour proposer l'ajout de proches. */
export interface RelativeAnchor { id: string; display_name: string; sex: 'M' | 'F' | null; surname?: string | null }

interface Choice { kind: RelativeKind; label: string; otherParent?: PersonSummary; group: 'parents' | 'fratrie' | 'enfants' | 'couple' | 'grands-parents' }

export const RELATIVE_TITLE: Record<RelativeKind, string> = {
  father: 'le père', mother: 'la mère', son: 'un fils', daughter: 'une fille', child: 'un enfant', brother: 'un frère', sister: 'une sœur',
  sibling: 'un frère ou une sœur', spouse: 'un conjoint', husband: 'un époux', wife: 'une épouse',
  paternal_grandfather: 'le grand-père paternel', paternal_grandmother: 'la grand-mère paternelle',
  maternal_grandfather: 'le grand-père maternel', maternal_grandmother: 'la grand-mère maternelle',
}

/** Liste des proches qu'on peut ajouter, comme le menu « Ajouter des proches… » de MacFamilyTree. */
export function relativeChoices(anchor: RelativeAnchor, partners: PersonSummary[] = [], hasFather = false, hasMother = false): Choice[] {
  const out: Choice[] = []
  if (!hasFather) out.push({ kind: 'father', label: 'Ajouter le père', group: 'parents' })
  if (!hasMother) out.push({ kind: 'mother', label: 'Ajouter la mère', group: 'parents' })
  out.push({ kind: 'paternal_grandfather', label: 'Grand-père paternel', group: 'grands-parents' })
  out.push({ kind: 'paternal_grandmother', label: 'Grand-mère paternelle', group: 'grands-parents' })
  out.push({ kind: 'maternal_grandfather', label: 'Grand-père maternel', group: 'grands-parents' })
  out.push({ kind: 'maternal_grandmother', label: 'Grand-mère maternelle', group: 'grands-parents' })
  out.push({ kind: 'brother', label: 'Ajouter un frère', group: 'fratrie' })
  out.push({ kind: 'sister', label: 'Ajouter une sœur', group: 'fratrie' })
  for (const p of partners) {
    out.push({ kind: 'son', label: `Ajouter un fils avec ${p.display_name}`, otherParent: p, group: 'enfants' })
    out.push({ kind: 'daughter', label: `Ajouter une fille avec ${p.display_name}`, otherParent: p, group: 'enfants' })
  }
  if (partners.length === 0) {
    out.push({ kind: 'son', label: 'Ajouter un fils', group: 'enfants' })
    out.push({ kind: 'daughter', label: 'Ajouter une fille', group: 'enfants' })
  }
  out.push({ kind: anchor.sex === 'F' ? 'husband' : anchor.sex === 'M' ? 'wife' : 'spouse', label: anchor.sex === 'F' ? 'Ajouter un époux' : anchor.sex === 'M' ? 'Ajouter une épouse' : 'Ajouter un conjoint', group: 'couple' })
  return out
}

const GROUP_LABEL: Record<Choice['group'], string> = { parents: 'Parents', 'grands-parents': 'Grands-parents', fratrie: 'Frères et sœurs', enfants: 'Enfants', couple: 'Couple' }
const GROUP_ICON: Record<Choice['group'], ReactNode> = { parents: <Users size={15} />, 'grands-parents': <Users size={15} />, fratrie: <Users size={15} />, enfants: <Baby size={15} />, couple: <Heart size={15} /> }

/**
 * Menu « Ajouter des proches… » : affiche les choix puis un formulaire court.
 * Charge lui-même les parents et conjoints de la personne pour proposer les bons choix.
 */
export function AddRelativeMenu({ anchor, onClose, onAdded }: { anchor: RelativeAnchor; onClose: () => void; onAdded?: (p: PersonDetail) => void }) {
  const [detail, setDetail] = useState<PersonDetail | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  useEffect(() => { api.person(anchor.id).then(setDetail).catch(() => setDetail(null)) }, [anchor.id])
  const choices = useMemo(() => relativeChoices(anchor, detail?.spouses ?? [], !!detail?.parents.some((p) => p.sex === 'M'), !!detail?.parents.some((p) => p.sex === 'F')), [anchor, detail])
  const groups = (['parents', 'grands-parents', 'fratrie', 'enfants', 'couple'] as const).map((g) => ({ g, items: choices.filter((c) => c.group === g) })).filter((x) => x.items.length)
  if (choice) return <AddRelativeSheet anchor={anchor} choice={choice} onBack={() => setChoice(null)} onClose={onClose} onAdded={onAdded} />
  return (
    <Sheet title="Ajouter des proches…" subtitle={anchor.display_name} onClose={onClose}>
      <div className="space-y-3">
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">{GROUP_ICON[g]}{GROUP_LABEL[g]}</div>
            <div className="overflow-hidden rounded-2xl bg-white/90 shadow-sm ring-1 ring-black/5">
              {items.map((c, i) => (
                <button key={c.label} onClick={() => setChoice(c)} className={`flex w-full items-center justify-between px-4 py-3 text-left text-[15px] text-night-900 hover:bg-black/[0.03] ${i ? 'border-t border-black/5' : ''}`}>
                  <span>{c.label}</span><UserPlus size={16} className="text-mist-400" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

/** Formulaire court pour créer (ou relier) le proche choisi, avec recherche IA lancée automatiquement. */
export function AddRelativeSheet({ anchor, choice, onBack, onClose, onAdded }: { anchor: RelativeAnchor; choice: Choice; onBack?: () => void; onClose: () => void; onAdded?: (p: PersonDetail) => void }) {
  const { notify, refreshDashboard } = useApp()
  const sameSurname = ['father', 'brother', 'son', 'paternal_grandfather', 'paternal_grandmother', 'sister', 'daughter'].includes(choice.kind)
  const [form, setForm] = useState<PersonIn>({ given_names: '', surname: sameSurname && choice.kind !== 'paternal_grandmother' ? (anchor.surname ?? '') : '', birth_date: '', birth_place: '', death_date: '', death_place: '', occupation: '' })
  const [marriage, setMarriage] = useState({ date: '', place: '' })
  const [research, setResearch] = useState(true)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (mode !== 'existing') return; const t = setTimeout(() => api.persons(query || undefined, 30).then((r) => setResults(r.filter((p) => p.id !== anchor.id))).catch(() => setResults([])), 200); return () => clearTimeout(t) }, [query, mode, anchor.id])
  const isCouple = ['spouse', 'husband', 'wife'].includes(choice.kind)
  const submit = async (existingId?: string) => {
    setBusy(true); setError(null)
    try {
      const clean = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '' && v !== null)) as PersonIn
      const res = await api.addRelative(anchor.id, {
        relation: choice.kind, person: existingId ? undefined : clean, existing_id: existingId, other_parent_id: choice.otherParent?.id,
        marriage_date: isCouple ? marriage.date || undefined : undefined, marriage_place: isCouple ? marriage.place || undefined : undefined, research,
      })
      notify('success', res.message + (res.task_ids.length ? ' La recherche IA démarre.' : ''))
      if (res.placeholders.length) notify('info', 'Une fiche d’attente a été créée pour le parent intermédiaire : son identité reste à rechercher.')
      if (res.task_ids.length) pulseEngine()
      refreshDashboard()
      onAdded?.(res.person)
      onClose()
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Ajout impossible.') } finally { setBusy(false) }
  }
  const set = (k: keyof PersonIn, v: string) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Sheet title={`Ajouter ${RELATIVE_TITLE[choice.kind]}`} subtitle={`de ${anchor.display_name}${choice.otherParent ? ` et ${choice.otherParent.display_name}` : ''}`} onClose={onClose} onBack={onBack}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 text-sm">
        <button className={`rounded-lg py-1.5 ${mode === 'new' ? 'bg-white shadow-sm font-medium' : 'text-mist-500'}`} onClick={() => setMode('new')}>Nouvelle personne</button>
        <button className={`rounded-lg py-1.5 ${mode === 'existing' ? 'bg-white shadow-sm font-medium' : 'text-mist-500'}`} onClick={() => setMode('existing')}>Personne existante</button>
      </div>
      {mode === 'new' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Prénom(s)</span><input autoFocus className="input" value={form.given_names ?? ''} onChange={(e) => set('given_names', e.target.value)} /></label>
            <label className="block"><span className="label">Nom de naissance</span><input className="input" value={form.surname ?? ''} onChange={(e) => set('surname', e.target.value)} /></label>
            <label className="block"><span className="label">Naissance (date)</span><input className="input" placeholder="1908, vers 1900, 12/03/1895…" value={form.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value)} /></label>
            <label className="block"><span className="label">Lieu de naissance</span><input className="input" placeholder="Commune, pays" value={form.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} /></label>
            <label className="block"><span className="label">Décès (date)</span><input className="input" value={form.death_date ?? ''} onChange={(e) => set('death_date', e.target.value)} /></label>
            <label className="block"><span className="label">Lieu de décès</span><input className="input" value={form.death_place ?? ''} onChange={(e) => set('death_place', e.target.value)} /></label>
          </div>
          {isCouple && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Mariage (date)</span><input className="input" value={marriage.date} onChange={(e) => setMarriage((m) => ({ ...m, date: e.target.value }))} /></label>
              <label className="block"><span className="label">Lieu du mariage</span><input className="input" value={marriage.place} onChange={(e) => setMarriage((m) => ({ ...m, place: e.target.value }))} /></label>
            </div>
          )}
          <p className="text-xs text-mist-500">Tout est facultatif : laissez vide ce que vous ne savez pas, la recherche IA complétera à partir des archives.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative"><Search size={15} className="absolute left-3 top-2.5 text-mist-400" /><input autoFocus className="input pl-9" placeholder="Rechercher dans l’arbre…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="max-h-64 overflow-auto rounded-2xl bg-white/90 ring-1 ring-black/5">
            {results.map((p, i) => (
              <button key={p.id} disabled={busy} onClick={() => submit(p.id)} className={`flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-black/[0.03] ${i ? 'border-t border-black/5' : ''}`}>
                <span><span className="font-medium">{p.display_name}</span> <span className="text-xs text-mist-500">{p.birth_year ?? '?'}–{p.death_year ?? ''}</span></span><UserPlus size={15} className="text-mist-400" />
              </button>
            ))}
            {results.length === 0 && <p className="px-4 py-3 text-sm text-mist-500">Aucune personne trouvée.</p>}
          </div>
        </div>
      )}
      <label className="mt-4 flex items-center gap-2 rounded-xl bg-[#ece6ff] px-3 py-2.5 text-sm text-[#3f2aa8]"><input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} /><Sparkles size={15} /> Lancer la recherche IA sur cette personne</label>
      {error && <p className="mt-3 text-sm text-conf-red">{error}</p>}
      {mode === 'new' && <button className="btn-primary mt-4 w-full justify-center !py-3 text-base" disabled={busy} onClick={() => submit()}>{busy ? 'Ajout…' : 'Ajouter'}</button>}
    </Sheet>
  )
}

/** Feuille modale (bas d'écran sur mobile, centrée sur ordinateur), au style iOS. */
export function Sheet({ title, subtitle, children, onClose, onBack }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; onBack?: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  // Rendu dans document.body : une carte animée (transform) ne doit pas piéger la feuille « fixed ».
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="fade-up max-h-[88vh] w-full overflow-auto rounded-t-3xl bg-[#f4f5fa] p-4 shadow-2xl sm:max-w-lg sm:rounded-3xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/15 sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {onBack && <button onClick={onBack} className="mt-0.5 rounded-full px-2 text-sm text-[#2f6fd1]">‹ Retour</button>}
            <div><h3 className="text-lg font-semibold text-night-900">{title}</h3>{subtitle && <p className="text-sm text-mist-500">{subtitle}</p>}</div>
          </div>
          <button onClick={onClose} className="rounded-full bg-black/5 p-1.5 text-mist-500 hover:bg-black/10" aria-label="Fermer"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
