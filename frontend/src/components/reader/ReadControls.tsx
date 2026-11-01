import { useState } from 'react'
import { ClipboardCopy, ExternalLink, Gauge, ScanText, Sparkles } from 'lucide-react'
import { openExternal } from '../../api'
import { paleoApi, type BenchmarkReport, type PaleoCatalog, type ReadOptions, type ReferenceInfo } from '../../lib/paleoApi'
import { Spinner } from '../ui'

/** Options de lecture : écriture et langue forcées, traduction, seconde analyse, rotation de la copie, même main. */
export function ReadOptionsForm({ catalog, initial, busy, onRead, compact = false }: {
  catalog: PaleoCatalog | null; initial?: Partial<ReadOptions>; busy: boolean; onRead: (o: ReadOptions) => void; compact?: boolean
}) {
  const [o, setO] = useState<ReadOptions>({ script_type: '', language: '', translate_to: 'fr', second_pass: true, rotate: 0, scribe_key: '', ...initial })
  const set = (patch: Partial<ReadOptions>) => setO((x) => ({ ...x, ...patch }))
  const gemini = catalog?.engines.find((e) => e.id === 'gemini')
  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        <label className="block"><span className="label">Type d’écriture</span>
          <select className="input" value={o.script_type ?? ''} onChange={(e) => set({ script_type: e.target.value })}>
            <option value="">Je ne sais pas (détection automatique)</option>
            {catalog?.scripts.filter((s) => s.id !== 'unknown').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Langue</span>
          <select className="input" value={o.language ?? ''} onChange={(e) => set({ language: e.target.value })}>
            <option value="">Détection automatique</option>
            {catalog?.languages.filter((l) => l.id !== 'unknown').map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Traduire en</span>
          <select className="input" value={o.translate_to ?? ''} onChange={(e) => set({ translate_to: e.target.value || null })}>
            <option value="fr">Français</option><option value="en">Anglais</option><option value="">Pas de traduction</option>
          </select>
        </label>
        <label className="block"><span className="label">Orientation de la copie de travail</span>
          <select className="input" value={o.rotate ?? 0} onChange={(e) => set({ rotate: Number(e.target.value) })}>
            <option value={0}>Telle quelle</option><option value={90}>Tourner d’un quart de tour (→)</option><option value={180}>À l’envers</option><option value={270}>Tourner d’un quart de tour (←)</option>
          </select>
        </label>
        <label className="block"><span className="label">Même registre / même main (facultatif)</span>
          <input className="input" value={o.scribe_key ?? ''} onChange={(e) => set({ scribe_key: e.target.value })} placeholder="ex. BMS Villers 1648-1660" />
        </label>
        <label className="flex items-center gap-2.5 self-end rounded-xl bg-ivory-100 px-3 py-2.5 text-[13.5px]">
          <input type="checkbox" className="h-4 w-4 accent-ios-violet" checked={o.second_pass ?? true} onChange={(e) => set({ second_pass: e.target.checked })} />
          Relire les passages difficiles en agrandi (≤ {catalog?.max_second_pass ?? 6} appels)
        </label>
      </div>
      {gemini && !gemini.available && <p className="rounded-xl bg-conf-orange/10 px-3 py-2 text-[13px] text-night-900">{gemini.reason} Vous pouvez aussi utiliser le mode copier-coller ci-dessous.</p>}
      <button type="button" className="btn-gold w-full sm:w-auto" disabled={busy || (gemini ? !gemini.available : false)}
        onClick={() => onRead({ ...o, script_type: o.script_type || null, language: o.language || null, scribe_key: o.scribe_key || null })}>
        {busy ? <Spinner /> : <ScanText size={16} />}{busy ? 'Lecture en cours… (jusqu’à une minute)' : 'Lire le document'}
      </button>
      <p className="text-[12px] text-mist-500">L’image originale n’est jamais modifiée : seule une copie est préparée (contraste, orientation) puis envoyée au modèle de lecture.</p>
    </div>
  )
}

/** Mode copier-coller (abonnement claude.ai / chatgpt.com) : rien n'est envoyé automatiquement. */
export function ManualRead({ mediaId, busy, onSubmit }: { mediaId: string; busy: boolean; onSubmit: (text: string) => void }) {
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  const load = async () => { const p = await paleoApi.manualPrompt(mediaId); setPrompt(p.prompt); return p.prompt }
  const copy = async () => { const t = prompt || await load(); try { await navigator.clipboard.writeText(t); setCopied(true) } catch { setCopied(false) } }
  return (
    <details className="rounded-2xl border border-[var(--hairline)] bg-ivory-50 p-3">
      <summary className="cursor-pointer text-[14px] font-medium text-night-900">Lire avec Claude ou ChatGPT (copier-coller, votre abonnement)</summary>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13.5px] text-night-900">
        <li>Copiez la consigne : <button type="button" className="btn-ghost !py-1 text-[13px]" onClick={() => void copy()}><ClipboardCopy size={14} />{copied ? 'Copiée' : 'Copier la consigne'}</button></li>
        <li>Ouvrez <button type="button" className="text-ios-blue underline" onClick={() => openExternal('https://claude.ai/new')}>claude.ai <ExternalLink size={12} className="inline" /></button> ou <button type="button" className="text-ios-blue underline" onClick={() => openExternal('https://chatgpt.com/')}>chatgpt.com <ExternalLink size={12} className="inline" /></button>, collez la consigne et joignez l’image originale (<a className="text-ios-blue underline" href={paleoApi.fileUrl(mediaId)} target="_blank" rel="noreferrer">télécharger</a>).</li>
        <li>Collez ici sa réponse complète :
          <textarea className="input mt-1 min-h-[110px] font-mono !text-[12.5px]" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="{ … }" />
        </li>
      </ol>
      <button type="button" className="btn-primary mt-2 !py-1.5 text-[13.5px]" disabled={busy || !answer.trim()} onClick={() => onSubmit(answer)}>{busy ? <Spinner /> : <Sparkles size={14} />}Intégrer la réponse</button>
    </details>
  )
}

const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`)

/** Mesure de qualité sur un texte de référence vérifié (CER / WER). */
export function QualityPanel({ readingId, refs }: { readingId: string; refs: ReferenceInfo[] }) {
  const [refId, setRefId] = useState('')
  const [text, setText] = useState('')
  const [rep, setRep] = useState<BenchmarkReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async () => {
    setBusy(true); setErr(null)
    try { setRep(await paleoApi.benchmark(refId ? { reading_id: readingId, ref_id: refId } : { reading_id: readingId, reference_text: text })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <details className="panel p-4">
      <summary className="flex cursor-pointer items-center gap-2 font-display text-[17px] text-night-900"><Gauge size={17} className="text-ios-blue" />Mesurer la qualité de la lecture (avancé)</summary>
      <p className="mt-2 text-[13px] text-mist-500">Comparez la lecture à une transcription <strong>vérifiée par un humain</strong>. Le taux d’erreur par caractère (CER) et par mot (WER) indique la part du texte à corriger : 0 % = parfait.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label">Texte de référence enregistré</span>
          <select className="input" value={refId} onChange={(e) => setRefId(e.target.value)}>
            <option value="">— je colle ma propre transcription —</option>
            {refs.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        {!refId && <label className="block sm:col-span-2"><span className="label">Ma transcription vérifiée (une ligne du document par ligne)</span>
          <textarea className="input min-h-[90px] font-display" value={text} onChange={(e) => setText(e.target.value)} /></label>}
      </div>
      <button type="button" className="btn-primary mt-3 !py-1.5 text-[13.5px]" disabled={busy || (!refId && !text.trim())} onClick={() => void run()}>{busy ? <Spinner /> : <Gauge size={14} />}Calculer</button>
      {err && <p className="mt-2 text-[13px] text-conf-red">{err}</p>}
      {rep && (
        <div className="mt-3 space-y-2">
          {rep.synthetic && <p className="rounded-lg bg-conf-orange/10 px-2.5 py-1.5 text-[12.5px]">Référence SYNTHÉTIQUE (texte inventé pour les tests) : ce résultat ne mesure pas la lecture d’une vraie écriture ancienne.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Erreurs / caractère (CER)', rep.cer], ['Erreurs / mot (WER)', rep.wer], ['CER normalisé', rep.cer_normalized], ['WER normalisé', rep.wer_normalized]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-ivory-100 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-mist-500">{l as string}</div><div className="font-display text-[20px] text-night-900">{pct(v as number | null)}</div></div>
            ))}
          </div>
          <p className="text-[12px] text-mist-500">{rep.explanation}</p>
          <details><summary className="cursor-pointer text-[13px]">Détail ligne par ligne</summary>
            <ul className="mt-1 space-y-1 text-[12.5px]">{rep.lines.map((l) => <li key={l.n} className="rounded-lg bg-white px-2 py-1 ring-1 ring-ivory-200"><span className="text-mist-500">{l.n}.</span> {pct(l.cer)} — <span className="text-mist-500">réf.</span> {l.reference} <span className="text-mist-500">/ lu</span> {l.hypothesis}</li>)}</ul>
          </details>
        </div>
      )}
    </details>
  )
}
