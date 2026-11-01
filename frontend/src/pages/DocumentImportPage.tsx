import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ScanText } from 'lucide-react'
import { api, ApiError, type MediaOut, type PersonSummary } from '../api'
import { useApp } from '../store'
import { interpretApi, extractionOf, type ApplySummary, type InterpretCapabilities, type Proposals } from '../lib/interpretApi'
import { errMsg } from '../components/person/helpers'
import { Spinner } from '../components/ui'
import { PickStep } from '../components/import/PickStep'
import { ManualPastePanel, ReadingProgress } from '../components/import/ReadStep'
import { ReadingView } from '../components/import/ReadingView'
import { ProposalsStep } from '../components/import/ProposalsStep'
import { DoneView } from '../components/import/DoneView'
import { Callout, Stepper } from '../components/import/shared'

type Phase = 'pick' | 'upload' | 'reading' | 'manual' | 'read' | 'proposals' | 'done'
const STEP_OF: Record<Phase, number> = { pick: 1, upload: 2, reading: 2, manual: 2, read: 3, proposals: 4, done: 5 }

/**
 * Importer et interpréter un document (acte, recensement, registre matricule, faire-part, photo).
 * Parcours guidé en 4 étapes pensé pour l'iPhone : photo → lecture IA → ce que dit le document → ajouts validés.
 */
export default function DocumentImportPage() {
  const { notify, refreshDashboard } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [caps, setCaps] = useState<InterpretCapabilities | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [files, setFiles] = useState<File[]>([])
  const [person, setPerson] = useState<PersonSummary | null>(null)
  const [kind, setKind] = useState('auto')
  const [queue, setQueue] = useState<MediaOut[]>([])
  const [pos, setPos] = useState(0)
  const [media, setMedia] = useState<MediaOut | null>(null)
  const [manualReason, setManualReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [props, setProps] = useState<Proposals | null>(null)
  const [summary, setSummary] = useState<ApplySummary | null>(null)
  const [busy, setBusy] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => { interpretApi.capabilities().then(setCaps).catch(() => setCaps(null)) }, [])
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }) }, [phase])
  // ?personne=<id> : « Concernant » prérempli
  const personParam = params.get('personne')
  useEffect(() => {
    if (!personParam) return
    api.person(personParam).then((p) => setPerson(p)).catch(() => notify('error', 'Personne introuvable.'))
  }, [personParam, notify])
  // ?media=<id> : reprendre l'interprétation d'un document déjà importé
  const mediaParam = params.get('media')
  useEffect(() => {
    if (!mediaParam) return
    api.mediaDetail(mediaParam).then((m) => {
      setMedia(m); setQueue([m]); setPos(0)
      setPhase(Object.keys(extractionOf(m)).length ? 'read' : 'manual')
    }).catch((e: unknown) => notify('error', errMsg(e)))
  }, [mediaParam, notify])

  const read = useCallback(async (m: MediaOut, k: string) => {
    setMedia(m); setError(null); setManualReason(null)
    const opts = { kind: k, person_id: person?.id }
    if (!caps?.ai_available) {
      try { setMedia(await interpretApi.setReadingOptions(m.id, opts)) } catch { /* l'option n'est qu'une aide */ }
      setManualReason(caps?.manual ? null : 'Aucune IA n’est réglée pour lire automatiquement.')
      setPhase('manual'); return
    }
    setPhase('reading')
    try { setMedia(await interpretApi.analyzeNow(m.id, opts)); setPhase('read') }
    catch (e) {
      const msg = errMsg(e, 'La lecture a échoué.')
      setManualReason(msg)
      setPhase('manual')
      if (!(e instanceof ApiError && e.status === 409)) notify('error', msg)
    }
  }, [caps, person, notify])

  const start = async () => {
    setBusy(true); setPhase('upload'); setError(null)
    const done: MediaOut[] = []
    for (const f of files) {
      try { done.push(await api.uploadMedia(f, { person_id: person?.id, kind: kind === 'family_photo' ? 'photo' : 'document' })) }
      catch (e) { notify('error', `${f.name} : ${errMsg(e)}`) }
    }
    setBusy(false)
    if (!done.length) { setPhase('pick'); return }
    setQueue(done); setPos(0)
    if (done.some((m) => m.analysis && 'applied' in m.analysis)) notify('info', 'Ce document avait déjà été importé : les propositions tiendront compte de ce qui a déjà été ajouté à l’arbre.')
    await read(done[0], kind)
  }

  const showProposals = async () => {
    if (!media) return
    setBusy(true); setError(null)
    try { setProps(await interpretApi.proposals(media.id, true)); setPhase('proposals') }
    catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }
  const apply = async (actions: string[], overrides: Record<string, string>) => {
    if (!media) return
    setBusy(true); setError(null)
    try { setSummary(await interpretApi.apply(media.id, actions, overrides)); setPhase('done'); refreshDashboard() }
    catch (e) { setError(errMsg(e)); notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  const next = async () => {
    const n = pos + 1
    if (n >= queue.length) return
    setPos(n); setProps(null); setSummary(null)
    await read(queue[n], kind)
  }
  const reset = () => {
    setFiles([]); setQueue([]); setPos(0); setMedia(null); setProps(null); setSummary(null); setError(null); setKind('auto'); setPhase('pick')
    if (mediaParam) { params.delete('media'); setParams(params, { replace: true }) }
  }
  const counter = queue.length > 1 ? `document ${pos + 1} sur ${queue.length}` : null
  const back = () => {
    if (phase === 'proposals') setPhase('read')
    else if (phase === 'read' || phase === 'manual') reset()
    else navigate(-1)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4" ref={topRef}>
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          {phase !== 'pick' && phase !== 'done' && phase !== 'upload' && phase !== 'reading' && (
            <button type="button" className="btn-ghost !h-10 !w-10 !p-0" aria-label="Retour" onClick={back}><ArrowLeft size={18} /></button>
          )}
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 font-display text-[24px] leading-tight text-night-900 sm:text-[28px]"><ScanText size={24} className="text-gold-600" />Importer un document</h1>
            <p className="text-[13.5px] text-mist-500">L’IA lit l’acte, le recensement ou le registre ; vous validez ce qui est ajouté à l’arbre.{counter ? ` · ${counter}` : ''}</p>
          </div>
        </div>
        {phase !== 'done' && <Stepper step={STEP_OF[phase]} />}
      </header>

      {error && <Callout tone="warn" icon={AlertTriangle}>{error}</Callout>}

      {phase === 'pick' && <PickStep files={files} setFiles={setFiles} person={person} setPerson={setPerson} kind={kind} setKind={setKind} caps={caps} busy={busy} onStart={start} />}
      {(phase === 'upload' || phase === 'reading') && <ReadingProgress phase={phase === 'upload' ? 'upload' : 'read'} name={media?.original_filename ?? files[0]?.name ?? ''} counter={counter} />}
      {phase === 'manual' && media && (
        <ManualPastePanel media={media} reason={manualReason} onDone={(m) => { setMedia(m); setPhase('read') }}
          onRetry={caps?.ai_available ? () => read(media, kind) : undefined} />
      )}
      {phase === 'read' && media && <ReadingView media={media} busy={busy} onContinue={showProposals} onReread={(k) => { setKind(k); read(media, k) }} />}
      {phase === 'proposals' && props && (busy && !props ? <Spinner /> : <ProposalsStep key={props.fingerprint + props.generated_at} props={props} busy={busy} onApply={apply} />)}
      {phase === 'done' && summary && (
        <DoneView summary={summary} nextLabel={pos + 1 < queue.length ? `Document suivant (${pos + 2}/${queue.length})` : null} onNext={next} onAnother={reset} />
      )}
    </div>
  )
}
