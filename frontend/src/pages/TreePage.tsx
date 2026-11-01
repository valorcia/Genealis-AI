import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Background, BackgroundVariant, Controls, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeTypes } from '@xyflow/react'
import dagre from 'dagre'
import { ChevronsDownUp, ChevronsUpDown, Maximize2, Rocket, Scan, Search, Upload, UserPlus } from 'lucide-react'
import { api, ApiError, type Confidence, type PersonSummary, type TreeGraph } from '../api'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import ChartFrame from '../components/shell/ChartFrame'
import { useFocusPerson } from '../components/shell/useFocusPerson'
import { AddRelativeMenu } from '../components/relatives/AddRelative'
import PersonFormModal from '../components/tree/PersonFormModal'
import FlowCard, { type FlowCardNode } from '../components/charts/FlowCardNode'
import { ActionButton, ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, SliderRow, ToggleRow, usePref } from '../components/charts/ChartTools'
import { CardContentToggles, CardStylePanel } from '../components/charts/CardOptionsPanel'
import { cardSize, DEFAULT_CARD_OPTIONS, type CardOptions } from '../components/charts/PersonCard'
import { fullName, GRAPH_COLOR, norm } from '../components/charts/format'

type TreeMode = 'asc' | 'desc'
type Orientation = 'horizontal' | 'vertical'
interface Opts extends CardOptions { mode: TreeMode; gens: number; orientation: Orientation; confColors: boolean }

const CONF_STROKE: Record<Confidence, string> = { green: '#5f9a6a', orange: '#d9932c', red: '#b4473c', grey: '#9aa1ad' }
const DASHED = new Set(['uncertain', 'step', 'adoptive', 'foster'])
const nodeTypes: NodeTypes = { card: FlowCard }

function genLabel(mode: TreeMode, g: number) {
  if (g === 0) return 'Personne de départ'
  if (mode === 'asc') return g === 1 ? 'Parents' : g === 2 ? 'Grands-parents' : g === 3 ? 'Arrière-grands-parents' : `Arrière (×${g - 2}) grands-parents`
  return g === 1 ? 'Enfants' : g === 2 ? 'Petits-enfants' : g === 3 ? 'Arrière-petits-enfants' : `Arrière (×${g - 2}) petits-enfants`
}

/** Calcule l'ensemble des nœuds visibles en partant de la racine et en s'arrêtant aux branches repliées. */
function visibleSet(graph: TreeGraph, mode: TreeMode, collapsed: Set<string>) {
  const next = new Map<string, string[]>()
  for (const e of graph.edges) {
    const from = mode === 'asc' ? e.target : e.source
    const to = mode === 'asc' ? e.source : e.target
    const arr = next.get(from); if (arr) arr.push(to); else next.set(from, [to])
  }
  const visible = new Set<string>([graph.root_id])
  const queue = [graph.root_id]
  while (queue.length) {
    const id = queue.shift() as string
    if (collapsed.has(id)) continue
    for (const n of next.get(id) ?? []) if (!visible.has(n)) { visible.add(n); queue.push(n) }
  }
  return { visible, next }
}
function countBeyond(next: Map<string, string[]>, id: string) {
  const seen = new Set<string>(); const q = [...(next.get(id) ?? [])]
  while (q.length) { const n = q.shift() as string; if (seen.has(n)) continue; seen.add(n); q.push(...(next.get(n) ?? [])) }
  return seen.size
}

function TreeInner() {
  const nav = useNavigate()
  const notify = useApp((s) => s.notify)
  const refreshDashboard = useApp((s) => s.refreshDashboard)
  const rf = useReactFlow<FlowCardNode, Edge>()
  const [params, setParams] = useSearchParams()
  const { persons, focus, focusId: rootId, setFocusId, loading: pl, reload: reloadPersons } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('integral', { ...DEFAULT_CARD_OPTIONS, showSosa: false, mode: 'asc', gens: 6, orientation: 'horizontal', confColors: false })
  const [graph, setGraph] = useState<TreeGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [modal, setModal] = useState(false)
  const [anchor, setAnchor] = useState<PersonSummary | null>(null)
  const mode = opts.mode

  const loadGraph = useCallback(async () => {
    if (!rootId) { setLoading(false); return }
    setLoading(true); setError(null)
    try { setGraph(mode === 'asc' ? await api.ancestors(rootId, opts.gens) : await api.descendants(rootId, opts.gens)) }
    catch (e) { setError(e instanceof ApiError ? e.message : "Impossible de charger l'arbre.") }
    finally { setLoading(false) }
  }, [rootId, mode, opts.gens])
  useEffect(() => { loadGraph() }, [loadGraph])
  useEffect(() => { setCollapsed(new Set()) }, [rootId, mode])
  useEffect(() => { if (params.get('new') === '1') { setModal(true); params.delete('new'); setParams(params, { replace: true }) } }, [params, setParams])

  const toggle = useCallback((id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const openPerson = useCallback((p: PersonSummary) => nav(`/personnes/${p.id}`), [nav])
  const onAdd = useCallback((p: PersonSummary) => setAnchor(p), [])

  const { nodes, edges, genCounts, matchIds } = useMemo(() => {
    if (!graph || !graph.nodes.length) return { nodes: [] as FlowCardNode[], edges: [] as Edge[], genCounts: [] as { g: number; visible: number; total: number }[], matchIds: [] as string[] }
    const { visible, next } = visibleSet(graph, mode, collapsed)
    const q = norm(filter.trim())
    const matches = new Set<string>()
    if (q) for (const n of graph.nodes) if (norm(`${n.display_name} ${n.married_name ?? ''} ${n.birth_place ?? ''}`).includes(q)) matches.add(n.id)
    const { w, h } = cardSize('card', opts)
    const horizontal = opts.orientation === 'horizontal'
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: horizontal ? 'LR' : mode === 'asc' ? 'BT' : 'TB', nodesep: horizontal ? 16 : 30, ranksep: horizontal ? 70 : 64, marginx: 20, marginy: 20 })
    const vis = graph.nodes.filter((n) => visible.has(n.id))
    for (const n of vis) g.setNode(n.id, { width: w, height: h })
    const visEdges = graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target))
    for (const e of visEdges) { if (mode === 'asc') g.setEdge(e.target, e.source); else g.setEdge(e.source, e.target) }
    dagre.layout(g)
    // Les arêtes vont toujours du parent vers l'enfant ; on place les poignées selon le sens de lecture.
    const sourcePos = horizontal ? (mode === 'asc' ? Position.Left : Position.Right) : (mode === 'asc' ? Position.Bottom : Position.Bottom)
    const targetPos = horizontal ? (mode === 'asc' ? Position.Right : Position.Left) : Position.Top
    const growth = horizontal ? 'right' : mode === 'asc' ? 'up' : 'down'
    const flowNodes: FlowCardNode[] = vis.map((n) => {
      const pos = g.node(n.id)
      const beyond = next.get(n.id)?.length ?? 0
      return {
        id: n.id, type: 'card', position: { x: pos.x - w / 2, y: pos.y - h / 2 }, draggable: false, selectable: false,
        data: { person: n, opts, dim: q ? !matches.has(n.id) : false, highlighted: q ? matches.has(n.id) : false, canToggle: beyond > 0, collapsed: collapsed.has(n.id), hiddenCount: collapsed.has(n.id) ? countBeyond(next, n.id) : 0, growth, sourcePos, targetPos, onToggle: toggle, onAdd, onOpen: openPerson },
      }
    })
    const flowEdges: Edge[] = visEdges.map((e) => {
      const dim = q && !(matches.has(e.source) && matches.has(e.target))
      return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', pathOptions: { borderRadius: 6 }, style: { stroke: opts.confColors ? CONF_STROKE[e.confidence] : '#4b5160', strokeWidth: 1.3, strokeDasharray: DASHED.has(e.relation_type) ? '6 4' : undefined, opacity: dim ? 0.2 : 1 } } as Edge
    })
    const counts = new Map<number, { visible: number; total: number }>()
    for (const n of graph.nodes) { const c = counts.get(n.generation) ?? { visible: 0, total: 0 }; c.total++; if (visible.has(n.id)) c.visible++; counts.set(n.generation, c) }
    return { nodes: flowNodes, edges: flowEdges, genCounts: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([gen, c]) => ({ g: gen, ...c })), matchIds: [...matches] }
  }, [graph, mode, collapsed, filter, toggle, onAdd, openPerson, opts])

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.12, duration: 400, maxZoom: 1.1 }), 80); return () => clearTimeout(t) }, [graph, opts.orientation, rf])

  const fitGeneration = (g: number) => { const ids = nodes.filter((n) => n.data.person.generation === g).map((n) => ({ id: n.id })); if (ids.length) rf.fitView({ nodes: ids, padding: 0.4, duration: 500, maxZoom: 1.2 }) }
  const fitMatches = () => { if (matchIds.length) rf.fitView({ nodes: matchIds.map((id) => ({ id })), padding: 0.5, duration: 500, maxZoom: 1.2 }) }
  const collapseAll = () => { if (!graph) return; const { next } = visibleSet(graph, mode, new Set()); const ids = graph.edges.map((e) => (mode === 'asc' ? e.target : e.source)).filter((id) => id !== graph.root_id && (next.get(id)?.length ?? 0) > 0); setCollapsed(new Set(ids)) }
  const onCreated = async (created: { id: string; display_name: string }) => { await reloadPersons(); refreshDashboard(); if (!rootId) setFocusId(created.id); else loadGraph() }
  const afterAdd = () => { loadGraph(); reloadPersons(); refreshDashboard() }
  const name = focus ? fullName(focus) : ''

  const help = (
    <HelpText title="Arbre généalogique intégral">
      <p>Toute l’ascendance (ou la descendance) de la personne de départ, sur autant de générations que vous le souhaitez. Les cartes vertes sont des hommes, les lilas des femmes ; la personne de départ a un cadre gris épais.</p>
      <p>Touchez une carte pour ouvrir la fiche, « Proches » pour ajouter un parent, un enfant ou un conjoint. Les petits boutons ‹ › replient ou déplient une branche. Les options permettent de filtrer par nom, de naviguer par génération et de changer l’orientation.</p>
      <p>Traits pointillés : filiation incertaine, adoptive ou beau-parent.</p>
    </HelpText>
  )

  if (!pl && persons.length === 0) {
    return (
      <ChartFrame title="Arbre généalogique intégral" color={GRAPH_COLOR} help={help}>
        <ChartMessage>
          <p className="mb-1 text-lg font-semibold text-night-900">Votre arbre est encore vide</p>
          <p className="mb-4">Commencez par la personne de départ (vous-même ou l’ancêtre dont vous voulez remonter la lignée), ou importez un fichier GEDCOM.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn-primary" onClick={() => nav('/demarrer')}><Rocket size={15} /> Démarrer</button>
            <button className="btn-ghost" onClick={() => setModal(true)}><UserPlus size={15} /> Ajouter une personne</button>
            <button className="btn-ghost" onClick={() => nav('/archives?tab=import')}><Upload size={15} /> Importer</button>
          </div>
        </ChartMessage>
        <PersonFormModal open={modal} onClose={() => setModal(false)} onCreated={onCreated} />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame title={`Arbre généalogique intégral${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} help={help} persons={persons} focusId={rootId} onFocus={setFocusId}
      subtitle={graph ? `${mode === 'asc' ? 'Ascendance' : 'Descendance'} · ${graph.nodes.length} personne${graph.nodes.length > 1 ? 's' : ''} sur ${graph.generations} génération${graph.generations > 1 ? 's' : ''}` : undefined}
      actions={
        <ChartActions>
          <ActionButton icon={<Scan size={17} />} label="Ajuster la vue" onClick={() => rf.fitView({ padding: 0.12, duration: 400 })} />
          <ActionButton icon={<Maximize2 size={17} />} label="Plein écran" hint="Échap pour quitter" onClick={() => { document.documentElement.requestFullscreen?.().catch(() => {}) }} />
          <ActionButton icon={<UserPlus size={17} />} label="Ajouter une personne" hint="Personne sans lien pour l’instant" onClick={() => setModal(true)} />
        </ChartActions>
      }
      styleOptions={<>
        <CardStylePanel opts={opts} onChange={setOpts} />
        <OptionGroup title="Traits"><ToggleRow label="Couleur selon la fiabilité" hint="Vert établi, orange à vérifier, rouge contradiction" checked={opts.confColors} onChange={(v) => setOpts({ confColors: v })} /></OptionGroup>
      </>}
      options={<>
        <OptionGroup title="Arbre">
          <SegmentedRow value={mode} onChange={(v) => setOpts({ mode: v })} options={[{ value: 'asc', label: 'Ascendant' }, { value: 'desc', label: 'Descendant' }]} />
          <SegmentedRow value={opts.orientation} onChange={(v) => setOpts({ orientation: v })} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
          <SliderRow label="Générations" value={opts.gens} min={2} max={12} onChange={(v) => setOpts({ gens: v })} />
        </OptionGroup>
        <OptionGroup title="Rechercher et replier">
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <div className="relative flex-1"><Search size={14} className="absolute left-3 top-2.5 text-mist-400" /><input className="input pl-8" placeholder="Filtrer par nom ou lieu…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fitMatches(); if (e.key === 'Escape') setFilter('') }} /></div>
            {filter && <button className="text-xs font-medium text-[#13918c]" onClick={fitMatches}>{matchIds.length} · centrer</button>}
          </div>
          <div className="flex gap-2 px-3.5 py-2.5">
            <button className="btn-ghost flex-1 justify-center !py-1.5 text-xs" onClick={() => setCollapsed(new Set())}><ChevronsUpDown size={14} /> Déplier tout</button>
            <button className="btn-ghost flex-1 justify-center !py-1.5 text-xs" onClick={collapseAll}><ChevronsDownUp size={14} /> Replier tout</button>
          </div>
        </OptionGroup>
        <OptionGroup title="Aller à une génération">
          {genCounts.map((c) => (
            <button key={c.g} onClick={() => fitGeneration(c.g)} disabled={c.visible === 0} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm text-night-900 hover:bg-black/[0.03] disabled:opacity-40">
              <span><span className="font-semibold">Gén. {c.g}</span> <span className="text-mist-500">· {genLabel(mode, c.g)}</span></span>
              <span className="tabular-nums text-mist-500">{c.visible}{c.visible !== c.total ? `/${c.total}` : ''}</span>
            </button>
          ))}
        </OptionGroup>
        <CardContentToggles opts={opts} onChange={setOpts} />
      </>}>
      <PrintStyle />
      <div className="chart-viewport chart-print-area relative w-full overflow-hidden rounded-3xl bg-white ring-1 ring-black/5" style={{ height: 'calc(100dvh - 150px)', minHeight: 420 }}>
        {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow"><Spinner /> Calcul de l’arbre…</div>}
        {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow">{error}</div>}
        <ReactFlow<FlowCardNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.05} maxZoom={2.5} fitView proOptions={{ hideAttribution: true }} onlyRenderVisibleElements={nodes.length > 150}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.1} color="#d9dde6" />
          <Controls showInteractive={false} position="top-right" className="!rounded-2xl !border-0 !bg-white/90 !shadow-md [&>button]:!border-black/5 [&>button]:!bg-transparent print:hidden" />
          {nodes.length > 30 && <MiniMap pannable zoomable position="bottom-right" className="!mb-24 !rounded-2xl !bg-white/90 print:hidden" maskColor="rgba(15,30,58,0.06)" nodeColor={(n) => { const d = n.data as { person?: PersonSummary }; return d.person?.sex === 'F' ? '#d9c6f3' : d.person?.sex === 'M' ? '#bfe3a8' : '#d6d9e0' }} nodeBorderRadius={6} />}
        </ReactFlow>
      </div>
      <PersonFormModal open={modal} title="Ajouter une personne" onClose={() => setModal(false)} onCreated={async (c) => { try { await onCreated(c) } catch (e) { notify('error', e instanceof ApiError ? e.message : 'Erreur.') } }} />
      {anchor && <AddRelativeMenu anchor={{ id: anchor.id, display_name: anchor.display_name, sex: anchor.sex, surname: anchor.surname }} onClose={() => setAnchor(null)} onAdded={afterAdd} />}
    </ChartFrame>
  )
}

export default function TreePage() {
  return <ReactFlowProvider><TreeInner /></ReactFlowProvider>
}
