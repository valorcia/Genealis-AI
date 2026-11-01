import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PersonSummary } from '../../api'
import { COLORS } from '../views/common'
import { ConfidenceDot } from '../ui'

export const RC = COLORS.rapports

/**
 * Styles d'impression A4 : seul le rapport est imprimé, sur toute sa hauteur (les conteneurs défilants
 * de l'application sont neutralisés), sans barre de navigation.
 */
export function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4; margin: 14mm 12mm; }
        html, body { background: #fff !important; }
        body *:not(:has(.report-doc)):not(.report-doc):not(.report-doc *) { display: none !important; }
        body *:has(.report-doc) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; background: none !important; box-shadow: none !important; border: 0 !important; transform: none !important; backdrop-filter: none !important; }
        .report-doc { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; max-width: none !important; margin: 0 !important; }
        .report-doc a { color: inherit !important; text-decoration: none !important; }
        .report-doc .no-print { display: none !important; }
        .report-doc tr, .report-doc li, .report-doc .avoid-break { break-inside: avoid; }
        .report-doc h2 { break-after: avoid; }
        .report-doc .print-scroll { overflow: visible !important; }
      }
    `}</style>
  )
}

const today = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Feuille de rapport façon page A4. */
export function ReportDoc({ title, subject, intro, children }: { title: string; subject?: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="report-doc fade-up mx-auto w-full max-w-[210mm] rounded-[24px] bg-white px-4 py-6 text-[13.5px] leading-relaxed text-night-900 shadow-[0_10px_40px_-18px_rgba(60,30,10,0.45)] ring-1 ring-black/[0.04] sm:px-10 sm:py-10">
      <header className="mb-6 border-b pb-4" style={{ borderColor: `${RC}33` }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mist-500">GENEALIS AI · Rapport généalogique</p>
        <h1 className="mt-1 text-[26px] font-bold leading-tight sm:text-[30px]" style={{ color: RC }}>{title}</h1>
        {subject && <div className="mt-0.5 text-base font-medium text-night-900">{subject}</div>}
        <p className="mt-1 text-xs text-mist-500">Établi le {today()}</p>
        {intro && <div className="mt-3 text-sm text-mist-500">{intro}</div>}
      </header>
      {children}
      <footer className="mt-10 border-t pt-3 text-[10px] text-mist-400" style={{ borderColor: `${RC}22` }}>Rapport établi à partir des seules données enregistrées dans votre arbre — aucune information n’est inventée.</footer>
    </article>
  )
}

export function RSection({ title, children, count, className = '' }: { title: ReactNode; children: ReactNode; count?: number; className?: string }) {
  return (
    <section className={`mt-7 first:mt-0 ${className}`}>
      <h2 className="mb-2.5 flex items-baseline gap-2 border-b pb-1 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: RC, borderColor: `${RC}26` }}>
        {title}{typeof count === 'number' && <span className="text-[11px] font-medium normal-case tracking-normal text-mist-500">({count})</span>}
      </h2>
      {children}
    </section>
  )
}

export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-[minmax(92px,auto)_1fr] gap-x-4 gap-y-1">
      {shown.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="font-medium text-mist-500">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Tableau de rapport : fiches empilées sur iPhone, tableau sur grand écran et à l'impression. */
export function RTable({ head, rows, empty = 'Aucune donnée.', compact = false }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string; compact?: boolean }) {
  if (!rows.length) return <p className="text-sm italic text-mist-500">{empty}</p>
  return (
    <>
      <ul className="divide-y sm:hidden print:hidden" style={{ borderColor: `${RC}1f` }}>
        {rows.map((r, i) => (
          <li key={i} className="py-2" style={{ borderColor: `${RC}1f` }}>
            <div className="text-[14px]">{r[0]}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
              {r.slice(1).map((c, j) => (c === null || c === undefined || c === '' || c === false) ? null : (
                <span key={j} className="min-w-0"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-mist-400">{head[j + 1]}</span>{c}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="print-scroll -mx-1 hidden overflow-x-auto px-1 sm:block print:block">
        <table className={`w-full border-collapse ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
          <thead>
            <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap border-b px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-mist-500" style={{ borderColor: `${RC}33` }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-top odd:bg-[#fbf6f1]">
                {r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Lien vers la fiche d'une personne (sobre à l'impression). */
export function PersonRef({ p, years = true, dot = false }: { p: Pick<PersonSummary, 'id' | 'display_name'> & Partial<Pick<PersonSummary, 'birth_year' | 'death_year' | 'is_living' | 'confidence'>>; years?: boolean; dot?: boolean }) {
  const y = years && (p.birth_year || p.death_year) ? ` (${p.birth_year ?? '?'}–${p.death_year ?? (p.is_living ? '' : '?')})` : ''
  return (
    <Link to={`/personnes/${p.id}`} className="font-semibold decoration-1 underline-offset-2 hover:underline" style={{ color: '#3a2a1c' }}>
      {dot && p.confidence && <ConfidenceDot level={p.confidence} className="mr-1 !h-2 !w-2 align-middle" />}{p.display_name}<span className="font-normal text-mist-500">{y}</span>
    </Link>
  )
}

/** Résumé « ° 12/05/1990 Nancy — † 1998 Toul ». */
export function lifeLine(p: Pick<PersonSummary, 'birth_display' | 'birth_place' | 'death_display' | 'death_place' | 'birth_year' | 'death_year'>) {
  const b = p.birth_display ?? (p.birth_year ? String(p.birth_year) : null)
  const d = p.death_display ?? (p.death_year ? String(p.death_year) : null)
  const parts: string[] = []
  if (b || p.birth_place) parts.push(`° ${b ?? ''}${p.birth_place ? ` ${b ? 'à ' : ''}${p.birth_place}` : ''}`.trim())
  if (d || p.death_place) parts.push(`† ${d ?? ''}${p.death_place ? ` ${d ? 'à ' : ''}${p.death_place}` : ''}`.trim())
  return parts.join(' — ')
}

export function Muted({ children }: { children: ReactNode }) { return <span className="text-mist-500">{children}</span> }

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="avoid-break rounded-2xl bg-[#fbf3ec] px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-mist-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: tone ?? RC }}>{value}</div>
      {sub && <div className="text-[11px] text-mist-500">{sub}</div>}
    </div>
  )
}
