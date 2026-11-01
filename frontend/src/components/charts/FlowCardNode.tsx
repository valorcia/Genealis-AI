import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, UserPlus } from 'lucide-react'
import type { PersonSummary, TreeNode } from '../../api'
import { PersonCard, type CardOptions } from './PersonCard'

export interface FlowCardData extends Record<string, unknown> {
  person: TreeNode
  opts: CardOptions
  dim: boolean
  highlighted: boolean
  canToggle: boolean
  collapsed: boolean
  hiddenCount: number
  /** Côté vers lequel la branche se déploie (pour placer le bouton replier/déplier). */
  growth: 'left' | 'right' | 'up' | 'down'
  sourcePos: Position
  targetPos: Position
  onToggle: (id: string) => void
  onAdd: (p: PersonSummary) => void
  onOpen: (p: PersonSummary) => void
}
export type FlowCardNode = Node<FlowCardData, 'card'>

const TOGGLE_POS: Record<FlowCardData['growth'], string> = {
  right: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', left: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
  up: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', down: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2',
}

/** Carte d'« Arbre généalogique intégral » pour React Flow (bouton replier, ajout de proches). */
function FlowCardInner({ data }: NodeProps<FlowCardNode>) {
  const p = data.person
  const sosa = p.sosa && p.sosa.length ? p.sosa[0] : null
  const Icon = data.growth === 'right' ? (data.collapsed ? ChevronRight : ChevronLeft) : data.growth === 'left' ? (data.collapsed ? ChevronLeft : ChevronRight) : data.growth === 'up' ? (data.collapsed ? ChevronUp : ChevronDown) : (data.collapsed ? ChevronDown : ChevronUp)
  return (
    <div className={`group relative transition-opacity duration-300 ${data.dim ? 'opacity-25' : ''}`}>
      <Handle type="target" position={data.targetPos} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <Handle type="source" position={data.sourcePos} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <PersonCard person={p} opts={data.opts} root={p.generation === 0} selected={data.highlighted} sosa={sosa} onClick={data.onOpen} />
      <button type="button" onClick={(e) => { e.stopPropagation(); data.onAdd(p) }} title={`Ajouter des proches à ${p.display_name}`}
        className="absolute -top-2.5 right-2 flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#13918c] opacity-0 shadow ring-1 ring-black/10 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <UserPlus size={11} /> Proches
      </button>
      {data.canToggle && (
        <button type="button" onClick={(e) => { e.stopPropagation(); data.onToggle(p.id) }}
          title={data.collapsed ? `Déplier (${data.hiddenCount} personne${data.hiddenCount > 1 ? 's' : ''} masquée${data.hiddenCount > 1 ? 's' : ''})` : 'Replier cette branche'}
          className={`absolute z-10 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold shadow ring-1 transition-colors ${TOGGLE_POS[data.growth]} ${data.collapsed ? 'bg-[#13918c] text-white ring-[#13918c]' : 'bg-white text-mist-500 ring-black/10 hover:bg-[#13918c]/10'}`}>
          <Icon size={11} />{data.collapsed ? `+${data.hiddenCount}` : ''}
        </button>
      )}
    </div>
  )
}

const FlowCard = memo(FlowCardInner)
export default FlowCard
