import { useEffect, useMemo, useState, type CSSProperties, type DependencyList, type ReactNode } from 'react'
import { AlertTriangle, RotateCw, Search, User, X } from 'lucide-react'
import { api, ApiError, EVENT_LABEL, type PersonSummary } from '../../api'
import { SECTION_BY_ID } from '../../navigation/sections'
import { Spinner } from '../ui'
import { Sheet } from '../relatives/AddRelative'

/** Couleurs des catégories (source unique : navigation/sections.ts). */
export const COLORS = {
  vues: SECTION_BY_ID.vues.color,
  rapports: SECTION_BY_ID.rapports.color,
  listes: SECTION_BY_ID.listes.color,
  publication: SECTION_BY_ID.publication.color,
}

/** Message d'erreur lisible en français. */
export function errorText(e: unknown, fallback = 'Une erreur est survenue. Vérifiez que le moteur GENEALIS est lancé.') {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof TypeError) return 'Connexion au moteur impossible. Vérifiez votre connexion ou que le moteur est lancé.'
  return fallback
}

/** Chargement asynchrone simple avec état de chargement, erreur et relance. */
export function useLoader<T>(fn: () => Promise<T>, deps: DependencyList, enabled = true) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: enabled, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) { setState({ data: null, loading: false, error: null }); return }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then((data) => { if (alive) setState({ data, loading: false, error: null }) })
      .catch((e: unknown) => { if (alive) setState({ data: null, loading: false, error: errorText(e) }) })
    return () => { alive = false }
  }, [...deps, tick, enabled])
  return { ...state, reload: () => setTick((t) => t + 1) }
}

/** Exécute des appels avec une concurrence limitée (pour ne pas saturer le moteur). */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, onProgress?: (done: number) => void): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0, done = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = await fn(items[i], i) } catch { out[i] = null }
      done++; onProgress?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function LoadingState({ label = 'Chargement…', color }: { label?: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-mist-500">
      <span className="scale-150"><Spinner /></span>
      <span style={{ color }}>{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto my-8 max-w-md rounded-[22px] bg-white p-5 text-center shadow-[0_8px_30px_-14px_rgba(20,40,80,0.35)] ring-1 ring-black/5">
      <AlertTriangle className="mx-auto mb-2 text-conf-red" size={28} />
      <p className="text-sm text-night-900">{message}</p>
      {onRetry && <button className="btn-ghost mx-auto mt-3" onClick={onRetry}><RotateCw size={14} /> Réessayer</button>}
    </div>
  )
}

export function EmptyState({ icon, title, children, color }: { icon?: ReactNode; title: string; children?: ReactNode; color?: string }) {
  return (
    <div className="mx-auto my-8 max-w-md rounded-[22px] bg-white p-6 text-center shadow-[0_8px_30px_-14px_rgba(20,40,80,0.3)] ring-1 ring-black/5">
      {icon && <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ color, background: color ? `${color}14` : undefined }}>{icon}</div>}
      <h3 className="text-base font-semibold text-night-900">{title}</h3>
      {children && <div className="mt-1.5 text-sm leading-relaxed text-mist-500">{children}</div>}
    </div>
  )
}

/** Carte blanche arrondie façon iOS. */
export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`rounded-[22px] bg-white shadow-[0_6px_24px_-12px_rgba(20,40,80,0.28)] ring-1 ring-black/[0.04] ${className}`} style={style}>{children}</div>
}

export const SEX_GRADIENT: Record<'M' | 'F' | 'X', [string, string]> = {
  M: ['#7fb4f5', '#3f7fdc'],
  F: ['#f8b1a3', '#e5765f'],
  X: ['#c7ccd6', '#8f97a6'],
}
export const sexKey = (s: string | null | undefined): 'M' | 'F' | 'X' => (s === 'M' ? 'M' : s === 'F' ? 'F' : 'X')

/** Avatar rond : photo si portrait, sinon silhouette bleue (homme) / saumon (femme). */
export function PersonAvatar({ p, size = 40, ring = false }: { p: Pick<PersonSummary, 'sex' | 'portrait_media_id' | 'display_name'>; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false)
  const [a, b] = SEX_GRADIENT[sexKey(p.sex)]
  const style = { width: size, height: size, background: `linear-gradient(160deg, ${a}, ${b})` }
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white ${ring ? 'ring-2 ring-white shadow-md' : ''}`} style={style}>
      {p.portrait_media_id && !broken
        ? <img src={api.mediaFileUrl(p.portrait_media_id)} alt={p.display_name} className="h-full w-full object-cover" onError={() => setBroken(true)} draggable={false} />
        : <User size={size * 0.6} fill="currentColor" strokeWidth={1} className="translate-y-[8%]" />}
    </span>
  )
}

export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t.replace(/_/g, ' ')

/** « 1928 – 1998 » ; vide si aucune année. */
export function lifeYears(p: Pick<PersonSummary, 'birth_year' | 'death_year' | 'is_living'>) {
  if (!p.birth_year && !p.death_year) return p.is_living ? 'vivant(e)' : ''
  return `${p.birth_year ?? '?'} – ${p.death_year ?? (p.is_living ? '' : '?')}`.trim()
}

/** Première partie d'un nom de lieu (« Nancy, Meurthe-et-Moselle » → « Nancy »). */
export const shortPlace = (s: string | null | undefined) => (s ? s.split(',')[0].trim() : '')

const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/
export function parseIso(s: string | null | undefined): { y: number; m: number | null; d: number | null } | null {
  if (!s) return null
  const m = ISO.exec(s)
  if (!m) return null
  return { y: Number(m[1]), m: m[2] ? Number(m[2]) : null, d: m[3] ? Number(m[3]) : null }
}

/** Âge entre deux dates ISO, au format MacFamilyTree « 82a 5m 12j » si les dates sont complètes, sinon « ≈ 82 ans ». */
export function ageBetween(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = parseIso(from), b = parseIso(to)
  if (!a || !b) return null
  if (a.m && a.d && b.m && b.d) {
    let y = b.y - a.y, mo = b.m - a.m, d = b.d - a.d
    if (d < 0) { mo -= 1; d += new Date(b.y, b.m - 1, 0).getDate() }
    if (mo < 0) { y -= 1; mo += 12 }
    if (y < 0) return null
    return `${y}a ${mo}m ${d}j`
  }
  const y = b.y - a.y
  if (y < 0) return null
  return `≈ ${y} an${y > 1 ? 's' : ''}`
}

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss').replace(/đ/g, 'd')
}

/** Choix d'une personne dans une feuille iOS (recherche). */
export function PersonPickerSheet({ persons, currentId, onPick, onClose, title = 'Choisir une personne', color }: { persons: PersonSummary[]; currentId?: string | null; onPick: (id: string) => void; onClose: () => void; title?: string; color?: string }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const n = normalize(q.trim())
    return persons.filter((p) => !n || normalize(p.display_name).includes(n)).slice(0, 200)
  }, [persons, q])
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-2.5 text-mist-400" />
        <input className="input pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {q && <button className="absolute right-2 top-2 rounded-full bg-black/5 p-0.5" onClick={() => setQ('')} aria-label="Effacer"><X size={14} /></button>}
      </div>
      <div className="max-h-[55vh] divide-y divide-black/5 overflow-auto rounded-2xl bg-white ring-1 ring-black/5">
        {list.map((p) => (
          <button key={p.id} onClick={() => { onPick(p.id); onClose() }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[0.03]">
            <PersonAvatar p={p} size={30} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${p.id === currentId ? 'font-semibold' : ''}`} style={p.id === currentId ? { color } : undefined}>{p.display_name}</span>
              <span className="block text-xs text-mist-500">{lifeYears(p)}</span>
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="p-4 text-center text-sm text-mist-500">Aucune personne trouvée.</p>}
      </div>
    </Sheet>
  )
}

/** Interrupteur iOS. */
export function Toggle({ checked, onChange, label, color = '#34c759' }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; color?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm text-night-900">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors" style={{ background: checked ? color : '#e3e5ea' }}>
        <span className="absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow transition-all" style={{ left: checked ? 22 : 2 }} />
      </button>
    </label>
  )
}

/** Contrôle segmenté iOS. */
export function Segmented<T extends string>({ value, onChange, options, color }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; color?: string }) {
  return (
    <div className="flex rounded-xl bg-black/[0.06] p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`flex-1 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium transition-all ${o.id === value ? 'bg-white shadow-sm' : 'text-mist-500'}`}
          style={o.id === value ? { color } : undefined}>{o.label}</button>
      ))}
    </div>
  )
}
