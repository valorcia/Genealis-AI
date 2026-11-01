import { useId, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import { ICONS } from '../../navigation/icons'

/**
 * Éléments d'identité GENEALIS : monogramme « cernes d'arbre », logotype serif,
 * médaillon d'icône bichrome, filet doré à fleuron et en-tête éditorial de page.
 * Réutilisables par toutes les pages (aucune dépendance aux données).
 */

/** Monogramme : un disque bleu nuit portant des cernes de croissance dorés, légèrement excentrés comme dans le bois. */
export function Monogram({ size = 34, className = '' }: { size?: number; className?: string }) {
  // Identifiants uniques : un dégradé défini dans un SVG masqué (display:none) ne s'affiche pas ailleurs.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const bg = `gm-bg-${uid}`
  const gold = `url(#gm-gold-${uid})`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Genealis" className={`shrink-0 ${className}`}>
      <defs>
        <radialGradient id={bg} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#2b3d5e" />
          <stop offset="1" stopColor="#111c2e" />
        </radialGradient>
        <linearGradient id={`gm-gold-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6cf95" />
          <stop offset="1" stopColor="#b08d47" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19.5" fill={`url(#${bg})`} />
      <circle cx="20" cy="20" r="17.6" fill="none" stroke={gold} strokeWidth="0.9" opacity="0.95" />
      <circle cx="19.2" cy="20.8" r="13.4" fill="none" stroke={gold} strokeWidth="0.75" opacity="0.7" />
      <circle cx="18.6" cy="21.4" r="9.6" fill="none" stroke={gold} strokeWidth="0.7" opacity="0.55" />
      <circle cx="18.2" cy="21.9" r="6.1" fill="none" stroke={gold} strokeWidth="0.65" opacity="0.45" />
      {/* Pousse : une tige et deux feuilles qui naissent du cœur. */}
      <path d="M18 22.2 C18.4 17.6 19.8 14.4 22.6 11.6" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M21.2 13.3 C23.6 12.6 25.9 13.2 27.4 14.6 C25.2 15.6 22.9 15.2 21.2 13.3 Z" fill={gold} />
      <path d="M19.4 17 C17.4 15.4 15.1 15.2 13.2 16 C14.6 17.8 17 18.3 19.4 17 Z" fill={gold} opacity="0.85" />
      <circle cx="18" cy="22.3" r="1.6" fill={gold} />
    </svg>
  )
}

/** Logotype complet : monogramme + « Genealis » en serif, avec la mention « ia » en violet. */
export function Wordmark({ size = 'md', subtitle = true, className = '' }: { size?: 'sm' | 'md' | 'lg'; subtitle?: boolean; className?: string }) {
  const mono = size === 'lg' ? 42 : size === 'md' ? 34 : 28
  const text = size === 'lg' ? 'text-[26px]' : size === 'md' ? 'text-[21px]' : 'text-[19px]'
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Monogram size={mono} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className={`font-display ${text} leading-none text-night-900`} style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>
          Genealis<span className="ml-[3px] align-super text-[0.5em] font-sans font-semibold tracking-[0.08em] text-gold-600">IA</span>
        </span>
        {subtitle && <span className="eyebrow mt-1 !text-[9.5px] !tracking-[0.22em] text-brass-600">Archives de famille</span>}
      </span>
    </span>
  )
}

/** Filet doré avec un petit losange (fleuron) — séparateur éditorial. */
export function GoldRule({ className = '', color, align = 'left' }: { className?: string; color?: string; align?: 'left' | 'center' }) {
  const c = color ?? 'var(--color-brass-400)'
  if (align === 'center') {
    return (
      <div aria-hidden className={`flex items-center gap-2 ${className}`}>
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${c})` }} />
        <span className="h-[7px] w-[7px] rotate-45 border" style={{ borderColor: c }} />
        <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${c}, transparent)` }} />
      </div>
    )
  }
  return (
    <div aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="h-px w-10 shrink-0" style={{ background: c }} />
      <span className="h-[6px] w-[6px] shrink-0 rotate-45" style={{ background: c }} />
      <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${c} 45%, transparent), transparent)` }} />
    </div>
  )
}

/**
 * Médaillon d'icône bichrome : pastille ronde teintée, cerne fin de la couleur, icône au trait
 * avec un remplissage translucide. `icon` est un nom d'icône de navigation (voir navigation/icons.tsx).
 */
export function Medallion({ icon, color, size = 44, solid = false, className = '' }: { icon: string; color: string; size?: number; solid?: boolean; className?: string }) {
  const Icon = ICONS[icon] ?? Star
  const glyph = Math.round(size * 0.48)
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        width: size, height: size,
        background: solid
          ? `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${color} 72%, white) 0%, ${color} 70%)`
          : `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${color} 5%, #fffdf8) 0%, color-mix(in srgb, ${color} 17%, #fffdf8) 80%)`,
        boxShadow: solid
          ? `0 1px 0 rgb(255 255 255 / 0.25) inset, 0 6px 14px -8px ${color}`
          : `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent), 0 1px 0 rgb(255 255 255 / 0.9)`,
        color: solid ? '#fffdf8' : color,
      }}
    >
      {!solid && <span className="absolute rounded-full" style={{ inset: Math.max(3, size * 0.09), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 16%, transparent)` }} />}
      <Icon size={glyph} strokeWidth={size >= 48 ? 1.6 : 1.8} fill="currentColor" fillOpacity={solid ? 0.18 : 0.14} className="relative" />
    </span>
  )
}

/**
 * En-tête éditorial de page : accroche en capitales, titre serif, une phrase d'explication, filet doré.
 * À utiliser en haut des pages pour une présentation cohérente avec les chapitres.
 */
export function PageHeader({ eyebrow, title, description, color, numeral, aside, children, className = '' }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; color?: string; numeral?: string; aside?: ReactNode; children?: ReactNode; className?: string
}) {
  const c = color ?? 'var(--color-brass-600)'
  return (
    <header className={`fade-up relative pb-5 pt-2 sm:pb-7 sm:pt-4 ${className}`}>
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="eyebrow mb-2 flex items-center gap-2" style={{ color: c }}>
              {numeral && <span className="font-display text-[13px] normal-case tracking-normal" style={{ fontWeight: 500 }}>{numeral}</span>}
              {numeral && <span aria-hidden className="h-px w-4" style={{ background: c, opacity: 0.6 }} />}
              <span>{eyebrow}</span>
            </p>
          )}
          <h1 className="font-display text-[34px] leading-[1.04] text-night-900 sm:text-[48px]" style={{ fontWeight: 520, letterSpacing: '-0.025em' }}>{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-[14.5px] leading-snug text-mist-500 sm:text-[16px]">{description}</p>}
        </div>
        {aside && <div className="hidden shrink-0 sm:block">{aside}</div>}
      </div>
      <GoldRule className="mt-4 sm:mt-5" />
      {children}
    </header>
  )
}
