import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, List, Printer, Search, X } from 'lucide-react'
import { generationLabel, type BookBox, type BookOutline } from '../../lib/bookApi'
import './book.css'

/** Fond « bureau » + racine typographique du livre. */
export function BookDesk({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`book-root book-desk ${className}`}>{children}</div>
}

/** Une page de papier avec titre courant et folio. */
export function BookPage({ left, right, folio, children, className = '', id }: {
  left?: ReactNode; right?: ReactNode; folio?: number | null; children: ReactNode; className?: string; id?: string
}) {
  return (
    <section id={id} className={`book-page ${className}`}>
      {(left || right) && <div className="book-runhead"><span className="truncate">{left}</span><span className="shrink-0">{right}</span></div>}
      {children}
      {folio != null && <div className="book-folio">{folio}</div>}
    </section>
  )
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="book-h2">{children}</h2>
}

export function SosaChip({ n, className = '' }: { n: number; className?: string }) {
  return <span className={`book-sosa ${className}`} title={`Numéro Sosa ${n}`}>{n}</span>
}

/** Encadré de contexte général (toujours étiqueté et sourcé, jamais présenté comme un fait familial). */
export function ContextBox({ box }: { box: BookBox }) {
  const [imgOk, setImgOk] = useState(true)
  const [armsOk, setArmsOk] = useState(true)
  if (box.kind === 'epoque') {
    return (
      <aside className="book-box">
        <div className="book-box-title">Mon époque</div>
        <div className="book-epoch">
          {(box.items ?? []).map((it) => (
            <div key={it.label} className="contents">
              <span className="yr">{it.start === it.end ? it.start : `${it.start}–${it.end}`}</span>
              <span><b className="font-semibold">{it.label}</b>{it.text ? ` : ${it.text}` : ''} <span className="italic">{it.age_line}</span></span>
            </div>
          ))}
        </div>
        <div className="book-box-src">Repères historiques généraux (liste GENEALIS) ; les âges sont calculés d’après les dates de l’arbre.</div>
      </aside>
    )
  }
  if (box.kind === 'quotidien') {
    return (
      <aside className="book-box">
        <div className="book-box-kicker">Repère général</div>
        <div className="book-box-title">La vie de tous les jours — {box.title}</div>
        <p className="m-0">{box.text}</p>
        <div className="book-box-src">{box.origin}{box.period ? ` · période ${box.period}` : ''}</div>
      </aside>
    )
  }
  if (box.kind === 'metier') {
    return (
      <aside className="book-box">
        <div className="book-box-kicker">Définition</div>
        <div className="book-box-title">Le métier : {box.title}</div>
        {box.definition && <p className="m-0 italic">{box.definition}</p>}
        {box.text && <p className="m-0 mt-1">{box.text}</p>}
        <div className="book-box-src">{box.url ? <>Source : <a href={box.url} target="_blank" rel="noreferrer">{box.origin}</a></> : box.origin}</div>
      </aside>
    )
  }
  // village
  return (
    <aside className="book-box">
      {(box.image && imgOk) || (box.coat_of_arms && armsOk) ? (
        <div className="book-box-media">
          {box.image && imgOk && <img className="photo" src={box.image} alt={box.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />}
          {box.coat_of_arms && armsOk && <img className="arms" src={box.coat_of_arms} alt={`Blason de ${box.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setArmsOk(false)} />}
        </div>
      ) : null}
      <div className="book-box-kicker">Le village</div>
      <div className="book-box-title">{box.title}</div>
      {box.text && <p className="m-0">{box.text}</p>}
      <div className="book-box-src">Source : {box.url ? <a href={box.url} target="_blank" rel="noreferrer">{box.origin ?? 'Wikipédia'}</a> : box.origin}</div>
    </aside>
  )
}

/** Barre d'outils du lecteur (non imprimée). */
export function BookToolbar({ children, onToc, onPrint }: { children?: ReactNode; onToc?: () => void; onPrint?: () => void }) {
  return (
    <div className="book-noprint sticky top-0 z-20 -mx-1 mb-3 flex flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--hairline)] bg-[rgb(250_246_237/0.92)] px-2 py-1.5 backdrop-blur-xl sm:gap-2">
      <Link to="/livre" className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13.5px] font-medium text-night-800 hover:bg-ivory-200"><BookOpen size={16} /><span className="hidden sm:inline">Le livre</span></Link>
      {onToc && <button onClick={onToc} className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium text-night-800 hover:bg-ivory-200"><List size={16} />Sommaire</button>}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
        {children}
        {onPrint && <button onClick={onPrint} className="btn-ghost !h-9 !px-3" title="Imprimer ou enregistrer en PDF"><Printer size={15} /><span className="hidden sm:inline">Imprimer / PDF</span></button>}
      </div>
    </div>
  )
}

export function NavButton({ to, dir, label }: { to: string | null; dir: 'prev' | 'next'; label?: string }) {
  const cls = 'inline-flex h-9 items-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-ivory-50 px-2.5 text-[13px] font-medium text-night-800'
  const inner = dir === 'prev' ? <><ChevronLeft size={16} /><span className="hidden max-w-[150px] truncate md:inline">{label ?? 'Précédent'}</span></> : <><span className="hidden max-w-[150px] truncate md:inline">{label ?? 'Suivant'}</span><ChevronRight size={16} /></>
  if (!to) return <span className={`${cls} opacity-40`} aria-disabled>{inner}</span>
  return <Link to={to} className={`${cls} hover:bg-white`} aria-label={dir === 'prev' ? 'Chapitre précédent' : 'Chapitre suivant'} title={label}>{inner}</Link>
}

/** Tiroir « Sommaire » : chapitres par génération (numéro Sosa), recherche, annexes. */
export function TocDrawer({ outline, currentId, onClose }: { outline: BookOutline | null; currentId?: string; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => {
    const n = search.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const list = (outline?.chapters ?? []).filter((c) => !n || `${c.name} ${c.place ?? ''} ${c.sosa.join(' ')} ${c.occupation ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n))
    const map = new Map<string, typeof list>()
    for (const c of list) {
      const k = c.is_ancestor && c.generation ? `g${c.generation}` : 'autres'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()]
  }, [outline, search])
  return (
    <div className="book-noprint fixed inset-0 z-[70] flex justify-end" role="dialog" aria-label="Sommaire du livre">
      <button className="fade-in absolute inset-0 bg-night-950/35" aria-label="Fermer" onClick={onClose} />
      <div className="book-root sheet-up relative flex h-full w-full max-w-[420px] flex-col bg-[#fcf8ef] shadow-[0_0_60px_-10px_rgba(0,0,0,0.5)]" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
        <div className="flex items-center gap-2 border-b border-[rgb(122_79_42/0.15)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="book-eyebrow">Sommaire</div>
            <div className="book-sc truncate text-[19px] font-bold">{outline?.title ?? 'Livre de la famille'}</div>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5" aria-label="Fermer le sommaire"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, lieu, numéro Sosa…" className="input !pl-9 font-sans" />
          </label>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
          {!outline && <p className="py-6 text-center italic text-mist-500">Chargement du sommaire…</p>}
          {groups.map(([k, list]) => (
            <div key={k} className="mt-3">
              <div className="book-h3">{k === 'autres' ? 'Autres membres de la famille' : generationLabel(Number(k.slice(1)))}</div>
              {list.map((c) => (
                <Link key={c.person_id} to={`/livre/personne/${c.person_id}`} onClick={onClose}
                  className={`book-toc-row rounded-md px-1.5 ${c.person_id === currentId ? 'bg-[rgb(169_136_67/0.14)]' : 'hover:bg-black/[0.03]'}`}>
                  {c.sosa[0] != null ? <span className="book-sosa">{c.sosa[0]}</span> : <span className="book-sosa opacity-40">·</span>}
                  <span className="nm truncate">{c.name}</span>
                  <span className="dots" />
                  <span className="shrink-0 text-[13px] text-[#85785f]">{c.years || '—'}</span>
                </Link>
              ))}
            </div>
          ))}
          {outline && groups.length === 0 && <p className="py-6 text-center italic text-mist-500">Aucun chapitre ne correspond.</p>}
          <div className="mt-5 border-t border-[rgb(122_79_42/0.15)] pt-3">
            <div className="book-h3">Annexes</div>
            <AnnexLinks outline={outline} onNavigate={onClose} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AnnexLinks({ outline, onNavigate }: { outline: BookOutline | null; onNavigate?: () => void }) {
  const rows: [string, string, string, number | undefined][] = [
    ['A', 'Les métiers', '/livre/metiers', outline?.annexes.trades],
    ['B', 'Les villages', '/livre/villages', outline?.annexes.places],
    ['C', 'Dates à trouver & actes à retrouver', '/livre/a-trouver', outline ? outline.annexes.dates_to_find + outline.annexes.acts_to_find : undefined],
  ]
  return (
    <div>
      {rows.map(([l, t, to, n]) => (
        <Link key={to} to={to} onClick={onNavigate} className="book-toc-row">
          <span className="book-sc w-5 text-[#876a2e]">{l}</span><span className="nm">{t}</span><span className="dots" /><span className="text-[13px] text-[#85785f]">{n ?? ''}</span>
        </Link>
      ))}
    </div>
  )
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="book-link inline-flex items-center gap-0.5">{children}<ExternalLink size={11} /></a>
}

export function BookLoading({ label = 'Mise en page du chapitre…' }: { label?: string }) {
  return (
    <BookDesk>
      <BookPage>
        <div className="animate-pulse space-y-3 py-6">
          <div className="h-3 w-40 rounded bg-[rgb(122_79_42/0.12)]" />
          <div className="h-8 w-72 rounded bg-[rgb(122_79_42/0.14)]" />
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-3 rounded bg-[rgb(122_79_42/0.08)]" style={{ width: `${92 - (i % 3) * 9}%` }} />)}
        </div>
        <p className="text-center text-[14px] italic text-[#85785f]">{label}</p>
      </BookPage>
    </BookDesk>
  )
}
