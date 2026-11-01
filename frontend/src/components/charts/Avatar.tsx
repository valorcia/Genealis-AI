import { memo, useId, useState } from 'react'
import { api, type PersonSummary } from '../../api'
import { sexKey, type SexKey } from './format'

const BODY: Record<SexKey, [string, string, string]> = {
  M: ['#bcd5ff', '#6b9cf3', '#3c6fd6'],
  F: ['#ffd0bb', '#f59872', '#e06b45'],
  U: ['#eef0f4', '#c3c8d2', '#959bab'],
}

/**
 * Silhouette « 3D » douce (tête et buste en dégradé), bleue pour un homme, saumon pour une femme,
 * grise si le sexe est inconnu. C'est un élément <svg> autonome : utilisable en HTML comme dans un SVG.
 */
export const FigureSvg = memo(function FigureSvg({ sex, size, x, y }: { sex: SexKey; size: number; x?: number; y?: number }) {
  const uid = useId().replace(/:/g, '')
  const [c1, c2, c3] = BODY[sex]
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} /><stop offset="0.55" stopColor={c2} /><stop offset="1" stopColor={c3} />
        </linearGradient>
        <radialGradient id={`h${uid}`} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fff7ea" /><stop offset="0.45" stopColor="#f6d1a4" /><stop offset="1" stopColor="#d9975c" />
        </radialGradient>
        <radialGradient id={`s${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#1d2550" stopOpacity="0.28" /><stop offset="1" stopColor="#1d2550" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`g${uid}`} cx="0.35" cy="0.15" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="93" rx="40" ry="7" fill={`url(#s${uid})`} />
      <path d="M10 78 C10 57 28 50 50 50 C72 50 90 57 90 78 C90 89 76 93 50 93 C24 93 10 89 10 78 Z" fill={`url(#b${uid})`} />
      <path d="M10 78 C10 57 28 50 50 50 C72 50 90 57 90 78 C90 89 76 93 50 93 C24 93 10 89 10 78 Z" fill={`url(#g${uid})`} />
      <ellipse cx="50" cy="51" rx="15" ry="4" fill="#000" opacity="0.08" />
      <circle cx="50" cy="31" r="20" fill={`url(#h${uid})`} />
      <ellipse cx="43" cy="22" rx="7" ry="4.5" fill="#fff" opacity="0.45" />
    </svg>
  )
})

/** Photo de la personne si un portrait existe, sinon la silhouette. */
export function Avatar({ person, size = 56, shape = 'figure', className = '' }: { person: PersonSummary | null; size?: number; shape?: 'figure' | 'round' | 'square'; className?: string }) {
  const [broken, setBroken] = useState(false)
  const sx = sexKey(person)
  if (person?.portrait_media_id && !broken) {
    const radius = shape === 'round' ? '9999px' : `${Math.round(size * 0.14)}px`
    return (
      <img src={api.mediaFileUrl(person.portrait_media_id)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)}
        className={`shrink-0 object-cover shadow-[0_4px_10px_-4px_rgba(30,40,90,0.45)] ring-2 ring-white ${className}`}
        style={{ width: size, height: size, borderRadius: radius }} />
    )
  }
  if (shape === 'round') {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/70 ring-1 ring-black/5 ${className}`} style={{ width: size, height: size }}>
        <FigureSvg sex={sx} size={size * 0.86} />
      </span>
    )
  }
  return <span className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}><FigureSvg sex={sx} size={size} /></span>
}
