import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type PersonSummary, type TreeNode } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { AddRelativeSheet } from '../../components/relatives/AddRelative'
import { FigureSvg } from '../../components/charts/Avatar'
import PanZoomCanvas from '../../components/charts/PanZoomCanvas'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { sosaIndex, useAncestors } from '../../components/charts/family'
import { birthText, deathAge, deathText, fitText, fullName, GRAPH_COLOR, nameParts, sexKey } from '../../components/charts/format'
import { arc, lighten, polar, sector, upperHalf, wrap } from '../../components/charts/svg'
import { Spinner } from '../../components/ui'

type Sweep = 180 | 270 | 360
interface FanOpts { gens: number; sweep: Sweep; places: boolean; dates: boolean; photo: boolean; colors: 'branche' | 'sexe' }
const DEFAULTS: FanOpts = { gens: 4, sweep: 360, places: true, dates: true, photo: true, colors: 'branche' }

const R0 = 128
const ringWidth = (g: number) => (g === 1 ? 104 : g === 2 ? 96 : g === 3 ? 88 : g === 4 ? 118 : 108)
const PATERNAL = '#c9ecb0', MATERNAL = '#ddcaf6', MALE = '#cfe0ff', FEMALE = '#fbd5e2'

interface Seg { sosa: number; gen: number; a1: number; a2: number; r1: number; r2: number; person: TreeNode | null; childKnown: boolean; fill: string }

function segmentsFor(bySosa: Map<number, TreeNode>, gens: number, sweep: Sweep, colors: FanOpts['colors']) {
  const a0 = sweep === 270 ? 135 : 180
  const segs: Seg[] = []
  let r = R0
  for (let g = 1; g < gens; g++) {
    const w = ringWidth(g)
    const n = 2 ** g
    const step = sweep / n
    for (let i = 0; i < n; i++) {
      const sosa = n + i
      const person = bySosa.get(sosa) ?? null
      const t = (g - 1) / Math.max(1, gens - 1) * 0.62
      const base = colors === 'sexe' ? (person ? (person.sex === 'F' ? FEMALE : person.sex === 'M' ? MALE : '#e7e9ee') : '#ffffff') : (i < n / 2 ? PATERNAL : MATERNAL)
      segs.push({ sosa, gen: g, a1: a0 + i * step, a2: a0 + (i + 1) * step, r1: r, r2: r + w, person, childKnown: bySosa.has(sosa >> 1), fill: person ? lighten(base, t) : '#ffffff' })
    }
    r += w
  }
  return { segs, R: r }
}

const Segment = memo(function Segment({ s, opts, onPick, onAdd }: { s: Seg; opts: FanOpts; onPick: (p: PersonSummary) => void; onAdd: (sosa: number) => void }) {
  const mid = (s.a1 + s.a2) / 2
  const span = s.a2 - s.a1
  const rm = (s.r1 + s.r2) / 2
  const arcLen = (rm * span * Math.PI) / 180
  const id = `fan-${s.sosa}`
  if (!s.person) {
    const canAdd = s.childKnown
    const p = polar(rm, mid)
    return (
      <g className={canAdd ? 'cursor-pointer' : ''} onClick={canAdd ? () => onAdd(s.sosa) : undefined}>
        <path d={sector(s.r1 + 1.5, s.r2 - 1.5, s.a1 + 0.25, s.a2 - 0.25)} fill={canAdd ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)'} stroke={canAdd ? '#b9bfcc' : '#dfe2e8'} strokeWidth={1.2} strokeDasharray="5 4" />
        {canAdd && arcLen > 26 && (
          <g transform={`translate(${p.x},${p.y})`}>
            <circle r={10} fill="#ffffff" stroke="#2f6fd1" strokeWidth={1.4} />
            <path d="M-4.5,0 H4.5 M0,-4.5 V4.5" stroke="#2f6fd1" strokeWidth={1.8} strokeLinecap="round" />
            {arcLen > 70 && <text y={24} textAnchor="middle" fontSize={10} fill="#8b92a1">inconnu</text>}
            <title>{s.sosa % 2 === 0 ? 'Père inconnu' : 'Mère inconnue'} : ajouter</title>
          </g>
        )}
      </g>
    )
  }
  const p = s.person
  const { given, surname } = nameParts(p)
  const b = birthText(p), d = deathText(p), age = deathAge(p)
  const curved = arcLen >= 120
  let content: ReactNode
  if (curved) {
    const nameF = s.gen === 1 ? 16 : s.gen === 2 ? 14 : 12.5
    const detF = s.gen === 1 ? 10.5 : s.gen === 2 ? 9.8 : 9
    const lines: { text: string; size: number; weight: number; color: string }[] = [{ text: `${given} ${surname}`.trim(), size: nameF, weight: 600, color: '#111827' }]
    if (opts.dates && b) lines.push({ text: `Naissance  ${b}`, size: detF, weight: 400, color: '#374151' })
    if (opts.places && p.birth_place) lines.push({ text: p.birth_place, size: detF, weight: 400, color: '#4b5563' })
    if (opts.dates && d) lines.push({ text: `Décès  ${d}${age ? ` (${age})` : ''}`, size: detF, weight: 400, color: '#374151' })
    if (opts.places && p.death_place) lines.push({ text: p.death_place, size: detF, weight: 400, color: '#4b5563' })
    const top = upperHalf(mid)
    const pad = 7
    let acc = 0
    const kept = lines.filter((l) => { const h = l.size * 1.22; if (acc + h > s.r2 - s.r1 - pad * 2) return false; acc += h; return true })
    let base = top ? s.r2 - pad : s.r1 + pad
    content = kept.map((l, i) => {
      const h = l.size * 1.22
      const r = top ? base - l.size : base + l.size * 0.98
      base = top ? base - h : base + h
      const avail = (r * (span - 2) * Math.PI) / 180
      return (
        <g key={i}>
          <path id={`${id}-${i}`} d={arc(r, s.a1 + 1, s.a2 - 1, !top)} fill="none" />
          <text fontSize={l.size} fontWeight={l.weight} fill={l.color} style={{ pointerEvents: 'none' }}>
            <textPath href={`#${id}-${i}`} startOffset="50%" textAnchor="middle">{fitText(l.text, avail, l.size)}</textPath>
          </text>
        </g>
      )
    })
  } else {
    // Étiquettes radiales (anneaux extérieurs) : lisibles de gauche à droite.
    const len = s.r2 - s.r1 - 12
    const flip = ((mid % 360) + 360) % 360 > 90 && ((mid % 360) + 360) % 360 < 270
    const rot = flip ? mid + 180 : mid
    const x = flip ? -rm : rm
    const fs = Math.max(7.5, Math.min(11, arcLen / 4.2))
    const lines = [given || surname, given ? surname : '', opts.dates && (p.birth_year || p.death_year) ? `${p.birth_year ?? '?'}–${p.death_year ?? ''}` : ''].filter(Boolean)
    const maxLines = Math.max(1, Math.floor((arcLen - 4) / (fs * 1.15)))
    const shown = lines.slice(0, maxLines)
    content = (
      <g transform={`rotate(${rot})`} style={{ pointerEvents: 'none' }}>
        {shown.map((t, i) => (
          <text key={i} x={x} y={(i - (shown.length - 1) / 2) * fs * 1.15 + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={i === 0 ? 600 : 400} fill={i === 2 ? '#4b5563' : '#111827'}>{fitText(t, len, fs)}</text>
        ))}
      </g>
    )
  }
  return (
    <g className="cursor-pointer" onClick={() => onPick(p)}>
      <path d={sector(s.r1, s.r2, s.a1, s.a2)} fill={s.fill} stroke="#ffffff" strokeWidth={2.5} className="transition-opacity hover:opacity-80" />
      <title>{`${fullName(p)}${b ? ` · ☆ ${b}` : ''}${d ? ` · † ${d}` : ''}${p.birth_place ? ` · ${p.birth_place}` : ''}  (Sosa ${s.sosa}) — toucher pour centrer`}</title>
      {content}
    </g>
  )
})

function CenterDisc({ p, opts }: { p: PersonSummary; opts: FanOpts }) {
  const b = birthText(p), d = deathText(p), age = deathAge(p)
  const lines: { t: string; bold?: boolean; size: number; color?: string }[] = []
  if (opts.dates || opts.places) {
    if (b || p.birth_place) {
      lines.push({ t: `Naissance  ${b ?? '—'}`, bold: true, size: 10.5 })
      if (opts.places && p.birth_place) wrap(p.birth_place, 36, 2).forEach((t) => lines.push({ t, size: 10, color: '#4b5563' }))
    }
    if (d || p.death_place) {
      lines.push({ t: `Décès  ${d ?? '—'}${age ? ` (${age})` : ''}`, bold: true, size: 10.5 })
      if (opts.places && p.death_place) wrap(p.death_place, 36, 2).forEach((t) => lines.push({ t, size: 10, color: '#4b5563' }))
    }
    if (!b && !d && p.age_display) lines.push({ t: p.age_display, size: 10.5 })
  }
  const startY = 6 - (lines.length * 13) / 2 + 12
  return (
    <g>
      <circle r={R0 - 8} fill="#ffffff" filter="url(#fan-shadow)" />
      <circle r={R0 - 8} fill="none" stroke="#e5e7eb" strokeWidth={1} />
      {opts.photo && (p.portrait_media_id
        ? <image href={api.mediaFileUrl(p.portrait_media_id)} x={-24} y={-R0 + 18} width={48} height={48} preserveAspectRatio="xMidYMid slice" clipPath="url(#fan-photo)" />
        : <FigureSvg sex={sexKey(p)} size={46} x={-23} y={-R0 + 18} />)}
      <text y={opts.photo ? -26 : -18} textAnchor="middle" fontSize={16} fontWeight={700} fill="#111827">{fitText(fullName(p), 2 * R0 - 40, 16)}</text>
      {lines.map((l, i) => <text key={i} y={startY + i * 13} textAnchor="middle" fontSize={l.size} fontWeight={l.bold ? 600 : 400} fill={l.color ?? '#1f2937'}>{l.t}</text>)}
    </g>
  )
}

export default function FanChartPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<FanOpts>('eventail', DEFAULTS)
  const { graph, loading, error, reload } = useAncestors(focusId, Math.max(1, opts.gens - 1))
  const [adding, setAdding] = useState<{ child: PersonSummary; kind: 'father' | 'mother' } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const bySosa = useMemo(() => sosaIndex(graph), [graph])
  const root = bySosa.get(1) ?? null
  const { segs, R } = useMemo(() => segmentsFor(bySosa, opts.gens, opts.sweep, opts.colors), [bySosa, opts.gens, opts.sweep, opts.colors])
  const pad = 14
  const bottom = opts.sweep === 360 ? R : opts.sweep === 270 ? Math.max(R0, R * Math.SQRT1_2) : R0
  const vb = { x: -R - pad, y: -R - pad, w: 2 * (R + pad), h: R + bottom + 2 * pad }
  const pz = usePanZoom({ contentSize: { w: vb.w, h: vb.h }, maxScale: 4 })

  const onPick = useCallback((p: PersonSummary) => setFocusId(p.id), [setFocusId])
  const onAdd = useCallback((sosa: number) => {
    const child = bySosa.get(sosa >> 1)
    if (child) setAdding({ child, kind: sosa % 2 === 0 ? 'father' : 'mother' })
  }, [bySosa])

  const name = focus ? fullName(focus) : ''
  const known = segs.filter((s) => s.person).length
  const help = (
    <HelpText title="Éventail généalogique">
      <p>La personne centrale est au cœur ; chaque anneau est une génération d’ancêtres. La branche <b>paternelle</b> est en vert, la branche <b>maternelle</b> en lilas, de plus en plus claires en s’éloignant.</p>
      <p>Touchez un ancêtre pour le placer au centre. Les cases en pointillés sont des ancêtres <b>inconnus</b> : touchez le « + » pour ajouter le père ou la mère.</p>
      <p>Dans les options : nombre de générations (2 à 7) et forme de l’éventail (demi-cercle, trois quarts, cercle complet).</p>
    </HelpText>
  )

  return (
    <ChartFrame title={`Éventail généalogique${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} help={help} persons={persons} focusId={focusId} onFocus={setFocusId}
      actions={<ChartActions exportTarget={() => svgRef.current} filename={`Éventail ${name}`} />}
      styleOptions={
        <OptionGroup title="Couleurs">
          <SegmentedRow value={opts.colors} onChange={(v) => setOpts({ colors: v })} options={[{ value: 'branche', label: 'Par branche' }, { value: 'sexe', label: 'Par sexe' }]} />
        </OptionGroup>
      }
      options={
        <>
          <OptionGroup title="Forme">
            <SliderRow label="Générations" value={opts.gens} min={2} max={7} onChange={(v) => setOpts({ gens: v })} />
            <SegmentedRow value={opts.sweep} onChange={(v) => setOpts({ sweep: v })} options={[{ value: 180, label: '180°' }, { value: 270, label: '270°' }, { value: 360, label: '360°' }]} />
          </OptionGroup>
          <OptionGroup title="Contenu">
            <ToggleRow label="Dates et âges" checked={opts.dates} onChange={(v) => setOpts({ dates: v })} />
            <ToggleRow label="Lieux" checked={opts.places} onChange={(v) => setOpts({ places: v })} />
            <ToggleRow label="Photo au centre" checked={opts.photo} onChange={(v) => setOpts({ photo: v })} />
          </OptionGroup>
        </>
      }>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <PanZoomCanvas pz={pz} width={vb.w} height={vb.h} fitKey={root ? `${root.id}:${opts.gens}:${opts.sweep}` : undefined} background="plain" maxFit={1.6}
          overlay={<>
            {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
            {root && !loading && <div className="absolute bottom-24 left-3 z-10 rounded-full bg-white/90 px-3 py-1 text-[11px] text-mist-500 shadow-sm ring-1 ring-black/5" data-nopan>{known} ancêtre{known > 1 ? 's' : ''} connu{known > 1 ? 's' : ''} sur {segs.length}</div>}
          </>}>
          <svg ref={svgRef} width={vb.w} height={vb.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
            <defs>
              <filter id="fan-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="7" floodColor="#1d2b50" floodOpacity="0.18" /></filter>
              <filter id="fan-ring-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#1d2b50" floodOpacity="0.14" /></filter>
              <clipPath id="fan-photo"><rect x={-24} y={-R0 + 18} width={48} height={48} rx={8} /></clipPath>
            </defs>
            {root && (
              <>
                <path d={opts.sweep === 360 ? sector(R0 - 2, R, 0, 360) : sector(R0 - 2, R, opts.sweep === 270 ? 135 : 180, opts.sweep === 270 ? 405 : 360)} fill="#ffffff" filter="url(#fan-ring-shadow)" />
                {segs.map((s) => <Segment key={s.sosa} s={s} opts={opts} onPick={onPick} onAdd={onAdd} />)}
                <CenterDisc p={root} opts={opts} />
              </>
            )}
          </svg>
        </PanZoomCanvas>
      )}
      {adding && (
        <AddRelativeSheet anchor={{ id: adding.child.id, display_name: adding.child.display_name, sex: adding.child.sex, surname: adding.child.surname }}
          choice={{ kind: adding.kind, label: adding.kind === 'father' ? 'Ajouter le père' : 'Ajouter la mère', group: 'parents' }} onClose={() => setAdding(null)} onAdded={() => reload()} />
      )}
    </ChartFrame>
  )
}

