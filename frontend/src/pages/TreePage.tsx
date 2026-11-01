import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeTypes } from '@xyflow/react'
import dagre from 'dagre'
import { ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2, Scan, Search, UserPlus } from 'lucide-react'
import { api, ApiError, type Confidence, type PersonSummary, type TreeGraph, type TreeNode } from '../api'
import { useApp } from '../store'
import { Empty, Spinner } from '../components/ui'
import PersonFormModal from '../components/tree/PersonFormModal'
import PersonNode, { NODE_H, NODE_W, type PersonFlowNode, type TreeMode } from '../components/tree/PersonNode'

const CONF_STROKE: Record<Confidence, string> = { green: '#5f9a6a', orange: '#d9932c', red: '#b4473c', grey: '#9aa1ad' }
const DASHED = new Set(['uncertain', 'step', 'adoptive', 'foster'])
const nodeTypes: NodeTypes = { person: PersonNode }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

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
  const rf = useReactFlow<PersonFlowNode, Edge>()
  const [params, setParams] = useSearchParams()

  const [persons, setPersons] = useState<PersonSummary[] | null>(null)
  const [rootId, setRootId] = useState<string>('')
  const [mode, setMode] = useState<TreeMode>('asc')
  const [generations, setGenerations] = useState(6)
  const [graph, setGraph] = useState<TreeGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [full, setFull] = useState(false)
  const [modal, setModal] = useState<{ open: boolean; child: TreeNode | null }>({ open: false, child: null })
  const wrapRef = useRef<HTMLDivElement>(null)

  const loadPersons = useCallback(async () => {
    try {
      const list = await api.persons(undefined, 2000)
      setPersons(list)
      setRootId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list.find((p) => p.is_root) ?? list[0])?.id ?? ''))
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Impossible de charger la liste des personnes.'); setPersons([]); setLoading(false) }
  }, [])
  useEffect(() => { loadPersons() }, [loadPersons])

  const loadGraph = useCallback(async () => {
    if (!rootId) return
    setLoading(true); setError(null)
    try {
      const g = mode === 'asc' ? await api.ancestors(rootId, generations) : await api.descendants(rootId, generations)
      setGraph(g)
    } catch (e) { setError(e instanceof ApiError ? e.message : "Impossible de charger l'arbre.") }
    finally { setLoading(false) }
  }, [rootId, mode, generations])
  useEffect(() => { loadGraph() }, [loadGraph])
  useEffect(() => { setCollapsed(new Set()) }, [rootId, mode])

  useEffect(() => { if (params.get('new') === '1') { setModal({ open: true, child: null }); params.delete('new'); setParams(params, { replace: true }) } }, [params, setParams])
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const toggle = useCallback((id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const openPerson = useCallback((id: string) => nav(`/personnes/${id}`), [nav])
  const addParent = useCallback((p: TreeNode) => setModal({ open: true, child: p }), [])

  const { nodes, edges, genCounts, matchIds } = useMemo(() => {
    if (!graph || !graph.nodes.length) return { nodes: [] as PersonFlowNode[], edges: [] as Edge[], genCounts: [] as { g: number; visible: number; total: number }[], matchIds: [] as string[] }
    const { visible, next } = visibleSet(graph, mode, collapsed)
    const q = norm(filter.trim())
    const matches = new Set<string>()
    if (q) for (const n of graph.nodes) if (norm(`${n.display_name} ${n.married_name ?? ''} ${n.birth_place ?? ''}`).includes(q)) matches.add(n.id)

    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: mode === 'asc' ? 'BT' : 'TB', nodesep: 36, ranksep: 70, marginx: 20, marginy: 20 })
    const vis = graph.nodes.filter((n) => visible.has(n.id))
    for (const n of vis) g.setNode(n.id, { width: NODE_W, height: NODE_H })
    const visEdges = graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target))
    for (const e of visEdges) { if (mode === 'asc') g.setEdge(e.target, e.source); else g.setEdge(e.source, e.target) }
    dagre.layout(g)

    const flowNodes: PersonFlowNode[] = vis.map((n) => {
      const pos = g.node(n.id)
      const beyond = next.get(n.id)?.length ?? 0
      return {
        id: n.id, type: 'person', position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, draggable: false, selectable: true,
        data: { person: n, mode, dim: q ? !matches.has(n.id) : false, highlighted: q ? matches.has(n.id) : false, canToggle: beyond > 0, collapsed: collapsed.has(n.id), hiddenCount: collapsed.has(n.id) ? countBeyond(next, n.id) : 0, onToggle: toggle, onAddParent: addParent, onOpen: openPerson },
      }
    })
    const flowEdges: Edge[] = visEdges.map((e) => {
      const dim = q && !(matches.has(e.source) && matches.has(e.target))
      return { id: e.id, source: e.source, target: e.target, type: 'smoothstep', style: { stroke: CONF_STROKE[e.confidence], strokeWidth: 1.8, strokeDasharray: DASHED.has(e.relation_type) ? '6 4' : undefined, opacity: dim ? 0.2 : 0.9 }, label: undefined, data: { relation_type: e.relation_type } }
    })
    const counts = new Map<number, { visible: number; total: number }>()
    for (const n of graph.nodes) { const c = counts.get(n.generation) ?? { visible: 0, total: 0 }; c.total++; if (visible.has(n.id)) c.visible++; counts.set(n.generation, c) }
    return { nodes: flowNodes, edges: flowEdges, genCounts: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([gen, c]) => ({ g: gen, ...c })), matchIds: [...matches] }
  }, [graph, mode, collapsed, filter, toggle, addParent, openPerson])

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 60); return () => clearTimeout(t) }, [graph, full, rf])

  const fitGeneration = (g: number) => { if (!graph) return; const ids = nodes.filter((n) => n.data.person.generation === g).map((n) => ({ id: n.id })); if (ids.length) rf.fitView({ nodes: ids, padding: 0.4, duration: 500 }) }
  const fitMatches = () => { if (matchIds.length) rf.fitView({ nodes: matchIds.map((id) => ({ id })), padding: 0.5, duration: 500 }) }
  const collapseAll = () => { if (!graph) return; const { next } = visibleSet(graph, mode, new Set()); const ids = graph.edges.map((e) => (mode === 'asc' ? e.target : e.source)).filter((id) => id !== graph.root_id && (next.get(id)?.length ?? 0) > 0); setCollapsed(new Set(ids)) }

  const onCreated = async (created: { id: string; display_name: string }) => {
    if (modal.child) {
      try { await api.addRelation({ parent_id: created.id, child_id: modal.child.id }) }
      catch (e) { notify('error', e instanceof ApiError ? `Personne créée mais relation non enregistrée : ${e.message}` : 'Relation non enregistrée.') }
    }
    await loadPersons(); await loadGraph(); refreshDashboard()
    if (!modal.child && !rootId) setRootId(created.id)
  }

  const canvasCls = full ? 'fixed inset-0 z-[80] bg-ivory-100' : 'relative h-[calc(100vh-150px)] min-h-[520px] overflow-hidden rounded-2xl border border-ivory-300/70 bg-ivory-50'

  if (persons === null) return <div className="flex items-center gap-3 p-8 text-mist-500"><Spinner /> Chargement de l'arbre…</div>
  if (persons.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-10">
        <h1 className="font-display text-4xl text-night-900">Mon arbre</h1>
        <Empty>
          <p className="mb-3">Votre arbre est encore vide. Commencez par ajouter la personne de départ (vous-même ou l'ancêtre à partir duquel vous souhaitez remonter), ou importez un fichier GEDCOM existant.</p>
          <div className="flex justify-center gap-2"><button className="btn-gold" onClick={() => setModal({ open: true, child: null })}><UserPlus size={15} /> Ajouter une personne</button><button className="btn-ghost" onClick={() => nav('/archives?tab=import')}>Importer un GEDCOM</button></div>
        </Empty>
        {error && <p className="text-sm text-conf-red">{error}</p>}
        <PersonFormModal open={modal.open} onClose={() => setModal({ open: false, child: null })} onCreated={onCreated} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-night-900">Mon arbre</h1>
          <p className="text-sm text-mist-500">{mode === 'asc' ? 'Ascendance' : 'Descendance'} · {graph ? `${graph.nodes.length} personne${graph.nodes.length > 1 ? 's' : ''} sur ${graph.generations} génération${graph.generations > 1 ? 's' : ''}` : '…'}</p>
        </div>
        <button className="btn-gold" onClick={() => setModal({ open: true, child: null })}><UserPlus size={15} /> Ajouter une personne</button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div ref={wrapRef} className={canvasCls}>
          {/* Barre d'outils flottante */}
          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-2xl border border-ivory-300/70 bg-ivory-50/90 p-2 shadow-lg backdrop-blur">
            <select className="input !w-auto max-w-[260px] !py-1.5" value={rootId} onChange={(e) => setRootId(e.target.value)} title="Personne de départ">
              {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.birth_year ? ` (${p.birth_year})` : ''}{p.is_root ? ' ★' : ''}</option>)}
            </select>
            <div className="flex overflow-hidden rounded-xl border border-ivory-300">
              <button className={`px-3 py-1.5 text-xs ${mode === 'asc' ? 'bg-night-900 text-ivory-50' : 'bg-white text-night-900 hover:bg-ivory-100'}`} onClick={() => setMode('asc')}>Ascendant</button>
              <button className={`px-3 py-1.5 text-xs ${mode === 'desc' ? 'bg-night-900 text-ivory-50' : 'bg-white text-night-900 hover:bg-ivory-100'}`} onClick={() => setMode('desc')}>Descendant</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-night-900" title="Nombre de générations">
              <span className="text-mist-500">Gén.</span>
              <input type="range" min={2} max={12} value={generations} onChange={(e) => setGenerations(Number(e.target.value))} className="w-24 accent-gold-500" />
              <span className="w-5 tabular-nums">{generations}</span>
            </label>
            <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setCollapsed(new Set())} title="Déplier tout"><ChevronsUpDown size={14} /> Déplier tout</button>
            <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={collapseAll} title="Replier tout"><ChevronsDownUp size={14} /> Replier tout</button>
            <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => rf.fitView({ padding: 0.15, duration: 400 })} title="Ajuster la vue"><Scan size={14} /></button>
            <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setFull((f) => !f)} title={full ? 'Quitter le plein écran' : 'Plein écran'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2 text-mist-400" />
              <input className="input !w-48 !py-1.5 pl-7 text-xs" placeholder="Filtrer par nom…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fitMatches(); if (e.key === 'Escape') setFilter('') }} />
            </div>
            {filter && <span className="text-xs text-mist-500">{matchIds.length} résultat{matchIds.length > 1 ? 's' : ''} <button className="text-gold-600 underline" onClick={fitMatches}>centrer</button></span>}
          </div>
          {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-ivory-50/60 backdrop-blur-[1px]"><span className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm text-night-900 shadow"><Spinner /> Calcul de l'arbre…</span></div>}
          {error && <div className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-conf-red/30 bg-conf-red/10 px-4 py-2 text-sm text-conf-red">{error}</div>}
          <ReactFlow<PersonFlowNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable minZoom={0.05} maxZoom={2.5} fitView proOptions={{ hideAttribution: true }} onlyRenderVisibleElements={nodes.length > 150}>
            <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="#ddd5bd" />
            <Controls showInteractive={false} position="bottom-left" className="!rounded-xl !border !border-ivory-300 !bg-ivory-50 !shadow-md [&>button]:!border-ivory-200 [&>button]:!bg-ivory-50 [&>button:hover]:!bg-ivory-200 [&_svg]:!fill-night-900" />
            <MiniMap pannable zoomable position="bottom-right" className="!rounded-xl !border !border-ivory-300 !bg-ivory-100/90" maskColor="rgba(15,30,58,0.08)" nodeColor={(n) => { const d = n.data as { person?: TreeNode }; return d.person?.is_root ? '#c9a227' : CONF_STROKE[d.person?.confidence ?? 'grey'] }} nodeBorderRadius={8} />
          </ReactFlow>
          {full && (
            <div className="absolute right-3 top-3 z-10 w-60 rounded-2xl border border-ivory-300/70 bg-ivory-50/90 p-3 shadow-lg backdrop-blur">
              <GenerationNav mode={mode} counts={genCounts} onFit={fitGeneration} compact />
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="panel fade-up p-4">
            <h2 className="font-display text-lg text-night-900">Navigation par génération</h2>
            <p className="mb-2 text-[11px] text-mist-500">Cliquez pour centrer la vue sur une génération.</p>
            <GenerationNav mode={mode} counts={genCounts} onFit={fitGeneration} />
          </section>
          <section className="panel fade-up p-4 text-xs text-mist-500">
            <h2 className="mb-2 font-display text-lg text-night-900">Légende</h2>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2"><span className="h-0.5 w-6 rounded" style={{ background: CONF_STROKE.green }} /> Filiation établie</li>
              <li className="flex items-center gap-2"><span className="h-0.5 w-6 rounded" style={{ background: CONF_STROKE.orange }} /> À vérifier</li>
              <li className="flex items-center gap-2"><span className="h-0.5 w-6 rounded" style={{ background: CONF_STROKE.red }} /> Contradiction</li>
              <li className="flex items-center gap-2"><span className="h-0.5 w-6 rounded" style={{ background: CONF_STROKE.grey }} /> Inconnue</li>
              <li className="flex items-center gap-2"><span className="h-0 w-6 border-t-2 border-dashed border-mist-400" /> Incertaine, adoptive ou beau-parent</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-gold-500" /> Personne de départ</li>
              <li className="flex items-center gap-2"><span className="rounded-full bg-night-900 px-1.5 text-[9px] text-gold-400">12</span> Numéro Sosa-Stradonitz</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-night-900" /><span className="h-3 w-3 rounded-full bg-sage-500" /><span className="h-3 w-3 rounded-full bg-mist-300" /> Homme · Femme · Inconnu</li>
            </ul>
          </section>
        </aside>
      </div>

      <PersonFormModal open={modal.open} title={modal.child ? `Ajouter un parent à ${modal.child.display_name}` : 'Ajouter une personne'}
        hint={modal.child ? 'La nouvelle personne sera reliée comme parent ; vous pourrez préciser le type de filiation depuis sa fiche.' : null}
        onClose={() => setModal({ open: false, child: null })} onCreated={onCreated} />
    </div>
  )
}

function GenerationNav({ mode, counts, onFit, compact = false }: { mode: TreeMode; counts: { g: number; visible: number; total: number }[]; onFit: (g: number) => void; compact?: boolean }) {
  if (!counts.length) return <p className="text-xs text-mist-500">Aucune génération à afficher.</p>
  return (
    <ul className={`space-y-1 ${compact ? 'max-h-72 overflow-auto scrollbar-thin' : ''}`}>
      {counts.map((c) => (
        <li key={c.g}>
          <button onClick={() => onFit(c.g)} disabled={c.visible === 0} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-night-900 transition-colors hover:bg-ivory-200 disabled:opacity-40">
            <span><span className="font-semibold">Gén. {c.g}</span> <span className="text-mist-500">· {genLabel(mode, c.g)}</span></span>
            <span className="tabular-nums text-mist-500">{c.visible}{c.visible !== c.total ? `/${c.total}` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function TreePage() {
  return <ReactFlowProvider><TreeInner /></ReactFlowProvider>
}
