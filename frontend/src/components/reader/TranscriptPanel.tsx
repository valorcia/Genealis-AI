import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleHelp, Pencil, ScanSearch, Sparkles, UserRound, X } from 'lucide-react'
import type { Reading, ReadingLine, UncertainPassage } from '../../lib/paleoApi'
import { Spinner } from '../ui'

export type Layer = 'diplomatic' | 'normalized'

const SP_LABEL: Record<string, string> = {
  concordant: 'Deuxième lecture agrandie : même résultat (reste à vérifier)',
  discordant: 'Deuxième lecture agrandie : résultat différent',
  undecided: 'Deuxième lecture agrandie : impossible de trancher',
}

function markClass(u: UncertainPassage): string {
  if (u.status === 'human_verified') return 'bg-sage-300/40 decoration-sage-500'
  if (u.status === 'second_pass_concordant') return 'bg-gold-400/20 decoration-gold-500'
  return 'bg-conf-orange/25 decoration-conf-orange'
}

/** Texte d'une ligne avec les passages incertains surlignés (cliquables). */
function LineText({ text, passages, onPassage, active }: { text: string; passages: UncertainPassage[]; onPassage: (i: number) => void; active: number | null }) {
  const spans: { start: number; end: number; i: number }[] = []
  passages.forEach((u, i) => {
    if (!u.text) return
    let from = 0
    let at = -1
    while ((at = text.indexOf(u.text, from)) !== -1) {
      if (!spans.some((s) => at < s.end && at + u.text.length > s.start)) { spans.push({ start: at, end: at + u.text.length, i }); break }
      from = at + 1
    }
  })
  spans.sort((a, b) => a.start - b.start)
  const out: ReactNode[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start > pos) out.push(<Fragment key={`t${pos}`}>{text.slice(pos, s.start)}</Fragment>)
    const u = passages[s.i]
    out.push(
      <mark key={`m${s.start}`} role="button" tabIndex={0} title="Lecture incertaine : cliquez pour voir les autres lectures possibles"
        onClick={(e) => { e.stopPropagation(); onPassage(s.i) }} onKeyDown={(e) => { if (e.key === 'Enter') onPassage(s.i) }}
        className={`cursor-pointer rounded px-0.5 text-night-900 underline decoration-dotted decoration-2 underline-offset-[3px] ${markClass(u)} ${active === s.i ? 'ring-2 ring-conf-orange/60' : ''}`}>
        {text.slice(s.start, s.end)}
      </mark>,
    )
    pos = s.end
  }
  if (pos < text.length) out.push(<Fragment key="end">{text.slice(pos)}</Fragment>)
  return <>{out.length ? out : <span className="text-mist-400">(ligne vide)</span>}</>
}

function PassageDetail({ u, onRecheck, onChoose, busy, close }: { u: UncertainPassage; onRecheck: () => void; onChoose: (alt: string) => void; busy: boolean; close: () => void }) {
  const ranked = u.ranked ?? u.alternatives.map((a) => ({ text: a, confidence: null, source: 'first_pass' as const }))
  return (
    <div className="mt-2 rounded-xl border border-conf-orange/35 bg-white p-3 text-[13.5px] shadow-sm" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-night-900">Lecture proposée : « {u.text} »{u.status === 'human_verified' && <span className="ml-1.5 chip conf-green">vérifiée par vous</span>}</div>
          <div className="text-mist-500">{u.reason ?? 'passage difficile'} · confiance de la machine : {Math.round((u.confidence ?? 0) * 100)} %</div>
        </div>
        <button type="button" className="btn-ghost !p-1.5" aria-label="Fermer" onClick={close}><X size={14} /></button>
      </div>
      {u.second_pass && <p className="mt-1.5 rounded-lg bg-ivory-100 px-2 py-1 text-[12.5px] text-night-800"><ScanSearch size={13} className="mr-1 inline text-gold-600" />{SP_LABEL[u.second_pass.status] ?? u.second_pass.status}{u.second_pass.notes ? ` — ${u.second_pass.notes}` : ''}</p>}
      {ranked.length > 0 ? (
        <div className="mt-2">
          <div className="label !mb-1">Autres lectures possibles (de la plus probable à la moins probable)</div>
          <ul className="space-y-1">
            {ranked.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[15px] text-night-900">« {r.text} »</span>
                <span className="text-[11.5px] text-mist-500">{r.source === 'second_pass' ? 'relecture agrandie' : 'première lecture'}{r.confidence != null ? ` · ${Math.round(r.confidence * 100)} %` : ''}</span>
                <button type="button" className="btn-ghost ml-auto !px-2 !py-1 text-[12px]" onClick={() => onChoose(r.text)}><Check size={13} />C’est ce que je lis</button>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="mt-2 text-mist-500">Aucune autre lecture proposée.</p>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" className="btn-gold !py-1.5 text-[13px]" disabled={busy} onClick={onRecheck}>{busy ? <Spinner /> : <ScanSearch size={14} />}Relire ce passage agrandi</button>
      </div>
      <p className="mt-2 text-[11.5px] text-mist-500">Une lecture n’est jamais certaine tant que vous ne l’avez pas comparée à l’image.</p>
    </div>
  )
}

function LineEditor({ initial, onSave, onCancel, busy }: { initial: string; onSave: (t: string, note: string) => void; onCancel: () => void; busy: boolean }) {
  const [text, setText] = useState(initial)
  const [note, setNote] = useState('')
  return (
    <div className="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <textarea className="input min-h-[72px] font-display !text-[15px]" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Correction de la ligne" />
      <input className="input !py-1.5 !text-[13px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif) : pourquoi cette correction ?" />
      <div className="flex gap-1.5">
        <button type="button" className="btn-primary !py-1.5 text-[13px]" disabled={busy || text === initial} onClick={() => onSave(text, note)}>{busy ? <Spinner /> : <Check size={14} />}Enregistrer ma correction</button>
        <button type="button" className="btn-ghost !py-1.5 text-[13px]" onClick={onCancel}>Annuler</button>
      </div>
      <p className="text-[11.5px] text-mist-500">Votre correction est conservée et servira à mieux lire les autres pages de la même main.</p>
    </div>
  )
}

interface Props {
  reading: Reading
  layer: Layer
  onLayer: (l: Layer) => void
  selectedLine: number | null
  onSelectLine: (n: number, passage?: number | null) => void
  activePassage: { line: number; index: number } | null
  onCorrect: (n: number, text: string, layer: Layer, note?: string) => Promise<void>
  onRecheck: (n: number, index: number) => Promise<void>
  busy: string | null
  onShowOnImage?: (n: number) => void
}

export function TranscriptPanel({ reading, layer, onLayer, selectedLine, onSelectLine, activePassage, onCorrect, onRecheck, busy, onShowOnImage }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (selectedLine == null) return
    listRef.current?.querySelector(`[data-line="${selectedLine}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedLine])
  const hasNormalized = reading.lines.some((l) => l.normalized)

  const choose = async (ln: ReadingLine, u: UncertainPassage, alt: string) => {
    const at = ln.diplomatic.indexOf(u.text)
    const next = at >= 0 ? ln.diplomatic.slice(0, at) + alt + ln.diplomatic.slice(at + u.text.length) : ln.diplomatic
    await onCorrect(ln.n, next, 'diplomatic', `Lecture choisie par l’utilisateur pour « ${u.text} » : « ${alt} »`)
  }

  return (
    <section className="panel flex min-h-0 flex-col p-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="font-display text-[18px] text-night-900">Transcription</h2>
        <div className="flex gap-1 rounded-xl bg-ivory-200/70 p-1" role="tablist" aria-label="Version de la transcription">
          {([['diplomatic', 'Fidèle (diplomatique)'], ['normalized', 'Modernisée']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={layer === k} disabled={k === 'normalized' && !hasNormalized} onClick={() => onLayer(k)}
              className={`min-h-8 cursor-pointer rounded-lg px-2.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40 ${layer === k ? 'bg-white font-medium text-night-900 shadow-sm' : 'text-mist-500'}`}>{l}</button>
          ))}
        </div>
      </header>
      <p className="border-b border-[var(--hairline)] bg-ivory-100/70 px-4 py-2 text-[12.5px] text-mist-500">
        {layer === 'diplomatic' ? 'Fidèle au document : orthographe et abréviations d’origine. Les passages surlignés en orange sont incertains.' : 'Version modernisée : abréviations développées, orthographe actuelle. Elle s’appuie sur la lecture fidèle, qui fait foi.'}
      </p>
      {reading.lines.length === 0 ? <p className="p-4 text-sm text-mist-500">Aucune ligne lue.</p> : (
        <ol ref={listRef} className="min-h-0 flex-1 divide-y divide-[var(--hairline)] overflow-auto scrollbar-thin">
          {reading.lines.map((ln) => {
            const sel = selectedLine === ln.n
            const passIdx = activePassage?.line === ln.n ? activePassage.index : null
            const txt = layer === 'normalized' ? (ln.normalized ?? ln.diplomatic) : ln.diplomatic
            const human = ln.human?.[layer]
            return (
              <li key={ln.n} data-line={ln.n} onClick={() => onSelectLine(ln.n)}
                className={`group cursor-pointer px-3 py-2.5 transition-colors sm:px-4 ${sel ? 'bg-ios-violet/[0.06]' : 'hover:bg-ivory-100/80'}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`mt-0.5 w-6 shrink-0 text-right text-[11.5px] tabular-nums ${sel ? 'font-semibold text-ios-violet' : 'text-mist-400'}`}>{ln.n}</span>
                  <div className="min-w-0 flex-1">
                    {editing === ln.n ? (
                      <LineEditor initial={txt} busy={busy === `c${ln.n}`} onCancel={() => setEditing(null)}
                        onSave={async (t, note) => { await onCorrect(ln.n, t, layer, note || undefined); setEditing(null) }} />
                    ) : (
                      <p className={`whitespace-pre-wrap break-words font-display text-[15.5px] leading-relaxed ${layer === 'normalized' && !ln.normalized ? 'text-mist-500' : 'text-night-900'}`}>
                        {layer === 'diplomatic' ? <LineText text={ln.diplomatic} passages={ln.uncertain} active={passIdx} onPassage={(i) => onSelectLine(ln.n, i)} /> : txt}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {human && <span className="chip conf-green"><UserRound size={11} />corrigée par vous</span>}
                      {ln.uncertain.filter((u) => u.status !== 'human_verified').length > 0 && <span className="chip conf-orange"><CircleHelp size={11} />{ln.uncertain.filter((u) => u.status !== 'human_verified').length} passage(s) incertain(s)</span>}
                      {!ln.bbox && <span className="chip conf-grey">position inconnue sur l’image</span>}
                      {editing !== ln.n && (
                        <span className={`ml-auto flex gap-1 ${sel ? '' : 'sm:opacity-0 sm:group-hover:opacity-100'}`}>
                          {onShowOnImage && ln.bbox && <button type="button" className="btn-ghost !px-2 !py-0.5 text-[12px] lg:hidden" onClick={(e) => { e.stopPropagation(); onShowOnImage(ln.n) }}>Voir sur l’image</button>}
                          <button type="button" className="btn-ghost !px-2 !py-0.5 text-[12px]" onClick={(e) => { e.stopPropagation(); setEditing(ln.n) }}><Pencil size={12} />Corriger</button>
                        </span>
                      )}
                    </div>
                    {ln.suggestions?.map((s, i) => (
                      <div key={i} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-gold-500/8 px-2 py-1.5 text-[12.5px] text-night-900">
                        <Sparkles size={13} className="text-gold-600" />{s.message}
                        <button type="button" className="btn-ghost !px-2 !py-0.5 text-[12px]" onClick={(e) => {
                          e.stopPropagation()
                          const re = new RegExp(`(?<![\\p{L}\\p{N}])${s.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')
                          void onCorrect(ln.n, ln.diplomatic.replace(re, s.after), 'diplomatic', 'Correction de la même main appliquée par l’utilisateur')
                        }}>Je vérifie et j’applique</button>
                      </div>
                    ))}
                    {passIdx != null && ln.uncertain[passIdx] && (
                      <PassageDetail u={ln.uncertain[passIdx]} busy={busy === `r${ln.n}-${passIdx}`} close={() => onSelectLine(ln.n, null)}
                        onRecheck={() => void onRecheck(ln.n, passIdx)} onChoose={(alt) => void choose(ln, ln.uncertain[passIdx], alt)} />
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
