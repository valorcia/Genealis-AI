import { useCallback, useMemo, useState } from 'react'
import type { PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { AddRelativeSheet } from '../../components/relatives/AddRelative'
import CardTree from '../../components/charts/CardTree'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { CardContentToggles, CardStylePanel } from '../../components/charts/CardOptionsPanel'
import { childrenOf, sosaIndex, useFamily } from '../../components/charts/family'
import { fullName, GRAPH_COLOR } from '../../components/charts/format'
import { verticalAncestors, verticalDescendants } from '../../components/charts/pedigree'
import { DEFAULT_CARD_OPTIONS, type CardOptions } from '../../components/charts/PersonCard'
import { Spinner } from '../../components/ui'

interface Opts extends CardOptions { up: number; down: number; slots: boolean }

export default function HourglassPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('sablier', { ...DEFAULT_CARD_OPTIONS, up: 3, down: 2, slots: true })
  const { data, loading, error, reload } = useFamily(focusId, opts.up, opts.down, { withDetails: false })
  const [adding, setAdding] = useState<{ child: PersonSummary; kind: 'father' | 'mother' } | null>(null)
  const onAdd = useCallback((child: PersonSummary, kind: 'father' | 'mother') => setAdding({ child, kind }), [])

  const { cards, connectors } = useMemo(() => {
    if (!data || !focusId) return { cards: [], connectors: [] }
    const bySosa = sosaIndex(data.ancestors)
    const a = verticalAncestors(bySosa, opts.up + 1, opts, { slots: opts.slots, onAdd })
    const d = verticalDescendants(focusId, (id) => childrenOf(data.index, id), data.index.persons, opts.down, opts)
    if (!bySosa.size && data.index.persons.has(focusId)) a.cards.push({ key: 'root', x: -118, y: 0, person: data.index.persons.get(focusId) ?? null, root: true })
    return { cards: [...a.cards, ...d.cards], connectors: [...a.connectors, ...d.connectors] }
  }, [data, focusId, opts, onAdd])
  const pz = usePanZoom({ maxScale: 2.5 })
  const name = focus ? fullName(focus) : ''

  return (
    <ChartFrame title={`Sablier généalogique${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Sablier généalogique"><p>Au centre, la personne choisie (cadre gris épais). Ses ancêtres s’étagent au-dessus, ses descendants en dessous, comme les deux moitiés d’un sablier.</p><p>Touchez une carte pour recentrer le sablier sur cette personne ; les cases « ? » permettent d’ajouter un parent inconnu.</p></HelpText>}
      actions={<ChartActions exportTarget={() => pz.contentRef.current} filename={`Sablier ${name}`} />}
      styleOptions={<CardStylePanel opts={opts} onChange={setOpts} />}
      options={<>
        <OptionGroup title="Générations">
          <SliderRow label="Ancêtres" value={opts.up} min={1} max={6} onChange={(v) => setOpts({ up: v })} />
          <SliderRow label="Descendants" value={opts.down} min={1} max={6} onChange={(v) => setOpts({ down: v })} />
          <ToggleRow label="Parents inconnus (cases « ? »)" checked={opts.slots} onChange={(v) => setOpts({ slots: v })} />
        </OptionGroup>
        <CardContentToggles opts={opts} onChange={setOpts} />
      </>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <CardTree pz={pz} cards={cards} connectors={connectors} opts={opts} onPick={(p) => setFocusId(p.id)} fitKey={`${focusId}:${opts.up}:${opts.down}:${opts.showPlaces}`}
          overlay={<>
            {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
          </>} />
      )}
      {adding && <AddRelativeSheet anchor={{ id: adding.child.id, display_name: adding.child.display_name, sex: adding.child.sex, surname: adding.child.surname }}
        choice={{ kind: adding.kind, label: adding.kind === 'father' ? 'Ajouter le père' : 'Ajouter la mère', group: 'parents' }} onClose={() => setAdding(null)} onAdded={() => reload()} />}
    </ChartFrame>
  )
}
