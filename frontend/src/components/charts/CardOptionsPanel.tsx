import { OptionGroup, SegmentedRow, ToggleRow } from './ChartTools'
import type { CardColorMode, CardOptions } from './PersonCard'

/** Panneau « Style » commun aux graphiques à cartes. */
export function CardStylePanel({ opts, onChange }: { opts: CardOptions; onChange: (p: Partial<CardOptions>) => void }) {
  return (
    <OptionGroup title="Couleur des cartes">
      <SegmentedRow<CardColorMode> value={opts.colorMode} onChange={(v) => onChange({ colorMode: v })}
        options={[{ value: 'sex', label: 'Vert / lilas' }, { value: 'blue', label: 'Bleu / rose' }, { value: 'white', label: 'Blanc' }]} />
    </OptionGroup>
  )
}

/** Interrupteurs de contenu des cartes (lieux, photos, Sosa). */
export function CardContentToggles({ opts, onChange, sosa = true }: { opts: CardOptions; onChange: (p: Partial<CardOptions>) => void; sosa?: boolean }) {
  return (
    <OptionGroup title="Contenu des cartes">
      <ToggleRow label="Lieux de naissance et de décès" checked={opts.showPlaces} onChange={(v) => onChange({ showPlaces: v })} />
      <ToggleRow label="Photos" checked={opts.showPhotos} onChange={(v) => onChange({ showPhotos: v })} />
      {sosa && <ToggleRow label="Numéros Sosa" hint="Numérotation des ancêtres : père = 2n, mère = 2n + 1" checked={!!opts.showSosa} onChange={(v) => onChange({ showSosa: v })} />}
    </OptionGroup>
  )
}
