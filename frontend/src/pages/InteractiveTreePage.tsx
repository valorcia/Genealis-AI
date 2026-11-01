import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crosshair, FileText, Plus, Sparkles, UserPlus, X } from 'lucide-react'
import { api, ApiError, type PersonSummary } from '../api'
import { pulseEngine, useApp } from '../store'
import ChartFrame from '../components/shell/ChartFrame'
import { useFocusPerson } from '../components/shell/useFocusPerson'
import { AddRelativeMenu, AddRelativeSheet } from '../components/relatives/AddRelative'
import { Avatar } from '../components/charts/Avatar'
import PanZoomCanvas from '../components/charts/PanZoomCanvas'
import { usePanZoom } from '../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SliderRow, ToggleRow, usePref } from '../components/charts/ChartTools'
import { childGroups, elbowPath, layoutDesc, layoutSosa, partnersOf, sosaIndex, useFamily, type FamilyIndex } from '../components/charts/family'
import { birthText, deathText, EDIT_COLOR, generationLabel, nameParts, PURPLE, yearRange } from '../components/charts/format'
import { Spinner } from '../components/ui'

const NODE_W = 128
const AV = 70
const NODE_H = 150
const GAP = 26
const PARTNER_GAP = 18
const ROW_H = 236
const BAND_LEFT = 168
const MAX_PARTNERS = 3

const BANDS = [
  { fill: 'linear-gradient(180deg,#f1d6fd,#e9c6fa)', edge: '#d7b0ee', ink: '#9a68c6' },
  { fill: 'linear-gradient(180deg,#d6dcff,#c8cffc)', edge: '#b3bdf3', ink: '#5d68cc' },
  { fill: 'linear-gradient(180deg,#d6f4e6,#c6eedb)', edge: '#a8dcc3', ink: '#33916b' },
  { fill: 'linear-gradient(180deg,#ffe6d3,#fddac0)', edge: '#f0c19c', ink: '#bb7440' },
]
const bandStyle = (rel: number) => BANDS[((rel % 4) + 4) % 4]

interface PNode { key: string; id: string | null; x: number; rel: number; person: PersonSummary | null; slot?: { childId: string; kind: 'father' | 'mother' } }
interface Layout { nodes: PNode[]; paths: { d: string; dashed: boolean }[]; bands: { rel: number; x: number; w: number; y: number; years: string }[]; w: number; h: number; focusPos: { x: number; y: number } | null }

const rowTop = (rel: number, maxUp: number) => 40 + (maxUp - rel) * ROW_H

type Conn = { kind: 'h'; x1: number; x2: number; y: number; dashed: boolean } | { kind: 'e'; x1: number; y1: number; x2: number; y2: number; dashed: boolean }

function buildLayout(ix: FamilyIndex, ancestors: ReturnType<typeof sosaIndex>, focusId: string, up: number, down: number, slots: boolean): Layout {
  const focus = ix.persons.get(focusId)
  if (!focus) return { nodes: [], paths: [], bands: [], w: 0, h: 0, focusPos: null }
  const nodes: PNode[] = []
  const conns: Conn[] = []
  const avY = (rel: number) => rowTop(rel, up) + AV / 2

  // 1) Ascendance (numérotation Sosa), centrée sur la personne de départ.
  const anc = layoutSosa(ancestors, up + 1, NODE_W, GAP, slots)
  const ancX = new Map<number, number>()
  for (const s of anc) {
    ancX.set(s.sosa, s.center)
    if (s.sosa === 1) continue
    const childId = ancestors.get(s.sosa >> 1)?.id ?? ''
    nodes.push({ key: `a${s.sosa}`, id: s.person?.id ?? null, x: s.center, rel: s.gen, person: s.person, slot: s.person ? undefined : { childId, kind: s.sosa % 2 === 0 ? 'father' : 'mother' } })
  }
  for (const s of anc) {
    if (!s.person) continue
    const fx = ancX.get(2 * s.sosa), mx = ancX.get(2 * s.sosa + 1)
    if (fx === undefined && mx === undefined) continue
    const rel = s.gen + 1
    const childTop = rowTop(s.gen, up) - 4
    const fReal = ancestors.has(2 * s.sosa), mReal = ancestors.has(2 * s.sosa + 1)
    if (fx !== undefined && mx !== undefined) {
      conns.push({ kind: 'h', x1: fx, x2: mx, y: avY(rel), dashed: !(fReal && mReal) })
      conns.push({ kind: 'e', x1: (fx + mx) / 2, y1: avY(rel), x2: s.center, y2: childTop, dashed: !(fReal || mReal) })
    } else {
      conns.push({ kind: 'e', x1: (fx ?? mx) as number, y1: rowTop(rel, up) + NODE_H - 6, x2: s.center, y2: childTop, dashed: !(fReal || mReal) })
    }
  }

  // 2) Descendance, avec les conjoints de chaque personne sur la même ligne.
  const shownPartners = (id: string) => partnersOf(ix, id).slice(0, MAX_PARTNERS)
  const blockOf = (id: string) => { const n = shownPartners(id).length; return NODE_W * (1 + n) + PARTNER_GAP * n }
  const order = (id: string) => { const p = ix.persons.get(id); const ps = shownPartners(id); return p?.sex === 'F' ? [...ps, id] : [id, ...ps] }
  const offsetIn = (id: string, who: string) => { const o = order(id); const i = o.indexOf(who); return i * (NODE_W + PARTNER_GAP) + NODE_W / 2 - blockOf(id) / 2 }
  const kidsOf = (id: string) => childGroups(ix, id, shownPartners(id)).flatMap((g) => g.kids)
  const desc = layoutDesc(focusId, kidsOf, blockOf, GAP, down)
  const placed = new Map(desc.map((d) => [d.id, d]))
  const shift = -offsetIn(focusId, focusId)
  const xOf = new Map<string, number>()
  for (const d of desc) {
    const bc = d.center + shift
    for (const who of order(d.id)) {
      const x = bc + offsetIn(d.id, who)
      if (who === d.id) xOf.set(d.id, x); else xOf.set(`${d.id}|${who}`, x)
      if (who === focusId && d.depth === 0) continue
      nodes.push({ key: who === d.id ? `d${who}` : `p${d.id}-${who}`, id: who, x, rel: -d.depth, person: ix.persons.get(who) ?? null })
    }
  }
  nodes.push({ key: `f${focusId}`, id: focusId, x: 0, rel: 0, person: focus })
  for (const d of desc) {
    const x = xOf.get(d.id) as number
    const rel = -d.depth
    for (const p of shownPartners(d.id)) { const px = xOf.get(`${d.id}|${p}`); if (px !== undefined) conns.push({ kind: 'h', x1: x, x2: px, y: avY(rel), dashed: false }) }
    if (d.depth >= down) continue
    for (const g of childGroups(ix, d.id, shownPartners(d.id))) {
      const px = g.partner ? xOf.get(`${d.id}|${g.partner}`) : undefined
      const sx = px !== undefined ? (x + px) / 2 : x
      const sy = px !== undefined ? avY(rel) : rowTop(rel, up) + NODE_H - 6
      for (const k of g.kids) {
        const kx = xOf.get(k)
        if (kx !== undefined && placed.get(k)?.parent === d.id) conns.push({ kind: 'e', x1: sx, y1: sy, x2: kx, y2: rowTop(rel - 1, up) - 4, dashed: false })
      }
    }
  }

  // 3) Bandes de génération, puis translation pour que tout soit en coordonnées positives.
  const rels = [...new Set(nodes.map((n) => n.rel))].sort((a, b) => b - a)
  const bands = rels.map((rel) => {
    const row = nodes.filter((n) => n.rel === rel)
    const xs = row.map((n) => n.x)
    const x0 = Math.min(...xs) - NODE_W / 2 - BAND_LEFT, x1 = Math.max(...xs) + NODE_W / 2 + 26
    return { rel, x: x0, w: x1 - x0, y: rowTop(rel, up) - 22, years: yearRange(row.map((n) => n.person).filter((p): p is PersonSummary => !!p)) }
  })
  const minX = Math.min(...bands.map((b) => b.x)) - 30
  const maxX = Math.max(...bands.map((b) => b.x + b.w)) + 30
  const tx = -minX
  for (const n of nodes) n.x += tx
  for (const b of bands) b.x += tx
  const paths = conns.map((c) => ({ dashed: c.dashed, d: c.kind === 'h' ? `M${c.x1 + tx},${c.y} H${c.x2 + tx}` : elbowPath(c.x1 + tx, c.y1, c.x2 + tx, c.y2, 14) }))
  const minRel = Math.min(...rels)
  return { nodes, paths, bands, w: maxX - minX, h: rowTop(minRel, up) + NODE_H + 60, focusPos: { x: tx, y: rowTop(0, up) + NODE_H / 2 } }
}

const TreeNodeView = memo(function TreeNodeView({ node, top, selected, isFocus, showDates, showAges, onPick, onSlot }: {
  node: PNode; top: number; selected: boolean; isFocus: boolean; showDates: boolean; showAges: boolean
  onPick: (p: PersonSummary) => void; onSlot: (childId: string, kind: 'father' | 'mother') => void
}) {
  if (!node.person) {
    const label = node.slot?.kind === 'father' ? 'Père inconnu' : 'Mère inconnue'
    return (
      <button className="absolute flex flex-col items-center text-center" style={{ left: node.x - NODE_W / 2, top, width: NODE_W }} onClick={() => node.slot && onSlot(node.slot.childId, node.slot.kind)} title={`${label} : ajouter`}>
        <span className="flex items-center justify-center rounded-full border-2 border-dashed border-[#9c8fd8] bg-white/60 text-2xl font-light text-[#7d6fc4]" style={{ width: AV - 8, height: AV - 8, marginTop: 4 }}>?</span>
        <span className="mt-2 text-[11.5px] text-[#6d63a8]">{label}</span>
        <span className="mt-1 inline-flex items-center gap-0.5 rounded-full bg-white/80 px-2 py-0.5 text-[10.5px] font-medium text-[#2f6fd1] shadow-sm"><Plus size={11} /> Ajouter</span>
      </button>
    )
  }
  const p = node.person
  const { given, surname } = nameParts(p)
  const b = birthText(p), d = deathText(p)
  return (
    <div role="button" tabIndex={0} onClick={() => onPick(p)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(p) }}
      className="group absolute flex cursor-pointer flex-col items-center text-center outline-none" style={{ left: node.x - NODE_W / 2, top, width: NODE_W }}>
      {(selected || isFocus) && <span className={`absolute left-1/2 -translate-x-1/2 rounded-full ${selected ? 'bg-[#fdf2df] shadow-[0_10px_30px_-10px_rgba(120,80,40,0.45)] ring-1 ring-[#f1dcb8]' : 'bg-white/45'}`} style={{ width: 150, height: 150, top: -14 }} />}
      <span className="relative transition-transform group-hover:-translate-y-0.5"><Avatar person={p} size={AV} shape="square" /></span>
      <span className="relative mt-1 w-full px-1 text-[12.5px] leading-[1.18] text-night-900">
        <span className="block truncate">{given}</span>
        <span className="block truncate font-medium tracking-wide">{surname}</span>
      </span>
      {showDates && (b || d) && (
        <span className="relative mt-0.5 text-[10.5px] leading-[1.3] tabular-nums text-night-900/60">
          {b && <span className="block">☆{b}</span>}
          {d && <span className="block">†{d}</span>}
        </span>
      )}
      {showAges && p.age_display && <span className="relative mt-0.5 text-[10px] text-night-900/45">{p.age_display}{p.age_context === "aujourd'hui" ? '' : ''}</span>}
    </div>
  )
})

export default function InteractiveTreePage() {
  const nav = useNavigate()
  const notify = useApp((s) => s.notify)
  const { persons, focus, focusId, setFocusId, loading: personsLoading, reload: reloadPersons } = useFocusPerson()
  const [opts, setOpts] = usePref('interactif', { up: 3, down: 2, showDates: true, showAges: true, slots: true })
  const { data, loading, error, reload } = useFamily(focusId, opts.up, opts.down)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [slotAdd, setSlotAdd] = useState<{ child: PersonSummary; kind: 'father' | 'mother' } | null>(null)
  const [busyAi, setBusyAi] = useState(false)

  const layout = useMemo(() => {
    if (!data || !focusId || !data.index.persons.has(focusId)) return null
    return buildLayout(data.index, sosaIndex(data.ancestors), focusId, opts.up, opts.down, opts.slots)
  }, [data, focusId, opts.up, opts.down, opts.slots])

  const pz = usePanZoom({ contentSize: layout ? { w: layout.w, h: layout.h } : undefined, minScale: 0.05, maxScale: 2.5 })
  const centerFocus = useCallback(() => {
    if (!layout?.focusPos || !pz.viewportRef.current) return
    const vw = pz.viewportRef.current.clientWidth
    pz.centerOn(layout.focusPos.x, layout.focusPos.y - 40, Math.max(0.45, Math.min(1, vw / 560)))
  }, [layout, pz])
  const fitKey = layout && data?.focus?.id === focusId ? `${focusId}:${opts.up}` : undefined

  const pick = useCallback((p: PersonSummary) => { setSelected(p.id); setMenu(true) }, [])
  const onSlot = useCallback((childId: string, kind: 'father' | 'mother') => {
    const child = data?.index.persons.get(childId)
    if (child) setSlotAdd({ child, kind })
  }, [data])

  const selectedPerson = selected ? data?.index.persons.get(selected) ?? persons.find((p) => p.id === selected) ?? null : null
  const afterAdd = useCallback(() => { reload(); reloadPersons() }, [reload, reloadPersons])
  const runAi = async (p: PersonSummary) => {
    setBusyAi(true)
    try {
      const tasks = await api.explore(p.id, 2)
      pulseEngine()
      notify('success', tasks.length ? `Recherche IA lancée pour ${p.display_name} (${tasks.length} tâche${tasks.length > 1 ? 's' : ''}).` : `La recherche IA est déjà en cours pour ${p.display_name}.`)
    } catch (e) { notify('error', e instanceof ApiError ? e.message : 'Impossible de lancer la recherche IA.') } finally { setBusyAi(false) }
  }

  const titleName = focus ? `${nameParts(focus).given} ${nameParts(focus).surname}`.trim() : ''
  const help = (
    <HelpText title="Arbre interactif">
      <p>L’arbre se construit autour de la personne centrale : ses ancêtres au-dessus, ses enfants et petits-enfants en dessous, chaque génération dans une bande colorée avec ses années de naissance.</p>
      <p>Touchez une personne pour la sélectionner et <b>ajouter des proches</b> (père, mère, enfants, conjoint…), ouvrir sa fiche, recentrer l’arbre sur elle ou lancer la <b>recherche IA</b>. Les cases « ? » sont des parents encore inconnus : touchez-les pour les ajouter.</p>
      <p>Glissez pour vous déplacer, pincez (ou utilisez la molette) pour zoomer.</p>
    </HelpText>
  )

  const empty = !personsLoading && persons.length === 0
  return (
    <ChartFrame title={`Arbre interactif${titleName ? ` ${titleName}` : ''}`} color={EDIT_COLOR} help={help} persons={persons} focusId={focusId} onFocus={(id) => { setFocusId(id); setSelected(null) }}
      actions={<ChartActions exportTarget={() => pz.contentRef.current} filename={`Arbre interactif ${titleName}`} />}
      options={
        <>
          <OptionGroup title="Générations">
            <SliderRow label="Ancêtres" value={opts.up} min={1} max={6} onChange={(v) => setOpts({ up: v })} />
            <SliderRow label="Descendants" value={opts.down} min={1} max={5} onChange={(v) => setOpts({ down: v })} />
          </OptionGroup>
          <OptionGroup title="Affichage">
            <ToggleRow label="Dates de naissance et de décès" checked={opts.showDates} onChange={(v) => setOpts({ showDates: v })} />
            <ToggleRow label="Âges" checked={opts.showAges} onChange={(v) => setOpts({ showAges: v })} />
            <ToggleRow label="Parents inconnus (cases « ? »)" hint="Pour les ajouter d’un geste" checked={opts.slots} onChange={(v) => setOpts({ slots: v })} />
          </OptionGroup>
        </>
      }>
      <PrintStyle />
      {empty ? (
        <ChartMessage>
          <p className="mb-1 text-lg font-semibold text-night-900">Votre arbre est encore vide</p>
          <p className="mb-4">Commencez par vous-même, vos parents et vos grands-parents : la recherche IA prendra le relais dans les archives.</p>
          <button className="btn-primary mx-auto" onClick={() => nav('/demarrer')}><UserPlus size={16} /> Démarrer mon arbre</button>
        </ChartMessage>
      ) : (
        <PanZoomCanvas pz={pz} width={layout?.w ?? 0} height={layout?.h ?? 0} fitKey={fitKey} onFitted={centerFocus}
          overlay={<>
            {(loading || personsLoading) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 bottom-24 z-10 rounded-2xl bg-white/95 px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
            {data?.partial && <div className="absolute bottom-24 left-3 z-10 rounded-full bg-white/90 px-3 py-1 text-[11px] text-mist-500 shadow" data-nopan>Descendance très vaste : conjoints affichés pour les premières branches seulement.</div>}
          </>}>
          {layout && (
            <>
              {layout.bands.map((b) => {
                const st = bandStyle(b.rel)
                return (
                  <div key={b.rel} className="absolute rounded-[22px]" style={{ left: b.x, top: b.y, width: b.w, height: NODE_H + 40, background: st.fill, boxShadow: `0 7px 0 ${st.edge}, 0 18px 30px -18px rgba(60,40,120,0.45)` }}>
                    <div className="absolute bottom-3 left-5 leading-tight" style={{ color: st.ink }}>
                      {b.years && <div className="text-[22px] font-light tracking-wide">{b.years}</div>}
                      <div className="text-[12px] font-semibold">{generationLabel(b.rel)}</div>
                    </div>
                  </div>
                )
              })}
              <svg className="pointer-events-none absolute left-0 top-0" width={layout.w} height={layout.h}>
                {layout.paths.map((p, i) => <path key={i} d={p.d} fill="none" stroke={PURPLE} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dashed ? '2 7' : undefined} opacity={p.dashed ? 0.45 : 0.95} />)}
              </svg>
              {layout.nodes.map((n) => (
                <TreeNodeView key={n.key} node={n} top={rowTop(n.rel, opts.up)} selected={!!n.id && n.id === selected} isFocus={n.id === focusId && n.rel === 0}
                  showDates={opts.showDates} showAges={opts.showAges} onPick={pick} onSlot={onSlot} />
              ))}
            </>
          )}
        </PanZoomCanvas>
      )}

      {selectedPerson && (
        <div className="fixed inset-x-2 top-3 z-[95] mx-auto max-w-xl rounded-3xl border border-white/70 bg-white/90 p-2.5 shadow-2xl backdrop-blur-xl print:hidden" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-2.5 px-1">
            <Avatar person={selectedPerson} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-night-900">{selectedPerson.display_name}</div>
              <div className="truncate text-xs text-mist-500">{[birthText(selectedPerson) && `☆ ${birthText(selectedPerson)}`, deathText(selectedPerson) && `† ${deathText(selectedPerson)}`, selectedPerson.age_display].filter(Boolean).join('  ·  ') || 'Dates inconnues'}</div>
            </div>
            <button className="rounded-full bg-black/5 p-1.5 text-mist-500" onClick={() => { setSelected(null); setMenu(false) }} aria-label="Désélectionner"><X size={16} /></button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <StripButton icon={<UserPlus size={18} />} label="Proches…" onClick={() => setMenu(true)} />
            <StripButton icon={<FileText size={18} />} label="Voir la fiche" onClick={() => nav(`/personnes/${selectedPerson.id}`)} />
            <StripButton icon={<Crosshair size={18} />} label="Centrer ici" onClick={() => { setFocusId(selectedPerson.id); setMenu(false) }} />
            <StripButton icon={<Sparkles size={18} />} label={busyAi ? 'Lancement…' : 'Recherche IA'} onClick={() => runAi(selectedPerson)} disabled={busyAi} accent />
          </div>
        </div>
      )}
      {menu && selectedPerson && (
        <AddRelativeMenu anchor={{ id: selectedPerson.id, display_name: selectedPerson.display_name, sex: selectedPerson.sex, surname: selectedPerson.surname }} onClose={() => setMenu(false)} onAdded={afterAdd} />
      )}
      {slotAdd && (
        <AddRelativeSheet anchor={{ id: slotAdd.child.id, display_name: slotAdd.child.display_name, sex: slotAdd.child.sex, surname: slotAdd.child.surname }}
          choice={{ kind: slotAdd.kind, label: slotAdd.kind === 'father' ? 'Ajouter le père' : 'Ajouter la mère', group: 'parents' }} onClose={() => setSlotAdd(null)} onAdded={afterAdd} />
      )}
    </ChartFrame>
  )
}

function StripButton({ icon, label, onClick, disabled, accent }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${accent ? 'bg-[#ece6ff] text-[#5b3fd6] hover:bg-[#e0d7ff]' : 'bg-[#eef3fb] text-[#2f6fd1] hover:bg-[#e2ebf8]'}`}>
      {icon}<span className="leading-tight">{label}</span>
    </button>
  )
}
