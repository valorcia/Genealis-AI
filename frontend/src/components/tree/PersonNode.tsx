import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp, UserPlus } from 'lucide-react'
import { api, type TreeNode } from '../../api'
import { ConfidenceDot } from '../ui'

export type TreeMode = 'asc' | 'desc'

export interface PersonNodeData extends Record<string, unknown> {
  person: TreeNode
  mode: TreeMode
  dim: boolean
  highlighted: boolean
  canToggle: boolean
  collapsed: boolean
  hiddenCount: number
  onToggle: (id: string) => void
  onAddParent: (p: TreeNode) => void
  onOpen: (id: string) => void
}
export type PersonFlowNode = Node<PersonNodeData, 'person'>

export const NODE_W = 232
export const NODE_H = 96

function initials(p: TreeNode) {
  const g = (p.given_names ?? '').trim().split(/\s+/)[0]?.[0] ?? ''
  const s = (p.surname ?? '').trim()[0] ?? ''
  return (g + s).toUpperCase() || '?'
}
const SEX_BG: Record<string, string> = { M: 'bg-night-900 text-ivory-50', F: 'bg-sage-500 text-ivory-50' }

function PersonNodeInner({ data }: NodeProps<PersonFlowNode>) {
  const p = data.person
  const dates = p.birth_display || p.death_display ? `${p.birth_display ?? '?'} – ${p.death_display ?? (p.is_living ? '' : '?')}` : (p.birth_year || p.death_year ? `${p.birth_year ?? '?'} – ${p.death_year ?? ''}` : 'Dates inconnues')
  const sosa = p.sosa && p.sosa.length ? p.sosa : null
  return (
    <div className={`group relative transition-opacity duration-300 ${data.dim ? 'opacity-25' : 'opacity-100'}`} style={{ width: NODE_W, height: NODE_H }}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-mist-300" />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-mist-300" />
      <button type="button" onClick={() => data.onOpen(p.id)} title={`Ouvrir la fiche de ${p.display_name}`}
        className={`flex h-full w-full cursor-pointer items-center gap-3 rounded-2xl border bg-ivory-50 px-3 text-left shadow-[0_1px_2px_rgba(15,30,58,0.06),0_8px_20px_-12px_rgba(15,30,58,0.3)] transition-all hover:-translate-y-0.5 hover:shadow-lg ${p.is_root ? 'border-gold-500 ring-2 ring-gold-500/30' : data.highlighted ? 'border-gold-400 ring-2 ring-gold-400/30' : 'border-ivory-300/80'}`}>
        {p.portrait_media_id ? (
          <img src={api.mediaFileUrl(p.portrait_media_id)} alt="" className="h-12 w-12 shrink-0 rounded-full border border-ivory-300 object-cover" loading="lazy" />
        ) : (
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-lg ${SEX_BG[p.sex ?? ''] ?? 'bg-mist-300 text-night-900'}`}>{initials(p)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <ConfidenceDot level={p.confidence} />
            <span className="truncate text-[13px] leading-tight text-night-900">{p.given_names ?? ''}</span>
          </span>
          <span className="block truncate font-display text-[15px] font-semibold uppercase tracking-wide text-night-900">{p.surname ?? (p.given_names ? '' : p.display_name)}</span>
          <span className="block truncate text-[11px] text-mist-500">{dates}</span>
          {p.birth_place && <span className="block truncate text-[11px] text-mist-400">{p.birth_place}</span>}
        </span>
      </button>
      {sosa && (
        <span className="absolute -right-1 -top-2 rounded-full bg-night-900 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gold-400 shadow" title={sosa.length > 1 ? `Sosa ${sosa.join(', ')} (implexe)` : `Numéro Sosa ${sosa[0]}`}>
          {sosa[0]}{sosa.length > 1 ? ` +${sosa.length - 1}` : ''}
        </span>
      )}
      {p.is_root && <span className="absolute -left-1 -top-2 rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-semibold text-night-950 shadow">Départ</span>}
      <button type="button" onClick={(e) => { e.stopPropagation(); data.onAddParent(p) }} title={`Ajouter un parent à ${p.display_name}`}
        className="absolute -bottom-3 right-2 flex items-center gap-1 rounded-full border border-ivory-300 bg-white px-2 py-0.5 text-[10px] text-night-900 opacity-0 shadow transition-opacity hover:bg-gold-500 hover:text-night-950 group-hover:opacity-100">
        <UserPlus size={10} /> Ajouter un parent
      </button>
      {data.canToggle && (
        <button type="button" onClick={(e) => { e.stopPropagation(); data.onToggle(p.id) }}
          title={data.collapsed ? `Déplier (${data.hiddenCount} personne${data.hiddenCount > 1 ? 's' : ''} masquée${data.hiddenCount > 1 ? 's' : ''})` : 'Replier cette branche'}
          className={`absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] shadow transition-colors ${data.collapsed ? 'border-gold-500 bg-gold-500 text-night-950' : 'border-ivory-300 bg-white text-mist-500 hover:bg-ivory-100'} ${data.mode === 'asc' ? '-top-3' : '-bottom-3'}`}>
          {data.mode === 'asc' ? (data.collapsed ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : (data.collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
          {data.collapsed ? `+${data.hiddenCount}` : ''}
        </button>
      )}
    </div>
  )
}

const PersonNode = memo(PersonNodeInner)
export default PersonNode
