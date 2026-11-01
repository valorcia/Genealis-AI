import { useEffect, useState } from 'react'
import { api, RELATION_LABEL, type PersonSummary } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, PersonLink, Spinner } from '../ui'
import { Modal, errMsg } from './helpers'

export type PickerMode = 'parent' | 'child' | 'spouse'
const TITLES: Record<PickerMode, string> = { parent: 'Ajouter un parent', child: 'Ajouter un enfant', spouse: 'Ajouter un conjoint' }

export function PersonPicker({ personId, mode, exclude, onClose, onDone }: { personId: string; mode: PickerMode; exclude: string[]; onClose: () => void; onDone: () => void }) {
  const { notify } = useApp()
  const [tab, setTab] = useState<'search' | 'create'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<PersonSummary | null>(null)
  const [relationType, setRelationType] = useState('biological')
  const [marriageDate, setMarriageDate] = useState('')
  const [marriagePlace, setMarriagePlace] = useState('')
  const [nf, setNf] = useState({ given_names: '', surname: '', sex: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => {
      api.persons(query.trim() || undefined, 50).then((r) => setResults(r.filter((p) => !exclude.includes(p.id)))).catch((e: unknown) => notify('error', errMsg(e))).finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [query, exclude, notify])

  const link = async (otherId: string) => {
    if (mode === 'parent') await api.addRelation({ parent_id: otherId, child_id: personId, relation_type: relationType })
    else if (mode === 'child') await api.addRelation({ parent_id: personId, child_id: otherId, relation_type: relationType })
    else await api.createFamily({ partner1_id: personId, partner2_id: otherId, marriage_date: marriageDate || null, marriage_place: marriagePlace || null })
  }
  const submit = async () => {
    setBusy(true)
    try {
      let otherId: string
      if (tab === 'search') {
        if (!selected) { notify('error', 'Sélectionnez une personne.'); setBusy(false); return }
        otherId = selected.id
      } else {
        if (!nf.given_names.trim() && !nf.surname.trim()) { notify('error', 'Indiquez au moins un prénom ou un nom.'); setBusy(false); return }
        const created = await api.createPerson({ given_names: nf.given_names.trim() || null, surname: nf.surname.trim() || null, sex: nf.sex || null })
        otherId = created.id
      }
      await link(otherId)
      notify('success', mode === 'spouse' ? 'Union créée.' : 'Lien de parenté ajouté.')
      onDone(); onClose()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <Modal title={TITLES[mode]} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy && <Spinner />}{tab === 'create' ? 'Créer et lier' : 'Lier'}</button></>}>
      <div className="mb-3 flex gap-1 rounded-xl bg-ivory-100 p-1">
        <button className={`flex-1 rounded-lg px-3 py-1.5 text-sm cursor-pointer ${tab === 'search' ? 'bg-white shadow-sm text-night-900' : 'text-mist-500'}`} onClick={() => setTab('search')}>Personne existante</button>
        <button className={`flex-1 rounded-lg px-3 py-1.5 text-sm cursor-pointer ${tab === 'create' ? 'bg-white shadow-sm text-night-900' : 'text-mist-500'}`} onClick={() => setTab('create')}>Nouvelle personne</button>
      </div>
      {tab === 'search' ? (
        <div className="space-y-2">
          <input className="input" autoFocus placeholder="Rechercher par nom…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-64 overflow-auto scrollbar-thin rounded-xl border border-ivory-300">
            {loading && <div className="p-3"><Spinner /></div>}
            {!loading && results.length === 0 && <Empty>Aucune personne trouvée.</Empty>}
            {!loading && results.map((p) => (
              <button key={p.id} onClick={() => setSelected(p)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm cursor-pointer hover:bg-ivory-100 ${selected?.id === p.id ? 'bg-gold-500/15' : ''}`}>
                <span>{p.display_name} <span className="text-xs text-mist-500">({p.birth_year ?? '?'}–{p.death_year ?? (p.is_living ? '' : '?')})</span></span>
                <span className="text-xs text-mist-500">{p.birth_place ?? ''}</span>
              </button>
            ))}
          </div>
          {selected && <div className="text-sm">Sélection : <PersonLink p={selected} /></div>}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénoms"><input className="input" value={nf.given_names} onChange={(e) => setNf({ ...nf, given_names: e.target.value })} /></Field>
          <Field label="Nom"><input className="input" value={nf.surname} onChange={(e) => setNf({ ...nf, surname: e.target.value })} /></Field>
          <Field label="Sexe">
            <select className="input" value={nf.sex} onChange={(e) => setNf({ ...nf, sex: e.target.value })}>
              <option value="">Inconnu</option><option value="M">Masculin</option><option value="F">Féminin</option>
            </select>
          </Field>
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {mode !== 'spouse' ? (
          <Field label="Type de filiation">
            <select className="input" value={relationType} onChange={(e) => setRelationType(e.target.value)}>
              {Object.entries(RELATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Date du mariage (facultatif)"><input className="input" value={marriageDate} onChange={(e) => setMarriageDate(e.target.value)} placeholder="ex. 14/06/1902, vers 1900" /></Field>
            <Field label="Lieu du mariage (facultatif)"><input className="input" value={marriagePlace} onChange={(e) => setMarriagePlace(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Modal>
  )
}
