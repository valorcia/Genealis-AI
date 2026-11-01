import { Camera, Languages, MapPin, Stamp, Users } from 'lucide-react'
import type { Reading } from '../../lib/paleoApi'

const LANG_FR: Record<string, string> = { fr: 'français', en: 'anglais', la: 'latin', de: 'allemand', it: 'italien', pl: 'polonais', ru: 'russe' }

/** Traduction en parallèle, ligne par ligne quand le modèle l'a fournie. */
export function TranslationPanel({ reading, selectedLine, onSelectLine }: { reading: Reading; selectedLine: number | null; onSelectLine: (n: number) => void }) {
  const perLine = reading.lines.some((l) => l.translation)
  const target = LANG_FR[reading.translation_language ?? 'fr'] ?? reading.translation_language
  return (
    <section className="panel flex min-h-0 flex-col p-0">
      <header className="flex items-center gap-2 border-b border-[var(--hairline)] px-4 py-3">
        <Languages size={17} className="text-ios-blue" />
        <h2 className="font-display text-[18px] text-night-900">Traduction</h2>
        {reading.translation && <span className="text-[12.5px] text-mist-500">en {target}</span>}
      </header>
      {!reading.translation && !perLine ? (
        <p className="p-4 text-[14px] text-mist-500">
          {reading.language === (reading.translation_language ?? 'fr') || reading.language === 'fr'
            ? 'Le document est déjà en français : pas de traduction nécessaire. La version « Modernisée » de la transcription aide à le lire.'
            : 'Pas de traduction pour cette lecture. Relancez la lecture en demandant une traduction.'}
        </p>
      ) : perLine ? (
        <ol className="min-h-0 flex-1 divide-y divide-[var(--hairline)] overflow-auto scrollbar-thin">
          {reading.lines.map((ln) => (
            <li key={ln.n} onClick={() => onSelectLine(ln.n)}
              className={`flex cursor-pointer gap-2.5 px-3 py-2.5 text-[14.5px] leading-relaxed sm:px-4 ${selectedLine === ln.n ? 'bg-ios-violet/[0.06]' : 'hover:bg-ivory-100/80'}`}>
              <span className="mt-0.5 w-6 shrink-0 text-right text-[11.5px] tabular-nums text-mist-400">{ln.n}</span>
              <span className={ln.translation ? 'text-night-900' : 'text-mist-400'}>{ln.translation ?? '—'}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-[14.5px] leading-relaxed text-night-900 scrollbar-thin">{reading.translation}</p>
      )}
      <p className="border-t border-[var(--hairline)] px-4 py-2 text-[11.5px] text-mist-500">Traduction automatique d’une lecture elle-même à vérifier : ne citez que le texte original.</p>
    </section>
  )
}

/** Analyse d'une photographie : jamais d'identification d'une personne par son visage. */
export function PhotoPanel({ reading }: { reading: Reading }) {
  const p = reading.photo_analysis
  const stamp = p.photographer_stamp
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-display text-[18px] text-night-900"><Camera size={17} className="text-gold-600" />Ce que montre la photo</h2>
      <p className="rounded-xl bg-ivory-100 px-3 py-2 text-[12.5px] text-night-800">Par principe, GENEALIS n’identifie <strong>jamais</strong> une personne à partir de son visage. Seuls les éléments visibles et les inscriptions sont décrits.</p>
      {p.description && <p className="text-[14.5px] text-night-900">{p.description}</p>}
      {(p.people?.length ?? 0) > 0 && (
        <div>
          <div className="label flex items-center gap-1"><Users size={12} />{p.people_count ?? p.people?.length} personne(s) représentée(s)</div>
          <ul className="space-y-1 text-[13.5px]">
            {p.people?.map((x, i) => <li key={i} className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-ivory-200">{[x.position, x.apparent_age_group, x.clothing, x.objects, x.posture].filter(Boolean).join(' · ') || 'non décrite'}</li>)}
          </ul>
        </div>
      )}
      {(p.visible_elements?.length ?? 0) > 0 && <div><div className="label">Éléments visibles</div><p className="text-[13.5px]">{p.visible_elements?.join(', ')}</p></div>}
      {stamp && (stamp.text || stamp.studio) && <div><div className="label flex items-center gap-1"><Stamp size={12} />Cachet du photographe</div><p className="text-[13.5px]">{[stamp.text, stamp.studio, stamp.city].filter(Boolean).join(' · ')}</p></div>}
      {(p.geographic_clues?.length ?? 0) > 0 && <div><div className="label flex items-center gap-1"><MapPin size={12} />Indices géographiques</div><p className="text-[13.5px]">{p.geographic_clues?.join(' ; ')}</p></div>}
      {p.period_estimate?.range && (
        <div><div className="label">Période approximative</div>
          <p className="text-[13.5px]"><strong>{p.period_estimate.range}</strong> (estimation, confiance {({ low: 'faible', medium: 'moyenne', high: 'bonne' } as Record<string, string>)[p.period_estimate.confidence] ?? p.period_estimate.confidence}){p.period_estimate.clues.length ? ` — ${p.period_estimate.clues.join(', ')}` : ''}</p></div>
      )}
      {p.photo_format && <p className="text-[13px] text-mist-500">Format : {p.photo_format}{p.condition ? ` · état : ${p.condition}` : ''}</p>}
    </section>
  )
}
