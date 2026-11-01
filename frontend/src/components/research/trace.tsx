import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { TASK_STATUS_LABEL } from '../../api'
import { faviconUrl, type StepOutcome, type TraceTaskBrief } from '../../lib/traceApi'

/** Logo du site (favicon) avec une lettre en repli si l'image ne charge pas. */
export function SiteIcon({ domain, name, size = 32 }: { domain: string | null | undefined; name?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = (name || domain || '?').replace(/^(www\.|archives?\s+)/i, '').charAt(0).toUpperCase()
  const box = { width: size, height: size }
  if (!domain || failed) {
    return <span className="flex shrink-0 items-center justify-center rounded-xl bg-[#ece6ff] text-[13px] font-bold text-[#3f2aa8]" style={box} aria-hidden>{letter}</span>
  }
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-black/10" style={box} aria-hidden>
      <img src={faviconUrl(domain)} alt="" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}

export const OUTCOME: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Trouvé', cls: 'conf-green' },
  no_result: { label: 'Rien trouvé', cls: 'conf-grey' },
  restricted: { label: 'Accès refusé', cls: 'conf-orange' },
  error: { label: 'Erreur', cls: 'conf-red' },
  manual: { label: 'À consulter vous-même', cls: 'bg-[#ece6ff] text-[#3f2aa8]' },
  pending: { label: 'Pas encore fait', cls: 'conf-grey' },
  running: { label: 'En cours…', cls: 'conf-orange' },
  skipped: { label: 'Non nécessaire', cls: 'conf-grey' },
  done: { label: 'Fait', cls: 'conf-green' },
  deferred: { label: 'Reportée (limite d’appels IA)', cls: 'conf-orange' },
}

export function OutcomeChip({ outcome }: { outcome: StepOutcome | null | undefined }) {
  const o = OUTCOME[outcome ?? 'pending'] ?? { label: String(outcome), cls: 'conf-grey' }
  return <span className={`chip whitespace-nowrap ${o.cls}`}>{o.label}</span>
}

export const RELIABILITY: Record<string, { label: string; cls: string; hint: string }> = {
  primary: { label: 'Acte original', cls: 'conf-green', hint: 'Image ou transcription de l’acte lui-même.' },
  secondary: { label: 'Index / relevé', cls: 'bg-[#dfeafc] text-[#1f4f99]', hint: 'Relevé ou index : fiable mais à confronter à l’acte.' },
  derivative: { label: 'Arbre en ligne (piste à vérifier)', cls: 'conf-orange', hint: 'Arbre publié par un particulier : jamais une preuve.' },
  unknown: { label: 'Fiabilité inconnue', cls: 'conf-grey', hint: '' },
}
export function ReliabilityBadge({ value }: { value: string | null | undefined }) {
  const r = RELIABILITY[value ?? 'unknown'] ?? RELIABILITY.unknown
  return <span className={`chip whitespace-nowrap ${r.cls}`} title={r.hint}>{r.label}</span>
}

export const TASK_STATUS_CLASS: Record<string, string> = { queued: 'conf-grey', running: 'conf-orange', waiting_user: 'bg-[#ece6ff] text-[#3f2aa8]', done: 'conf-green', failed: 'conf-red', paused: 'conf-grey', cancelled: 'conf-grey' }
export function TaskStatusChip({ status }: { status: string }) {
  return <span className={`chip whitespace-nowrap ${TASK_STATUS_CLASS[status] ?? 'conf-grey'}`}>{TASK_STATUS_LABEL[status] ?? status}</span>
}

export function shortDate(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z')
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Une recherche effectuée, résumée en une ligne cliquable. */
export function TaskLine({ t, showPerson = false }: { t: TraceTaskBrief; showPerson?: boolean }) {
  const s = t.summary
  const sites = s.sites.filter((x) => x.action === 'search')
  return (
    <Link to={`/enquetes/${t.id}`} className="group flex items-start gap-3 rounded-2xl px-2 py-2.5 hover:bg-black/[0.03]">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.found ? 'bg-conf-green' : t.status === 'done' ? 'bg-mist-400' : t.status === 'failed' ? 'bg-conf-red' : 'bg-conf-orange'}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-medium leading-snug text-night-900">{showPerson && t.person_name ? `${t.person_name} — ` : ''}{t.type_label}</span>
          <TaskStatusChip status={t.status} />
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-mist-500">{s.sentence}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-mist-400">
          <span>{shortDate(t.finished_at ?? t.created_at)}</span>
          {sites.length > 0 && <span aria-hidden>·</span>}
          {sites.slice(0, 5).map((x, i) => <span key={i} className={`rounded-full px-1.5 py-0.5 ${x.status === 'ok' ? 'bg-[#e3f4e6] text-[#2f6b3b]' : x.status === 'error' ? 'bg-[#fde8e6] text-[#7d2b22]' : 'bg-[#f1f2f6] text-mist-500'}`}>{x.connector_id === 'gemini_web' ? 'Gemini' : x.site ?? x.name}</span>)}
          {sites.length > 5 && <span>+{sites.length - 5}</span>}
        </span>
      </span>
      <ChevronRight size={17} className="mt-1 shrink-0 text-mist-400 group-hover:text-night-900" />
    </Link>
  )
}

/** Liste des recherches effectuées, regroupées par personne (les plus récentes d'abord). */
export function SearchesByPerson({ tasks }: { tasks: TraceTaskBrief[] }) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const m = new Map<string, { key: string; name: string; personId: string | null; items: TraceTaskBrief[] }>()
    for (const t of tasks) {
      if (f && !(t.person_name ?? '').toLowerCase().includes(f) && !t.type_label.toLowerCase().includes(f)) continue
      const key = t.person_id ?? 'none'
      if (!m.has(key)) m.set(key, { key, name: t.person_name ?? 'Sans personne', personId: t.person_id, items: [] })
      m.get(key)?.items.push(t)
    }
    return [...m.values()]
  }, [tasks, filter])
  return (
    <div className="space-y-3">
      {tasks.length > 6 && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-mist-400" />
          <input className="input pl-9" placeholder="Filtrer par personne…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      {groups.length === 0 && <p className="text-sm text-mist-500">Aucune recherche ne correspond.</p>}
      {groups.map((g) => (
        <section key={g.key} className="panel fade-up p-3 sm:p-4">
          <h3 className="mb-1 flex items-center justify-between gap-2 px-2 text-[16px] font-semibold text-night-900">
            {g.personId ? <Link to={`/personnes/${g.personId}`} className="hover:text-[#2f6fd1]">{g.name}</Link> : g.name}
            <span className="text-xs font-normal text-mist-500">{g.items.length} recherche{g.items.length > 1 ? 's' : ''}</span>
          </h3>
          <div className="divide-y divide-black/5">{g.items.map((t) => <TaskLine key={t.id} t={t} />)}</div>
        </section>
      ))}
    </div>
  )
}
