import { useState } from 'react'
import { api, CONF_LABEL, EVENT_LABEL, type Confidence, type EventIn, type EventOut } from '../../api'
import { useApp } from '../../store'
import { Field, Spinner } from '../ui'
import { Modal, errMsg } from './helpers'

const CONFS: Confidence[] = ['green', 'orange', 'red', 'grey']

export function EventModal({ personId, event, onClose, onSaved }: { personId: string; event: EventOut | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp()
  const [form, setForm] = useState<EventIn>({
    event_type: event?.event_type ?? 'birth',
    date: event?.date_original ?? '',
    place: event?.place_original ?? event?.place_name ?? '',
    description: event?.description ?? '',
    value_original: event?.value_original ?? '',
    confidence: event?.confidence ?? 'orange',
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof EventIn>(k: K, v: EventIn[K]) => setForm((f) => ({ ...f, [k]: v }))
  const save = async () => {
    setBusy(true)
    try {
      const payload: EventIn = { ...form, date: form.date || null, place: form.place || null, description: form.description || null, value_original: form.value_original || null }
      if (event) await api.updateEvent(event.id, payload)
      else await api.addEvent(personId, payload)
      notify('success', event ? 'Événement mis à jour.' : 'Événement ajouté.')
      onSaved(); onClose()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title={event ? 'Modifier l’événement' : 'Ajouter un événement'} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type d’événement">
          <select className="input" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
            {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Niveau de confiance">
          <select className="input" value={form.confidence ?? 'orange'} onChange={(e) => set('confidence', e.target.value as Confidence)}>
            {CONFS.map((c) => <option key={c} value={c}>{CONF_LABEL[c]}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Date">
            <input className="input" value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} placeholder="ex. 12/03/1895, vers 1895, entre 1890 et 1900, 12 vendémiaire an III" />
          </Field>
          <p className="mt-1 text-xs text-mist-500">Saisie libre : « 12/03/1895 », « vers 1895 », « entre 1890 et 1900 », « 12 vendémiaire an III » (calendrier républicain converti automatiquement).</p>
        </div>
        <div className="sm:col-span-2">
          <Field label="Lieu"><input className="input" value={form.place ?? ''} onChange={(e) => set('place', e.target.value)} placeholder="Commune, département, pays" /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description"><textarea className="input" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Tel qu’écrit dans le document"><textarea className="input font-display text-base" rows={2} value={form.value_original ?? ''} onChange={(e) => set('value_original', e.target.value)} placeholder="Transcription fidèle de la mention originale (orthographe d’époque conservée)" /></Field>
        </div>
      </div>
    </Modal>
  )
}
