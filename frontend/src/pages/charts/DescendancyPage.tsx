import { memo, useRef } from 'react'
import type { PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { Avatar } from '../../components/charts/Avatar'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { CardStylePanel } from '../../components/charts/CardOptionsPanel'
import { childGroups, partnersOf, useFamily, type FamilyIndex } from '../../components/charts/family'
import { birthText, deathAge, deathText, fullName, GRAPH_COLOR } from '../../components/charts/format'
import { cardBackground, DEFAULT_CARD_OPTIONS, type CardOptions } from '../../components/charts/PersonCard'
import { Spinner } from '../../components/ui'

interface Opts extends CardOptions { gens: number; partners: boolean; numbers: boolean }

function Line({ p, opts }: { p: PersonSummary; opts: Opts }) {
  const b = birthText(p), d = deathText(p), age = deathAge(p)
  return (
    <span className="block text-[11.5px] leading-snug text-night-900/70">
      {b && <span className="mr-2 whitespace-nowrap">☆ {b}{opts.showPlaces && p.birth_place ? <span className="text-night-900/50"> · {p.birth_place}</span> : null}</span>}
      {d && <span className="whitespace-nowrap">† {d}{age ? ` (${age})` : ''}{opts.showPlaces && p.death_place ? <span className="text-night-900/50"> · {p.death_place}</span> : null}</span>}
      {!b && !d && <span className="text-mist-400">Dates inconnues</span>}
    </span>
  )
}

const Branch = memo(function Branch({ ix, id, depth, number, opts, onPick, seen }: { ix: FamilyIndex; id: string; depth: number; number: string; opts: Opts; onPick: (id: string) => void; seen: Set<string> }) {
  const p = ix.persons.get(id)
  if (!p) return null
  seen.add(id)
  const partners = opts.partners ? partnersOf(ix, id) : []
  const groups = depth < opts.gens ? childGroups(ix, id, partnersOf(ix, id)) : []
  const kids = groups.flatMap((g) => g.kids.map((k) => ({ k, partner: g.partner }))).filter(({ k }) => !seen.has(k))
  return (
    <div className="relative">
      <div className="relative flex items-stretch gap-2">
        <button onClick={() => onPick(id)} className={`flex min-w-0 max-w-[560px] flex-1 items-center gap-2.5 rounded-2xl px-3 py-2 text-left shadow-[0_4px_14px_-8px_rgba(25,35,70,0.35)] transition-transform hover:-translate-y-0.5 ${depth === 0 ? 'ring-[3px] ring-[#7d828f]' : 'ring-1 ring-black/10'}`} style={{ background: cardBackground(p, opts.colorMode) }}>
          {opts.showPhotos && <Avatar person={p} size={40} />}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              {opts.numbers && <span className="shrink-0 rounded-full bg-black/5 px-1.5 text-[10px] font-semibold tabular-nums text-mist-500" title="Numérotation d’Aboville">{number}</span>}
              <span className="truncate text-[14px] font-bold text-night-900">{fullName(p)}</span>
            </span>
            <Line p={p} opts={opts} />
            {partners.map((sid) => { const s = ix.persons.get(sid); return s ? <span key={sid} className="mt-0.5 block truncate text-[11.5px] text-night-900/80"><span className="font-semibold text-[#13918c]">∞</span> {fullName(s)}{s.birth_year || s.death_year ? <span className="text-night-900/50"> ({s.birth_year ?? '?'}–{s.death_year ?? ''})</span> : null}</span> : null })}
          </span>
        </button>
      </div>
      {kids.length > 0 && (
        <div className="relative ml-3 mt-1.5 space-y-1.5 border-l-2 border-[#13918c]/35 pl-2.5 sm:ml-[26px] sm:pl-6">
          {kids.map(({ k }, i) => (
            <div key={k} className="relative">
              <span className="absolute -left-2.5 top-6 h-0.5 w-2.5 bg-[#13918c]/35 sm:-left-6 sm:w-5" />
              <Branch ix={ix} id={k} depth={depth + 1} number={`${number}.${i + 1}`} opts={opts} onPick={onPick} seen={seen} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default function DescendancyPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('descendance', { ...DEFAULT_CARD_OPTIONS, showPlaces: false, gens: 4, partners: true, numbers: true })
  const { data, loading, error } = useFamily(focusId, 0, opts.gens, { detailLimit: 250 })
  const ref = useRef<HTMLDivElement>(null)
  const name = focus ? fullName(focus) : ''
  const count = data?.descendants ? data.descendants.nodes.length - 1 : 0

  return (
    <ChartFrame title={`Descendance${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Descendance"><p>Tous les descendants de la personne choisie, génération après génération, avec leurs conjoints (∞). Le numéro (1.2.1…) suit la numérotation d’Aboville : le 2ᵉ enfant du 1ᵉʳ enfant porte 1.1.2, etc.</p><p>Touchez une personne pour afficher sa propre descendance.</p></HelpText>}
      actions={<ChartActions exportTarget={() => ref.current} filename={`Descendance ${name}`} />}
      styleOptions={<CardStylePanel opts={opts} onChange={setOpts} />}
      options={<>
        <OptionGroup title="Générations"><SliderRow label="Générations" value={opts.gens} min={1} max={10} onChange={(v) => setOpts({ gens: v })} /></OptionGroup>
        <OptionGroup title="Contenu">
          <ToggleRow label="Conjoints" checked={opts.partners} onChange={(v) => setOpts({ partners: v })} />
          <ToggleRow label="Numérotation d’Aboville" checked={opts.numbers} onChange={(v) => setOpts({ numbers: v })} />
          <ToggleRow label="Lieux" checked={opts.showPlaces} onChange={(v) => setOpts({ showPlaces: v })} />
          <ToggleRow label="Photos" checked={opts.showPhotos} onChange={(v) => setOpts({ showPhotos: v })} />
        </OptionGroup>
      </>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <div className="mx-auto max-w-4xl">
          {(loading || pl) && <div className="mb-2 flex items-center gap-2 text-xs text-mist-500"><Spinner /> Chargement de la descendance…</div>}
          {error && <p className="mb-2 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red">{error}</p>}
          {data && focusId && (
            <div ref={ref} className="chart-print-area rounded-3xl bg-white/85 p-3 shadow-sm ring-1 ring-black/5 sm:p-5">
              <p className="mb-3 text-xs text-mist-500">{count === 0 ? 'Aucun descendant connu pour l’instant.' : `${count} descendant${count > 1 ? 's' : ''} sur ${opts.gens} génération${opts.gens > 1 ? 's' : ''} au plus.`}</p>
              <Branch ix={data.index} id={focusId} depth={0} number="1" opts={opts} onPick={setFocusId} seen={new Set()} />
            </div>
          )}
        </div>
      )}
    </ChartFrame>
  )
}
