import { useCallback, useMemo, useState } from 'react'
import type { PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { AddRelativeSheet } from '../../components/relatives/AddRelative'
import CardTree from '../../components/charts/CardTree'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { CardContentToggles, CardStylePanel } from '../../components/charts/CardOptionsPanel'
import { sosaIndex, useAncestors } from '../../components/charts/family'
import { fullName, GRAPH_COLOR } from '../../components/charts/format'
import { horizontalPedigree } from '../../components/charts/pedigree'
import { DEFAULT_CARD_OPTIONS, type CardOptions } from '../../components/charts/PersonCard'
import { Spinner } from '../../components/ui'

interface Opts extends CardOptions { gens: number; slots: boolean }

export default function PedigreePage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('ascendance', { ...DEFAULT_CARD_OPTIONS, showSosa: true, gens: 4, slots: true })
  const { graph, loading, error, reload } = useAncestors(focusId, Math.max(1, opts.gens - 1))
  const [adding, setAdding] = useState<{ child: PersonSummary; kind: 'father' | 'mother' } | null>(null)
  const onAdd = useCallback((child: PersonSummary, kind: 'father' | 'mother') => setAdding({ child, kind }), [])
  const bySosa = useMemo(() => sosaIndex(graph), [graph])
  const { cards, connectors } = useMemo(() => horizontalPedigree(bySosa, opts.gens, opts, { slots: opts.slots, onAdd }), [bySosa, opts, onAdd])
  const pz = usePanZoom({ maxScale: 2.5 })
  const name = focus ? fullName(focus) : ''
  const known = Math.max(0, bySosa.size - 1)

  return (
    <ChartFrame title={`Ascendance${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Ascendance"><p>La personne centrale est à gauche ; à sa droite son père (en haut) et sa mère (en bas), puis leurs parents, et ainsi de suite. Les numéros Sosa identifient chaque ancêtre (père = 2n, mère = 2n + 1).</p><p>Touchez une carte pour placer cette personne au départ. Les cases « ? » sont des parents inconnus : touchez-les pour les ajouter.</p></HelpText>}
      actions={<ChartActions exportTarget={() => pz.contentRef.current} filename={`Ascendance ${name}`} />}
      styleOptions={<CardStylePanel opts={opts} onChange={setOpts} />}
      options={<>
        <OptionGroup title="Générations">
          <SliderRow label="Générations" value={opts.gens} min={2} max={8} onChange={(v) => setOpts({ gens: v })} />
          <ToggleRow label="Parents inconnus (cases « ? »)" checked={opts.slots} onChange={(v) => setOpts({ slots: v })} />
        </OptionGroup>
        <CardContentToggles opts={opts} onChange={setOpts} />
      </>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <CardTree pz={pz} cards={cards} connectors={connectors} opts={opts} onPick={(p) => setFocusId(p.id)} fitKey={`${focusId}:${opts.gens}:${opts.showPlaces}`}
          overlay={<>
            {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
            {graph && !loading && <div className="absolute bottom-24 left-3 z-10 rounded-full bg-white/90 px-3 py-1 text-[11px] text-mist-500 shadow-sm ring-1 ring-black/5" data-nopan>{known} ancêtre{known > 1 ? 's' : ''} connu{known > 1 ? 's' : ''} sur {opts.gens - 1} génération{opts.gens > 2 ? 's' : ''}</div>}
          </>} />
      )}
      {adding && <AddRelativeSheet anchor={{ id: adding.child.id, display_name: adding.child.display_name, sex: adding.child.sex, surname: adding.child.surname }}
        choice={{ kind: adding.kind, label: adding.kind === 'father' ? 'Ajouter le père' : 'Ajouter la mère', group: 'parents' }} onClose={() => setAdding(null)} onAdded={() => reload()} />}
    </ChartFrame>
  )
}
