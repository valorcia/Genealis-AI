/** Éléments partagés du Centre d'investigation : badges d'état, durées, confirmations, états vides, worker. */
import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Info, MonitorSmartphone, PlugZap } from 'lucide-react'
import { Modal } from '../person/helpers'
import { Spinner } from '../ui'
import { INVESTIGATION_STATUS_LABEL, type WorkerInfo, type WorkerStatus } from '../../lib/investigationApi'

/* ---------- Temps ---------- */
export function parseTs(ts: string): number { return new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z').getTime() }
export function relTime(ts: string | null | undefined): string {
  if (!ts) return 'jamais'
  const s = Math.max(0, (Date.now() - parseTs(ts)) / 1000)
  if (s < 45) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.max(1, Math.floor(s / 60))} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(parseTs(ts)).toLocaleDateString('fr-FR')
}
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')}`
}
export function clockTime(ts: string): string { return new Date(parseTs(ts)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }

/* ---------- Badges d'état ---------- */
const STATUS_STYLE: Record<string, string> = {
  running: 'bg-[#ece6ff] text-[#3f2aa8] ring-[#5b3fd6]/25',
  pending: 'bg-mist-200 text-mist-500 ring-black/5',
  paused: 'bg-brass-200/70 text-brass-600 ring-brass-400/30',
  done: 'conf-green ring-conf-green/20',
  blocked: 'conf-orange ring-conf-orange/30',
  to_verify: 'conf-orange ring-conf-orange/20',
  failed: 'conf-red ring-conf-red/20',
  stopped: 'bg-mist-200 text-mist-500 ring-black/5',
  cancelled: 'bg-mist-200 text-mist-500 ring-black/5',
}
export function StatusBadge({ status, label, className = '' }: { status: string; label?: string | null; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.06em] ring-1 ${STATUS_STYLE[status] ?? STATUS_STYLE.pending} ${className}`}>
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5b3fd6]" />}
      {label || INVESTIGATION_STATUS_LABEL[status] || status.toUpperCase()}
    </span>
  )
}

/* ---------- États vides et avertissements ---------- */
export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'error'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const cls = tone === 'error' ? 'border-conf-red/30 bg-conf-red/[0.07]' : tone === 'warn' ? 'border-conf-orange/35 bg-conf-orange/[0.08]' : 'border-[var(--hairline-strong)] bg-ivory-100/70'
  const icon = tone === 'info' ? <Info size={17} className="mt-0.5 shrink-0 text-ios-blue" /> : <AlertTriangle size={17} className={`mt-0.5 shrink-0 ${tone === 'error' ? 'text-conf-red' : 'text-conf-orange'}`} />
  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm text-night-900 ${cls}`}>
      {icon}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={`${title ? 'mt-0.5 ' : ''}text-[13px] leading-relaxed text-night-900/80`}>{children}</div>}
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  )
}
export function Loading({ children = 'Chargement…' }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2 p-4 text-sm text-mist-500"><Spinner />{children}</div>
}

/** Fonction absente de ce moteur (route 404/501) : message rassurant, jamais d'écran blanc. */
export function NotYetAvailable({ what }: { what: string }) {
  return (
    <Notice title={`${what} : pas encore disponible sur ce moteur`}>
      Le moteur GENEALIS installé ne propose pas encore cette fonction (mise à jour en cours). Rien n’est perdu : vos données restent intactes
      et cet écran se remplira automatiquement dès que la fonction sera active.
    </Notice>
  )
}

/* ---------- Confirmation explicite ---------- */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, busy = false, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void
}) {
  const [checked, setChecked] = useState(false)
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>Annuler</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={!checked || busy} onClick={onConfirm}>{busy && <Spinner />}{confirmLabel}</button>
    </>}>
      <div className="space-y-3 text-sm leading-relaxed text-night-900">{children}</div>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-ivory-100 p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5b3fd6]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>J’ai lu et je comprends les conséquences.</span>
      </label>
    </Modal>
  )
}

/* ---------- Navigateur autonome (worker local) ---------- */
export function WorkerHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="text-[13px]">
      <button className="inline-flex items-center gap-1 font-medium text-ios-blue hover:underline" onClick={() => setOpen((v) => !v)}>
        Voir l’installation {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed text-night-900/80">
          <li>Le navigateur autonome ne peut pas fonctionner sur l’hébergement en ligne : il tourne <strong>sur votre ordinateur</strong>, qui ouvre les sites d’archives à votre place.</li>
          <li>Sur votre PC, installez GENEALIS avec l’option « navigateur » (Playwright et Browser Use, gratuits et open source), puis démarrez le navigateur autonome en suivant le guide d’installation fourni avec GENEALIS.</li>
          <li>Laissez-le ouvert : il récupère les missions de navigation, puis renvoie ici les pages consultées, leurs captures et les documents trouvés.</li>
          <li>En attendant, l’enquête continue avec les recherches sur Internet et la lecture des documents que vous avez déjà.</li>
        </ol>
      )}
    </div>
  )
}

export function WorkerCard({ worker, unavailable, compact = false }: { worker: WorkerInfo | WorkerStatus | null; unavailable?: boolean; compact?: boolean }) {
  const online = Boolean(worker?.online)
  const st = worker as WorkerStatus | null
  return (
    <div className={`rounded-2xl border p-3.5 ${online ? 'border-conf-green/25 bg-conf-green/[0.06]' : 'border-[var(--hairline)] bg-ivory-50'}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${online ? 'bg-conf-green/15 text-[#2c6a3b]' : 'bg-mist-200 text-mist-500'}`}>
          {online ? <MonitorSmartphone size={18} /> : <PlugZap size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-night-900">
            {online ? 'Navigateur autonome connecté' : unavailable ? 'Navigateur autonome : non installé' : 'Navigateur autonome non connecté'}
          </div>
          <div className="text-[13px] leading-snug text-night-900/70">
            {online
              ? <>Votre ordinateur peut ouvrir les sites d’archives. Dernier signal {relTime(worker?.last_seen)}{worker?.worker_id ? ` · ${worker.worker_id}` : ''}.</>
              : unavailable
                ? 'Le navigateur autonome tourne sur votre ordinateur : voir l’installation.'
                : <>Le navigateur autonome tourne sur votre ordinateur. {worker?.last_seen ? `Dernier signal ${relTime(worker.last_seen)}.` : 'Aucun signal reçu pour l’instant.'} Les recherches qui demandent d’ouvrir un site attendront qu’il soit démarré.</>}
          </div>
          {online && !compact && st && (st.playwright !== undefined || st.browser_use !== undefined) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className={`chip ${st.playwright ? 'conf-green' : 'conf-grey'}`}>Playwright {st.playwright ? 'prêt' : 'absent'}</span>
              <span className={`chip ${st.browser_use ? 'conf-green' : 'conf-grey'}`}>Browser Use {st.browser_use ? 'prêt' : 'absent'}</span>
              {st.mode && <span className="chip conf-grey">mode {st.mode}</span>}
            </div>
          )}
          {!online && <div className="mt-1.5"><WorkerHelp /></div>}
        </div>
      </div>
    </div>
  )
}

/* ---------- Confiance d'une découverte ---------- */
export type Conf = 'green' | 'orange' | 'red' | 'grey'
export function toConf(c: string | null | undefined): Conf {
  const v = (c ?? '').toLowerCase()
  if (v === 'green' || v === 'vert' || v === 'high') return 'green'
  if (v === 'orange' || v === 'medium') return 'orange'
  if (v === 'red' || v === 'rouge' || v === 'contradiction') return 'red'
  return 'grey'
}
