/** Formulaire « Lancer une enquête autonome » : personne, objectif, générations, plafond d'appels IA, mode. */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Rocket, Search, ShieldCheck } from 'lucide-react'
import { api, type PersonSummary } from '../../api'
import { useApp } from '../../store'
import { Avatar, Modal, errMsg } from '../person/helpers'
import { Field, Spinner } from '../ui'
import { investigationApi, isUnavailable, type CostMode } from '../../lib/investigationApi'

const MODES: { id: CostMode; label: string; desc: string }[] = [
  { id: 'free', label: 'GRATUIT', desc: 'Aucun service payant. L’enquête s’arrête d’elle-même dès qu’un quota gratuit est atteint.' },
  { id: 'hybrid', label: 'HYBRIDE', desc: 'Gratuit d’abord ; un service payant seulement si vous l’avez autorisé, dans la limite de votre budget.' },
  { id: 'commercial', label: 'COMMERCIAL', desc: 'Réservé à une utilisation professionnelle (comptes clients, coûts suivis).' },
]

/** Liste de personnes avec recherche (même présentation que le reste de l'application). */
export function PersonSelect({ persons, value, onChange }: { persons: PersonSummary[] | null; value: string | null; onChange: (p: PersonSummary) => void }) {
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    if (!persons) return []
    const qq = query.trim().toLowerCase()
    return persons
      .filter((p) => !qq || p.display_name.toLowerCase().includes(qq) || (p.birth_place ?? '').toLowerCase().includes(qq))
      .sort((a, b) => Number(b.id === value) - Number(a.id === value) || Number(b.is_root) - Number(a.is_root) || ((a.sosa?.[0] ?? 1e9) - (b.sosa?.[0] ?? 1e9)))
      .slice(0, 60)
  }, [persons, query, value])
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-2.5 text-mist-400" />
        <input className="input pl-9" placeholder="Chercher une personne de l’arbre…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="max-h-56 overflow-auto rounded-xl border border-[var(--hairline)] bg-white scrollbar-thin">
        {persons === null && <div className="p-3"><Spinner /></div>}
        {persons !== null && list.length === 0 && <div className="p-4 text-center text-sm text-mist-500">{persons.length === 0 ? 'Votre arbre est vide : ajoutez d’abord une personne.' : 'Aucune personne ne correspond.'}</div>}
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => onChange(p)} className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-ivory-100 ${value === p.id ? 'bg-[#ece6ff]' : ''}`}>
            <Avatar p={p} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-night-900">{p.display_name}</span>
              <span className="block truncate text-xs text-mist-500">{[p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? (p.is_living ? '' : '?')}` : null, p.birth_place, p.sosa?.length ? `Sosa ${p.sosa[0]}` : null].filter(Boolean).join(' · ') || 'Dates inconnues'}</span>
            </span>
            {p.is_living && <span className="chip shrink-0 bg-[#e3f4e6] text-[#2f6b3b]"><ShieldCheck size={11} />vivant</span>}
            {value === p.id && <Check size={16} className="shrink-0 text-[#5b3fd6]" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function LaunchInvestigationModal({ initialPersonId, onClose }: { initialPersonId?: string | null; onClose: () => void }) {
  const { notify, settings } = useApp()
  const nav = useNavigate()
  const [persons, setPersons] = useState<PersonSummary[] | null>(null)
  const [personId, setPersonId] = useState<string | null>(initialPersonId ?? null)
  const [objective, setObjective] = useState('')
  const [generations, setGenerations] = useState<number>(Number(settings?.investigation_max_generations) || 3)
  const [ceiling, setCeiling] = useState<number>(Number(settings?.investigation_ai_call_ceiling) || 60)
  const [mode, setMode] = useState<CostMode>((['free', 'hybrid', 'commercial'].includes(String(settings?.cost_mode)) ? settings?.cost_mode : 'free') as CostMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.persons(undefined, 2000).then((l) => {
      setPersons(l)
      setPersonId((cur) => (cur && l.some((p) => p.id === cur) ? cur : (l.find((p) => p.is_root) ?? l[0])?.id ?? null))
    }).catch(() => setPersons([]))
  }, [])
  const person = persons?.find((p) => p.id === personId) ?? null

  const submit = async () => {
    if (!personId) return
    setBusy(true); setError(null)
    try {
      const inv = await investigationApi.create({ person_id: personId, objective: objective.trim() || undefined, max_generations: generations, ai_call_ceiling: ceiling, cost_mode: mode, start: true })
      notify('success', 'Enquête lancée. Vous pouvez la suivre en direct.')
      nav(`/investigation/${inv.id}`)
    } catch (e) {
      setError(isUnavailable(e) ? 'Le moteur installé ne sait pas encore lancer d’enquête autonome (fonction en cours d’installation). Réessayez après la mise à jour.' : errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Lancer une enquête autonome" onClose={onClose} wide footer={<>
      <button className="btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn-gold" disabled={busy || !personId} onClick={submit}>{busy ? <Spinner /> : <Rocket size={16} />}Lancer l’enquête</button>
    </>}>
      <p className="mb-4 text-sm leading-relaxed text-night-900/80">
        L’IA va chercher les documents qui parlent de cette personne, les lire, puis remonter ses parents génération après génération.
        Elle ne crée <strong>jamais</strong> de lien de parenté sur le seul nom : tout ce qui n’est pas prouvé par un acte reste une <em>hypothèse à vérifier</em>,
        et vous pourrez mettre en pause ou arrêter à tout moment.
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <span className="label">Personne de départ</span>
          <PersonSelect persons={persons} value={personId} onChange={(p) => setPersonId(p.id)} />
          {person?.is_living && <p className="mt-2 text-xs text-[#2f6b3b]">Cette personne est vivante : ses données ne sont jamais transmises à un service externe sans votre autorisation (réglage « Confidentialité »).</p>}
        </div>
        <div className="min-w-0 space-y-4">
          <Field label="Objectif (facultatif)">
            <textarea className="input min-h-[72px]" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex. : retrouver les parents de mon arrière-grand-père, né vers 1880 en Lorraine" />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Générations">
              <input type="number" min={1} max={12} className="input" value={generations} onChange={(e) => setGenerations(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Plafond d’appels IA">
              <input type="number" min={0} max={2000} className="input" value={ceiling} onChange={(e) => setCeiling(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-mist-500">Au-delà du plafond, l’enquête se met en pause et vous demande avant de continuer.</p>
          <div>
            <span className="label">Mode de coût</span>
            <div className="grid gap-2" role="radiogroup">
              {MODES.map((m) => {
                const locked = m.id === 'commercial' && settings?.cost_mode !== 'commercial'
                return (
                  <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} disabled={locked} onClick={() => setMode(m.id)}
                    className={`rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${mode === m.id ? 'border-[#5b3fd6] bg-[#ece6ff]/60' : 'border-[var(--hairline)] bg-white hover:border-[#5b3fd6]/40'}`}>
                    <span className="block text-[12px] font-bold tracking-[0.08em] text-night-900">{m.label}</span>
                    <span className="block text-xs leading-snug text-mist-500">{locked ? 'À activer d’abord dans Paramètres › Enquêtes et coûts (une confirmation vous sera demandée).' : m.desc}</span>
                  </button>
                )
              })}
            </div>
            {mode !== 'free' && <p className="mt-2 text-xs text-[#87510f]">Ce mode n’engage aucune dépense à lui seul : un service payant n’est utilisé que si vous l’avez autorisé dans Paramètres, et jamais au-delà du budget fixé.</p>}
          </div>
        </div>
      </div>
      {error && <p className="mt-4 rounded-xl bg-conf-red/10 px-3 py-2 text-sm text-conf-red">{error}</p>}
    </Modal>
  )
}
