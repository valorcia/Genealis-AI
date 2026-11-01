import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CONF_LABEL, type Confidence, type PersonSummary } from '../api'

export function ConfidenceDot({ level, className = '' }: { level: Confidence; className?: string }) {
  return <span title={CONF_LABEL[level]} className={`inline-block h-2.5 w-2.5 rounded-full dot-${level} ${className}`} />
}
export function ConfidenceChip({ level }: { level: Confidence }) {
  return <span className={`chip conf-${level}`}><ConfidenceDot level={level} />{CONF_LABEL[level]}</span>
}
export function Panel({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 fade-up ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-[19px] leading-tight text-night-900 sm:text-[21px]">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ivory-50/60 p-6 text-center text-sm text-mist-500">{children}</div>
}
export function PersonLink({ p, className = '' }: { p: PersonSummary; className?: string }) {
  return (
    <Link to={`/personnes/${p.id}`} className={`inline-flex items-center gap-1.5 text-night-900 transition-opacity hover:text-ios-blue ${className}`}>
      <ConfidenceDot level={p.confidence} />
      <span className="font-medium">{p.display_name}</span>
      {(p.birth_year || p.death_year) && <span className="text-xs text-mist-500">({p.birth_year ?? '?'}–{p.death_year ?? (p.is_living ? '' : '?')})</span>}
    </Link>
  )
}
export function Spinner() { return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-mist-200 border-t-night-800" role="status" aria-label="Chargement" /> }
export function Markdown({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>')
    .split('\n').map((l) => (l.startsWith('- ') ? `<li>${l.slice(2)}</li>` : l ? `<p>${l}</p>` : '')).join('')
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`)
  return <div className="markdown prose-sm text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>
}
export function formatTs(ts: string) { const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z'); return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
export function formatDate(ts: string) { const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z'); return d.toLocaleString('fr-FR') }
