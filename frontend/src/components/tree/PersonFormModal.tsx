import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, ApiError, type PersonDetail, type PersonIn } from '../../api'
import { Field, Spinner } from '../ui'
import { useApp } from '../../store'

export interface PersonFormModalProps {
  open: boolean
  title?: string
  /** Texte d'aide affiché sous le titre (ex. « Sera rattaché(e) comme parent de … »). */
  hint?: string | null
  onClose: () => void
  /** Appelé après création réussie ; peut être asynchrone (ex. ajout d'une relation). */
  onCreated: (person: PersonDetail) => Promise<void> | void
}

const EMPTY: PersonIn = { given_names: '', surname: '', married_name: '', sex: null, birth_date: '', birth_place: '', death_date: '', death_place: '', occupation: '', is_root: false }

/** Formulaire modal de création d'une personne (réutilisé par l'arbre et l'ajout de parent). */
export default function PersonFormModal({ open, title = 'Ajouter une personne', hint, onClose, onCreated }: PersonFormModalProps) {
  const notify = useApp((s) => s.notify)
  const [form, setForm] = useState<PersonIn>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setForm(EMPTY); setError(null); setSaving(false) } }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const set = <K extends keyof PersonIn>(k: K, v: PersonIn[K]) => setForm((f) => ({ ...f, [k]: v }))
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!clean(form.given_names) && !clean(form.surname)) { setError('Indiquez au moins un prénom ou un nom.'); return }
    setSaving(true); setError(null)
    try {
      const created = await api.createPerson({
        given_names: clean(form.given_names), surname: clean(form.surname), married_name: clean(form.married_name),
        sex: form.sex ?? null, birth_date: clean(form.birth_date), birth_place: clean(form.birth_place),
        death_date: clean(form.death_date), death_place: clean(form.death_place), occupation: clean(form.occupation),
        is_root: form.is_root ?? false,
      })
      await onCreated(created)
      notify('success', `${created.display_name} ajouté(e) à l'arbre.`)
      onClose()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Impossible de créer la personne (moteur local injoignable ?).'
      setError(msg); notify('error', msg)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-night-950/50 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="panel fade-up w-full max-w-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-start justify-between gap-4 border-b border-ivory-300/70 px-6 py-4">
          <div>
            <h2 className="font-display text-2xl text-night-900">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-mist-500">{hint}</p>}
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1.5" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <Field label="Prénoms"><input className="input" value={form.given_names ?? ''} onChange={(e) => set('given_names', e.target.value)} autoFocus placeholder="Marie Louise" /></Field>
          <Field label="Nom de naissance"><input className="input" value={form.surname ?? ''} onChange={(e) => set('surname', e.target.value)} placeholder="DUPONT" /></Field>
          <Field label="Nom marital"><input className="input" value={form.married_name ?? ''} onChange={(e) => set('married_name', e.target.value)} placeholder="Optionnel" /></Field>
          <Field label="Sexe">
            <select className="input" value={form.sex ?? ''} onChange={(e) => set('sex', e.target.value || null)}>
              <option value="">Inconnu</option><option value="M">Masculin</option><option value="F">Féminin</option>
            </select>
          </Field>
          <Field label="Date de naissance"><input className="input" value={form.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value)} placeholder="ex. 12 mars 1895, vers 1890, avant 1900" /></Field>
          <Field label="Lieu de naissance"><input className="input" value={form.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} placeholder="Commune, département, pays" /></Field>
          <Field label="Date de décès"><input className="input" value={form.death_date ?? ''} onChange={(e) => set('death_date', e.target.value)} placeholder="Texte libre" /></Field>
          <Field label="Lieu de décès"><input className="input" value={form.death_place ?? ''} onChange={(e) => set('death_place', e.target.value)} /></Field>
          <Field label="Profession"><input className="input" value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} placeholder="ex. cultivateur, couturière" /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-night-900">
            <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={form.is_root ?? false} onChange={(e) => set('is_root', e.target.checked)} />
            Personne de départ (de cujus)
          </label>
        </div>
        {error && <p className="px-6 text-sm text-conf-red">{error}</p>}
        <footer className="flex items-center justify-end gap-2 border-t border-ivory-300/70 px-6 py-4">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="submit" className="btn-gold" disabled={saving}>{saving ? <Spinner /> : null}{saving ? 'Enregistrement…' : 'Créer la personne'}</button>
        </footer>
      </form>
    </div>
  )
}
