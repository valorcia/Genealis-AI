import { useState, type ComponentType } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { AnniversariesList, FamiliesList, MissingFactsList, PersonsList, type ListProps } from '../components/lists/PeopleLists'
import { ContradictionsList, EventsList, HypothesesList, MediaList, PlacesList, SourcesList } from '../components/lists/CatalogLists'

const LISTS: Record<string, ComponentType<ListProps>> = {
  personnes: PersonsList,
  familles: FamiliesList,
  lieux: PlacesList,
  evenements: EventsList,
  anniversaires: AnniversariesList,
  sources: SourcesList,
  medias: MediaList,
  'faits-manquants': MissingFactsList,
  contradictions: ContradictionsList,
  hypotheses: HypothesesList,
}

function ListHost({ Comp, initial, autoFocus }: { Comp: ComponentType<ListProps>; initial: string; autoFocus: boolean }) {
  const [search, setSearch] = useState(initial)
  return <Comp search={search} setSearch={setSearch} autoFocus={autoFocus} />
}

export default function ListPage() {
  const { type = '' } = useParams()
  const [params] = useSearchParams()
  const Comp = LISTS[type]
  if (!Comp) return <Navigate to="/section/listes" replace />
  return <ListHost key={type} Comp={Comp} initial={params.get('q') ?? ''} autoFocus={params.get('focus') === '1'} />
}
