import { useEffect, useMemo, useState } from 'react'
import { api, CONF_LABEL, type Confidence, type SourceOut } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, Spinner } from '../ui'
import { Modal, RELIABILITY_CLASS, RELIABILITY_LABEL, errMsg } from './helpers'

const CONFS: Confidence[] = ['green', 'orange', 'red', 'grey']

export function LinkSourceModal({ targetType, targetId, onClose, onDone }: { targetType: string; targetId: string; onClose: () => void; onDone: () => void }) {
  const { notify } = useApp()
  const [sources, setSources] = useState<SourceOut[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<Confidence>('orange')
  const [excerpt, setExcerpt] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.sources().then(setSources).catch((e: unknown) => { notify('error', errMsg(e)); setSources([]) }) }, [notify])
  const filtered = useMemo(() => {
    const qq = query.trim().toLowerCase()
    return (sources ?? []).filter((s) => !qq || [s.title, s.repository, s.commune, s.reference].some((v) => (v ?? '').toLowerCase().includes(qq)))
  }, [sources, query])
  const submit = async () => {
    if (!selected) { notify('error', 'Choisissez une source.'); return }
    setBusy(true)
    try {
      await api.addCitation({ source_id: selected, target_type: targetType, target_id: targetId, confidence, excerpt: excerpt.trim() || undefined })
      notify('success', 'Source liée.'); onDone(); onClose()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Lier une source" onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy || !selected} onClick={submit}>{busy && <Spinner />}Lier la source</button></>}>
      <input className="input mb-2" placeholder="Filtrer les sources (titre, dépôt, commune, cote)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-64 overflow-auto scrollbar-thin rounded-xl border border-ivory-300">
        {sources === null && <div className="p-3"><Spinner /></div>}
        {sources !== null && filtered.length === 0 && <Empty>Aucune source enregistrée. Créez-en une dans « Archives et documents ».</Empty>}
        {filtered.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)} className={`flex w-full flex-col items-start px-3 py-2 text-left cursor-pointer hover:bg-ivory-100 ${selected === s.id ? 'bg-gold-500/15' : ''}`}>
            <span className="text-sm font-medium text-night-900">{s.title}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-mist-500">
              <span className={`chip ${RELIABILITY_CLASS[s.reliability] ?? 'conf-grey'}`}>{RELIABILITY_LABEL[s.reliability] ?? s.reliability}</span>
              {s.repository && <span>{s.repository}</span>}{s.commune && <span>· {s.commune}</span>}{s.year && <span>· {s.year}</span>}{s.reference && <span>· {s.reference}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Confiance de la citation">
          <select className="input" value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>{CONFS.map((c) => <option key={c} value={c}>{CONF_LABEL[c]}</option>)}</select>
        </Field>
        <div className="sm:col-span-2"><Field label="Extrait (facultatif)"><textarea className="input" rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Passage de la source qui justifie le lien" /></Field></div>
      </div>
    </Modal>
  )
}
