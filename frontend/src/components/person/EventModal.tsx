import { useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { api, CONF_LABEL, type Confidence, type EventIn, type EventOut } from '../../api'
import { useApp } from '../../store'
import { Sheet } from '../relatives/AddRelative'
import { Spinner } from '../ui'
import { errMsg } from './helpers'
import { FAMILY_EVENT_TYPES, eventIcon, eventLabel, eventTypeGroups } from './eventMeta'

const CONFS: Confidence[] = ['green', 'orange', 'red', 'grey']

export interface FamilyChoice { id: string; label: string }

/**
 * Éditeur d'événement en feuille iOS. Sert à la création (type prérempli depuis une ligne grisée
 * « Baptême – Saisir l'information ici ») comme à la modification. Les événements de couple sont
 * enregistrés sur la famille choisie.
 */
export function EventSheet({ personId, personName, event, presetType, presetFamilyId, families, onClose, onSaved, onBack }: {
  personId: string; personName: string; event: EventOut | null; presetType?: string; presetFamilyId?: string; families: FamilyChoice[]
  onClose: () => void; onSaved: () => void | Promise<void>; onBack?: () => void
}) {
  const { notify } = useApp()
  const [form, setForm] = useState<EventIn>({
    event_type: event?.event_type ?? presetType ?? 'birth',
    date: event?.date_original ?? '',
    place: event?.place_original ?? event?.place_name ?? '',
    description: event?.description ?? '',
    value_original: event?.value_original ?? '',
    confidence: event?.confidence ?? 'orange',
  })
  const [familyId, setFamilyId] = useState<string>(event?.family_id ?? presetFamilyId ?? families[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isFamily = event ? !!event.family_id : FAMILY_EVENT_TYPES.includes(form.event_type)
  const typeChoices = eventTypeGroups().find((g) => g.family === isFamily)?.types ?? []
  const set = <K extends keyof EventIn>(k: K, v: EventIn[K]) => setForm((f) => ({ ...f, [k]: v }))
  const Icon = eventIcon(form.event_type)
  const partner = families.find((f) => f.id === familyId)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const payload: EventIn = { ...form, date: form.date || null, place: form.place || null, description: form.description || null, value_original: form.value_original || null }
      if (event) await api.updateEvent(event.id, payload)
      else if (isFamily) {
        if (!familyId) throw new Error('Ajoutez d’abord un conjoint (bouton « + Conjoint ») pour enregistrer un événement de couple.')
        await api.addFamilyEvent(familyId, { ...payload, family_id: familyId })
      } else await api.addEvent(personId, payload)
      notify('success', event ? 'Événement mis à jour.' : `${eventLabel(form.event_type)} enregistré.`)
      await onSaved(); onClose()
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!event || !window.confirm(`Supprimer l’événement « ${eventLabel(event.event_type)} » ?`)) return
    setBusy(true)
    try { await api.deleteEvent(event.id); notify('success', 'Événement supprimé.'); await onSaved(); onClose() } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <Sheet title={event ? `Modifier : ${eventLabel(form.event_type)}` : eventLabel(form.event_type)} subtitle={isFamily && partner ? `${personName} et ${partner.label}` : personName} onClose={onClose} onBack={onBack}>
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dfeafc] text-[#2f6fd1]"><Icon size={20} /></span>
          <label className="min-w-0 flex-1">
            <span className="label">Type d’événement</span>
            <select className="input" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
              {typeChoices.map((k) => <option key={k} value={k}>{eventLabel(k)}</option>)}
            </select>
          </label>
        </div>
        {isFamily && !event && (
          families.length === 0
            ? <p className="rounded-xl bg-[#fff4e0] p-3 text-sm text-[#8a5a10]">Cet événement concerne un couple : ajoutez d’abord un conjoint avec le bouton « + Conjoint ».</p>
            : <label className="block"><span className="label">Avec qui ?</span>
              <select className="input" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>{families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
            </label>
        )}
        <label className="block"><span className="label">Date</span>
          <input autoFocus className="input" value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} placeholder="1908, vers 1900, 12/03/1895…" />
          <span className="mt-1 block text-xs text-mist-500">Saisie libre : « 12/03/1895 », « vers 1895 », « entre 1890 et 1900 », « 12 vendémiaire an III ».</span>
        </label>
        <label className="block"><span className="label">Lieu</span><input className="input" value={form.place ?? ''} onChange={(e) => set('place', e.target.value)} placeholder="Commune, département, pays" /></label>
        <label className="block"><span className="label">{form.event_type === 'occupation' ? 'Profession exercée' : 'Description'}</span>
          <input className="input" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder={form.event_type === 'occupation' ? 'ex. cultivateur, couturière…' : ''} />
        </label>
        <details className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-night-900">Plus de détails <ChevronRight size={15} className="text-mist-400" /></summary>
          <div className="mt-3 space-y-3">
            <label className="block"><span className="label">Tel qu’écrit dans le document</span><textarea className="input" rows={2} value={form.value_original ?? ''} onChange={(e) => set('value_original', e.target.value)} placeholder="Transcription fidèle (orthographe d’époque conservée)" /></label>
            <label className="block"><span className="label">Niveau de confiance</span>
              <select className="input" value={form.confidence ?? 'orange'} onChange={(e) => set('confidence', e.target.value as Confidence)}>{CONFS.map((c) => <option key={c} value={c}>{CONF_LABEL[c]}</option>)}</select>
            </label>
          </div>
        </details>
        {error && <p className="text-sm text-conf-red">{error}</p>}
        <button className="btn-primary w-full justify-center !py-3 text-base" disabled={busy || (isFamily && !event && families.length === 0)} onClick={save}>{busy && <Spinner />}Enregistrer</button>
        {event && <button className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm text-conf-red hover:bg-conf-red/5" disabled={busy} onClick={del}><Trash2 size={14} />Supprimer cet événement</button>}
      </div>
    </Sheet>
  )
}

/** Feuille « Ajouter un événement » : tous les types avec icônes, groupés (comme MobileFamilyTree). */
export function AddEventSheet({ onPick, onClose, hasPartner }: { onPick: (type: string) => void; onClose: () => void; hasPartner: boolean }) {
  return (
    <Sheet title="Ajouter un événement" onClose={onClose}>
      <div className="space-y-4">
        {eventTypeGroups().map((g) => (
          <div key={g.title}>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">{g.title}</div>
            {g.family && !hasPartner && <p className="mb-1 px-1 text-xs text-mist-500">Ajoutez d’abord un conjoint pour pouvoir saisir ces événements.</p>}
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
              {g.types.map((t, i) => {
                const Icon = eventIcon(t)
                const disabled = g.family && !hasPartner
                return (
                  <button key={t} disabled={disabled} onClick={() => onPick(t)} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] text-night-900 hover:bg-black/[0.03] disabled:opacity-40 ${i ? 'border-t border-black/5' : ''}`}>
                    <Icon size={20} className="shrink-0 text-[#2f6fd1]" />{eventLabel(t)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
