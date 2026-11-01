import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type PersonDetail, type PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { AddRelativeMenu, AddRelativeSheet } from '../../components/relatives/AddRelative'
import CardTree, { type Decoration } from '../../components/charts/CardTree'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { CardContentToggles, CardStylePanel } from '../../components/charts/CardOptionsPanel'
import { sosaIndex, useAncestors } from '../../components/charts/family'
import { fullName, GRAPH_COLOR } from '../../components/charts/format'
import { horizontalPedigree } from '../../components/charts/pedigree'
import { cardSize, DEFAULT_CARD_OPTIONS, type CardOptions } from '../../components/charts/PersonCard'
import { Spinner } from '../../components/ui'

interface Opts extends CardOptions { gens: number; slots: boolean }
const GAP = 34

export default function DoublePedigreePage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('double', { ...DEFAULT_CARD_OPTIONS, gens: 3, slots: true })
  const [detail, setDetail] = useState<PersonDetail | null>(null)
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ child: PersonSummary; kind: 'father' | 'mother' } | null>(null)
  const [addSpouse, setAddSpouse] = useState(false)
  const loadDetail = useCallback(() => { if (focusId) api.person(focusId).then(setDetail).catch(() => setDetail(null)) }, [focusId])
  useEffect(() => { setDetail(null); setPartnerId(null); loadDetail() }, [loadDetail])
  const spouses = useMemo(() => detail?.spouses ?? [], [detail])
  const partner = spouses.find((s) => s.id === partnerId) ?? spouses[0] ?? null
  const [left, right] = useMemo(() => {
    const me = detail ?? focus
    if (!me) return [null, null] as const
    if (!partner) return [me, null] as const
    return me.sex === 'F' || partner.sex === 'M' ? [partner, me] as const : [me, partner] as const
  }, [detail, focus, partner])

  const L = useAncestors(left?.id ?? null, Math.max(1, opts.gens - 1))
  const R = useAncestors(right?.id ?? null, Math.max(1, opts.gens - 1))
  const onAdd = useCallback((child: PersonSummary, kind: 'father' | 'mother') => setAdding({ child, kind }), [])
  const { w } = cardSize('card', opts)

  const { cards, connectors, decorations } = useMemo(() => {
    const l = horizontalPedigree(sosaIndex(L.graph), opts.gens, opts, { dir: -1, originX: right ? -w - GAP : -w / 2, slots: opts.slots, onAdd, keyPrefix: 'g' })
    const r = right ? horizontalPedigree(sosaIndex(R.graph), opts.gens, opts, { dir: 1, originX: GAP, slots: opts.slots, onAdd, keyPrefix: 'd' }) : { cards: [], connectors: [] }
    const deco: Decoration[] = right && l.cards.length && r.cards.length ? [{ key: 'ring', x: -15, y: -13, node: <span className="flex h-[26px] w-[30px] items-center justify-center rounded-full bg-white text-[15px] text-[#13918c] shadow ring-1 ring-black/10" title="Couple">∞</span> }] : []
    const conns = [...l.connectors, ...r.connectors]
    if (deco.length) { conns.push({ d: `M${-GAP},-3 H${GAP}`, width: 1.6 }, { d: `M${-GAP},3 H${GAP}`, width: 1.6 }) }
    return { cards: [...l.cards, ...r.cards], connectors: conns, decorations: deco }
  }, [L.graph, R.graph, opts, onAdd, right, w])
  const pz = usePanZoom({ maxScale: 2.5 })
  const title = left && right ? `${fullName(left)} et ${fullName(right)}` : focus ? fullName(focus) : ''

  return (
    <ChartFrame title={`Double ascendance${title ? ` - ${title}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Double ascendance"><p>Un couple au centre : les ancêtres de l’époux se déploient vers la gauche, ceux de l’épouse vers la droite. Choisissez le couple dans les options si la personne a eu plusieurs conjoints.</p><p>Touchez une carte pour recentrer le graphique sur cette personne.</p></HelpText>}
      actions={<ChartActions exportTarget={() => pz.contentRef.current} filename={`Double ascendance ${title}`} />}
      styleOptions={<CardStylePanel opts={opts} onChange={setOpts} />}
      options={<>
        {spouses.length > 1 && (
          <OptionGroup title="Couple">
            <SegmentedRow value={partner?.id ?? ''} onChange={(v) => setPartnerId(v)} options={spouses.map((s) => ({ value: s.id, label: fullName(s) }))} />
          </OptionGroup>
        )}
        <OptionGroup title="Générations">
          <SliderRow label="Générations" value={opts.gens} min={2} max={6} onChange={(v) => setOpts({ gens: v })} />
          <ToggleRow label="Parents inconnus (cases « ? »)" checked={opts.slots} onChange={(v) => setOpts({ slots: v })} />
        </OptionGroup>
        <CardContentToggles opts={opts} onChange={setOpts} />
      </>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <CardTree pz={pz} cards={cards} connectors={connectors} decorations={decorations} opts={opts} onPick={(p) => setFocusId(p.id)} fitKey={`${left?.id}:${right?.id}:${opts.gens}:${opts.showPlaces}:${!!L.graph}:${!!R.graph}`}
          overlay={<>
            {(L.loading || R.loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {detail && !partner && (
              <div className="absolute inset-x-3 bottom-24 z-10 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-sm text-night-900 shadow-lg ring-1 ring-black/5" data-nopan>
                <span className="flex-1">Aucun conjoint connu pour {detail.display_name} : seule son ascendance est affichée.</span>
                <button className="shrink-0 rounded-full bg-[#13918c] px-3 py-1.5 text-xs font-medium text-white" onClick={() => setAddSpouse(true)}>Ajouter</button>
              </div>
            )}
          </>} />
      )}
      {adding && <AddRelativeSheet anchor={{ id: adding.child.id, display_name: adding.child.display_name, sex: adding.child.sex, surname: adding.child.surname }}
        choice={{ kind: adding.kind, label: adding.kind === 'father' ? 'Ajouter le père' : 'Ajouter la mère', group: 'parents' }} onClose={() => setAdding(null)} onAdded={() => { L.reload(); R.reload() }} />}
      {addSpouse && detail && <AddRelativeMenu anchor={{ id: detail.id, display_name: detail.display_name, sex: detail.sex, surname: detail.surname }} onClose={() => setAddSpouse(false)} onAdded={() => loadDetail()} />}
    </ChartFrame>
  )
}
