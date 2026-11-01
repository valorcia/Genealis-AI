import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardCopy, ClipboardPaste, Download, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { api, openExternal, type MediaOut } from '../../api'
import { useApp } from '../../store'
import { errMsg } from '../person/helpers'
import { Spinner } from '../ui'
import { Callout } from './shared'

const TIPS = [
  'L’IA déchiffre l’écriture, ligne par ligne…',
  'Elle repère les personnes, leurs âges et leurs professions…',
  'Elle note les dates et les lieux tels qu’ils sont écrits…',
  'Les mots incertains seront signalés pour que vous les vérifiiez…',
]

/** Progression pendant l'envoi et la lecture par l'IA. */
export function ReadingProgress({ phase, name, counter }: { phase: 'upload' | 'read'; name: string; counter: string | null }) {
  const [sec, setSec] = useState(0)
  useEffect(() => { setSec(0); const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t) }, [phase])
  const tip = TIPS[Math.floor(sec / 6) % TIPS.length]
  const pct = phase === 'upload' ? 12 : Math.min(95, 15 + sec * 1.6)
  return (
    <section className="panel fade-up p-5 text-center" aria-live="polite">
      <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/12 text-gold-600">
        {phase === 'upload' ? <Spinner /> : <Sparkles size={30} className="animate-pulse" />}
      </div>
      <h2 className="font-display text-[20px] text-night-900">{phase === 'upload' ? 'Envoi du document…' : 'L’IA lit le document…'}</h2>
      <p className="mt-1 truncate text-sm text-mist-500">{name}{counter ? ` · ${counter}` : ''}</p>
      <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-mist-200"><div className="h-full rounded-full bg-gold-500 transition-all duration-1000" style={{ width: `${pct}%` }} /></div>
      {phase === 'read' && <p className="mt-3 text-[14px] text-night-900">{tip}</p>}
      {phase === 'read' && <p className="mt-1 text-xs text-mist-500">{sec} s — une page manuscrite prend en général 20 à 90 secondes.</p>}
    </section>
  )
}

/** Mode copier-coller : le document est lu dans claude.ai / chatgpt.com (abonnement de l'utilisateur). */
export function ManualPastePanel({ media, reason, onDone, onRetry }: { media: MediaOut; reason: string | null; onDone: (m: MediaOut) => void; onRetry?: () => void }) {
  const { notify } = useApp()
  const [prompt, setPrompt] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [source, setSource] = useState<'claude.ai' | 'chatgpt.com'>('claude.ai')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.mediaPrompt(media.id).then((r) => setPrompt(r.prompt)).catch((e: unknown) => notify('error', errMsg(e))) }, [media.id, notify])
  const copy = async () => {
    if (!prompt) return
    try { await navigator.clipboard.writeText(prompt); notify('success', 'Texte copié. Collez-le dans la conversation, avec la photo du document.') }
    catch { notify('error', 'Copie impossible : ouvrez « Voir le texte » et copiez-le à la main.') }
  }
  const submit = async () => {
    setBusy(true)
    try { const m = await api.mediaManualAnalysis(media.id, answer, source); onDone(m) }
    catch (e) { notify('error', errMsg(e, 'Réponse illisible : collez toute la réponse, transcription et bloc JSON compris.')) }
    finally { setBusy(false) }
  }
  const stepCls = 'flex gap-3'
  const num = (n: number) => <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-500 text-[13px] font-semibold text-white">{n}</span>
  return (
    <section className="panel fade-up space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-display text-[19px] text-night-900">Faire lire le document par Claude ou ChatGPT</h2>
        {reason && <p className="mt-1 flex items-start gap-1.5 text-[13px] text-conf-orange"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{reason}</p>}
        <p className="mt-1 text-[13.5px] text-mist-500">Avec votre abonnement, en 4 gestes. Rien n’est ajouté à l’arbre sans votre accord.</p>
      </div>
      <ol className="space-y-3.5 text-[14.5px]">
        <li className={stepCls}>{num(1)}<div className="min-w-0 flex-1">Gardez la photo du document sous la main (dans vos Photos), ou
          <a className="btn-ghost ml-1 mt-1 !py-1.5" href={api.mediaFileUrl(media.id)} download={media.original_filename ?? undefined}><Download size={15} /> l’enregistrer</a></div></li>
        <li className={stepCls}>{num(2)}<div className="min-w-0 flex-1">
          <button type="button" className="btn-primary !min-h-11 w-full sm:w-auto" onClick={copy} disabled={!prompt}><ClipboardCopy size={16} /> Copier le texte à coller</button>
          {prompt && <details className="mt-1.5 text-xs text-mist-500"><summary className="cursor-pointer py-1">Voir le texte</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ivory-100 p-2 font-sans">{prompt}</pre></details>}
        </div></li>
        <li className={stepCls}>{num(3)}<div className="min-w-0 flex-1">Ouvrez votre assistant, joignez la photo et collez le texte :
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost !min-h-11" onClick={() => { setSource('claude.ai'); openExternal('https://claude.ai/new') }}><ExternalLink size={15} /> Claude</button>
            <button type="button" className="btn-ghost !min-h-11" onClick={() => { setSource('chatgpt.com'); openExternal('https://chatgpt.com/') }}><ExternalLink size={15} /> ChatGPT</button>
          </div></div></li>
        <li className={stepCls}>{num(4)}<div className="min-w-0 flex-1">Copiez <b>toute</b> sa réponse et collez-la ici :
          <textarea className="input mt-1.5 font-mono text-[13px]" rows={7} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Collez la réponse (transcription + ===JSON=== …)" aria-label="Réponse de l’assistant" />
          <button type="button" className="btn-gold mt-2 !min-h-11 w-full" disabled={busy || !answer.trim()} onClick={submit}>{busy ? <Spinner /> : <ClipboardPaste size={16} />} Utiliser cette réponse</button>
        </div></li>
      </ol>
      {onRetry && <button type="button" className="btn-ghost w-full" onClick={onRetry}><RefreshCw size={15} /> Lire automatiquement avec l’IA</button>}
      <Callout tone="warn" icon={AlertTriangle}>La réponse d’un assistant peut contenir des erreurs de lecture : vous comparerez le texte à l’image à l’étape suivante.</Callout>
    </section>
  )
}
