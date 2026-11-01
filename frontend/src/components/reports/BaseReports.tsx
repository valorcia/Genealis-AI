import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { ExternalLink } from 'lucide-react'
import { api, type EventRow, type MapData, type PersonSummary } from '../../api'
import { ErrorState, LoadingState, eventLabel, shortPlace, useLoader } from '../views/common'
import { CAT_COLOR, catOf } from '../views/eventCats'
import { Muted, PersonRef, RC, RSection, ReportDoc, StatTile } from './ReportKit'
import type { ReportProps } from './PersonReports'

/* ------------------------------------------------------------------ */
type Topo = Topology<{ land: GeometryCollection }>
let landCache: GeoPermissibleObjects | null = null
function useLand() {
  const [land, setLand] = useState<GeoPermissibleObjects | null>(landCache)
  useEffect(() => {
    if (landCache) return
    let alive = true
    import('world-atlas/land-110m.json').then((m) => {
      const topo = (m.default ?? m) as unknown as Topo
      landCache = feature(topo, topo.objects.land)
      if (alive) setLand(landCache)
    }).catch(() => { /* carte miniature facultative */ })
    return () => { alive = false }
  }, [])
  return land
}

/** Carte miniature de situation, dessinée hors ligne (contours des terres + lieux voisins). */
function MiniMap({ lat, lon, land, others }: { lat: number; lon: number; land: GeoPermissibleObjects | null; others: { lat: number; lon: number }[] }) {
  const w = 132, h = 96
  const proj = geoMercator().center([lon, lat]).scale(340).translate([w / 2, h / 2])
  const path = geoPath(proj)
  const near = others.map((o) => proj([o.lon, o.lat])).filter((p): p is [number, number] => !!p && p[0] > -4 && p[0] < w + 4 && p[1] > -4 && p[1] < h + 4)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0 rounded-xl ring-1 ring-black/10" style={{ background: '#e4eff7' }}>
      {land && <path d={path(land) ?? ''} fill="#f6ecdf" stroke="#d8bb9c" strokeWidth={0.6} />}
      {near.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2} fill={RC} opacity={0.35} />)}
      <circle cx={w / 2} cy={h / 2} r={8} fill={RC} opacity={0.18} />
      <circle cx={w / 2} cy={h / 2} r={3.6} fill={RC} stroke="#fff" strokeWidth={1.4} />
    </svg>
  )
}

export function Cartes({ focusId }: ReportProps) {
  const [scope, setScope] = useState<'lignee' | 'base'>('lignee')
  const { data, loading, error, reload } = useLoader(async () => {
    const [map, anc, desc] = await Promise.all([api.map(), api.ancestors(focusId, 12), api.descendants(focusId, 6)])
    return { map, ids: new Set([...anc.nodes, ...desc.nodes].map((n) => n.id)) }
  }, [focusId])
  const land = useLand()
  const points = useMemo(() => {
    if (!data) return []
    return data.map.points.map((p) => ({ ...p, evs: scope === 'base' ? p.events : p.events.filter((e) => data.ids.has(e.person_id)) }))
      .filter((p) => p.evs.length > 0).sort((a, b) => b.evs.length - a.evs.length)
  }, [data, scope])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const m: MapData = data.map
  return (
    <ReportDoc title="Cartes" subject={scope === 'lignee' ? 'Lieux de la lignée de la personne centrale' : 'Tous les lieux de la base'}
      intro={<div className="no-print flex gap-2">{(['lignee', 'base'] as const).map((s) => (
        <button key={s} onClick={() => setScope(s)} className="rounded-full px-3 py-1 text-xs font-semibold ring-1" style={scope === s ? { background: RC, color: '#fff', borderColor: RC } : { color: RC, boxShadow: `inset 0 0 0 1px ${RC}55` }}>{s === 'lignee' ? 'Ascendants et descendants' : 'Toute la base'}</button>
      ))}</div>}>
      <RSection title="Lieux localisés" count={points.length}>
        {points.length === 0 && <p className="italic text-mist-500">Aucun lieu localisé pour cette sélection.</p>}
        <ul className="space-y-3">
          {points.map((p) => (
            <li key={p.place_id} className="avoid-break flex gap-3 rounded-2xl bg-[#fbf6f1] p-3">
              <MiniMap lat={p.lat} lon={p.lon} land={land} others={points.filter((o) => o.place_id !== p.place_id)} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-mist-500">
                  <span className="tabular-nums">{p.lat.toFixed(4)}°, {p.lon.toFixed(4)}°</span>
                  <a className="no-print inline-flex items-center gap-0.5 font-medium" style={{ color: RC }} href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=11/${p.lat}/${p.lon}`} target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink size={11} /></a>
                </div>
                <ul className="mt-1 space-y-0.5 text-[12.5px]">
                  {p.evs.slice().sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)).slice(0, 8).map((e, i) => (
                    <li key={i} className="flex gap-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[catOf(e.type)] }} /><span><span className="tabular-nums text-mist-500">{e.year ?? '—'}</span> {eventLabel(e.type)} · <Link to={`/personnes/${e.person_id}`} className="font-medium hover:underline">{e.person}</Link></span></li>
                  ))}
                  {p.evs.length > 8 && <li className="text-xs text-mist-500">… et {p.evs.length - 8} autre{p.evs.length - 8 > 1 ? 's' : ''}</li>}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </RSection>
      {m.unlocated_places.length > 0 && (
        <RSection title="Lieux sans coordonnées" count={m.unlocated_places.length}>
          <p className="text-sm">{m.unlocated_places.map((u) => u.name).join(' · ')}</p>
          <p className="no-print mt-1 text-xs"><Link to="/carte" style={{ color: RC }} className="font-medium">Géocoder depuis la Carte familiale →</Link></p>
        </RSection>
      )}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
function chronicleText(e: EventRow): ReactNode {
  const names = e.persons.map((p, i) => <span key={p.id}>{i > 0 && (i === e.persons.length - 1 ? ' et ' : ', ')}<PersonRef p={{ id: p.id, display_name: p.name }} years={false} /></span>)
  const lbl = eventLabel(e.event_type)
  if (!e.persons.length) return lbl
  return <>{lbl} {/^[aeiouyhéèêàâîôû]/i.test(e.persons[0].name) ? 'd’' : 'de '}{names}</>
}

export function Chronique() {
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const { data, loading, error, reload } = useLoader<EventRow[]>(() => api.events(), [])
  const grouped = useMemo(() => {
    const byYear = new Map<number | null, EventRow[]>()
    for (const e of data ?? []) { const y = e.sort_year; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y)!.push(e) }
    const years = [...byYear.keys()].filter((y): y is number => y !== null).sort((a, b) => (order === 'asc' ? a - b : b - a))
    return { years: years.map((y) => ({ y, evs: byYear.get(y)!.sort((a, b) => (a.date_start ?? '').localeCompare(b.date_start ?? '')) })), undated: byYear.get(null) ?? [] }
  }, [data, order])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  return (
    <ReportDoc title="Chronique familiale" subject={`${data.length} événements · ${grouped.years.length} années`}
      intro={<div className="no-print flex gap-2">{(['asc', 'desc'] as const).map((o) => (
        <button key={o} onClick={() => setOrder(o)} className="rounded-full px-3 py-1 text-xs font-semibold" style={order === o ? { background: RC, color: '#fff' } : { color: RC, boxShadow: `inset 0 0 0 1px ${RC}55` }}>{o === 'asc' ? 'Du plus ancien' : 'Du plus récent'}</button>
      ))}</div>}>
      {data.length === 0 && <p className="italic text-mist-500">Aucun événement enregistré.</p>}
      {grouped.years.map(({ y, evs }, i) => {
        const dec = Math.floor(y / 10) * 10
        const showDec = i === 0 || Math.floor(grouped.years[i - 1].y / 10) * 10 !== dec
        return (
          <div key={y}>
            {showDec && <h2 className="mb-2 mt-6 border-b pb-1 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: RC, borderColor: `${RC}26` }}>Années {dec}</h2>}
            <div className="avoid-break flex gap-3 py-1.5">
              <span className="w-12 shrink-0 text-right text-[15px] font-bold tabular-nums" style={{ color: RC }}>{y}</span>
              <ul className="min-w-0 flex-1 space-y-1">
                {evs.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[13.5px]">
                    <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: CAT_COLOR[catOf(e.event_type)] }} />
                    <span>{chronicleText(e)}{e.place && <Muted> · {shortPlace(e.place)}</Muted>}{e.date_display && e.date_display !== String(y) && <Muted> · {e.date_display}</Muted>}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      })}
      {grouped.undated.length > 0 && (
        <RSection title="Sans date" count={grouped.undated.length} className="mt-8">
          <ul className="space-y-1">{grouped.undated.map((e) => <li key={e.id} className="text-[13.5px]">{chronicleText(e)}{e.place && <Muted> · {shortPlace(e.place)}</Muted>}</li>)}</ul>
        </RSection>
      )}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
function PersonList({ list, empty }: { list: PersonSummary[]; empty: string }) {
  if (!list.length) return <p className="text-sm text-[#2f6b3b]">✓ {empty}</p>
  return <ul className="columns-1 gap-6 text-[13px] sm:columns-2">{list.map((p) => <li key={p.id} className="mb-1 break-inside-avoid"><PersonRef p={p} dot /></li>)}</ul>
}

export function EtatDeLaBase({ persons }: ReportProps) {
  const { data, loading, error, reload } = useLoader(() => Promise.all([api.databaseState(), api.stats(), api.contradictions('open'), api.questions('pending')]), [])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const [st, stats, contras, questions] = data
  const c = st.counts
  const byId = new Map(persons.map((p) => [p.id, p]))
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—')
  const withBirth = stats.persons - st.missing_birth.length
  return (
    <ReportDoc title="État de la base" subject={`${stats.persons} personnes`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Personnes" value={c.persons ?? stats.persons} sub={`${stats.sexes.M ?? 0} h · ${stats.sexes.F ?? 0} f${stats.living ? ` · ${stats.living} vivant${stats.living > 1 ? 's' : ''}` : ''}`} />
        <StatTile label="Familles" value={c.families ?? 0} sub={stats.children_per_family.average ? `${stats.children_per_family.average} enfants en moyenne` : undefined} />
        <StatTile label="Événements" value={c.events ?? 0} />
        <StatTile label="Lieux" value={c.places ?? 0} sub={`${st.places_without_coordinates.length} sans coordonnées`} />
        <StatTile label="Liens parent-enfant" value={c.relations ?? 0} />
        <StatTile label="Avec date de naissance" value={pct(withBirth, stats.persons)} sub={`${withBirth} personnes`} tone="#2e7d4a" />
        <StatTile label="Avec au moins une source" value={pct(stats.with_sources, stats.persons)} sub={`${stats.with_sources} personnes`} tone={stats.with_sources / Math.max(1, stats.persons) < 0.5 ? '#b4473c' : '#2e7d4a'} />
        <StatTile label="À traiter" value={contras.length + questions.length} sub={`${contras.length} contradiction${contras.length > 1 ? 's' : ''} · ${questions.length} question${questions.length > 1 ? 's' : ''}`} tone={contras.length ? '#b4473c' : undefined} />
      </div>

      {stats.age_at_death.average && (
        <p className="mt-4 text-sm text-mist-500">Âge moyen au décès : <b className="text-night-900">{stats.age_at_death.average} ans</b>{stats.age_at_death.average_m && ` (hommes ${stats.age_at_death.average_m}, femmes ${stats.age_at_death.average_f})`} · âge moyen au mariage : <b className="text-night-900">{stats.marriage_age.average ?? '—'} ans</b>{stats.countries.length > 0 && ` · pays : ${stats.countries.map(([n]) => n).join(', ')}`}</p>
      )}

      <RSection title="Contradictions ouvertes" count={contras.length}>
        {contras.length === 0 ? <p className="text-sm text-[#2f6b3b]">✓ Aucune contradiction ouverte.</p> : (
          <ul className="space-y-1.5 text-[13px]">
            {contras.map((x) => (
              <li key={x.id} className="avoid-break flex gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.severity === 'red' ? 'bg-conf-red' : 'bg-conf-orange'}`} />
                <span>{x.description} {x.person_ids.map((id) => byId.get(id)).filter((p): p is PersonSummary => !!p).map((p) => <span key={p.id} className="mr-1.5 whitespace-nowrap text-xs">→ <PersonRef p={p} years={false} /></span>)}</span>
              </li>
            ))}
          </ul>
        )}
      </RSection>
      <RSection title="Questions en attente" count={questions.length}>
        {questions.length === 0 ? <p className="text-sm text-[#2f6b3b]">✓ Aucune question en attente.</p> : (
          <ul className="space-y-1 text-[13px]">{questions.map((q) => <li key={q.id}><Link to="/questions" className="font-medium hover:underline">{q.title}</Link>{q.person_id && byId.get(q.person_id) && <Muted> · {byId.get(q.person_id)!.display_name}</Muted>}</li>)}</ul>
        )}
      </RSection>
      <RSection title="Personnes sans date de naissance" count={st.missing_birth.length}><PersonList list={st.missing_birth} empty="Toutes les personnes ont une date de naissance." /></RSection>
      <RSection title="Personnes sans parents connus" count={st.missing_parents.length}><PersonList list={st.missing_parents} empty="Toutes les personnes ont au moins un parent." /></RSection>
      <RSection title="Personnes sans source" count={st.without_sources.length}><PersonList list={st.without_sources} empty="Toutes les personnes sont sourcées." /></RSection>
      <RSection title="Probablement décédées, sans date de décès" count={st.probably_deceased_without_date.length}><PersonList list={st.probably_deceased_without_date} empty="Aucune." /></RSection>
      <RSection title="Lieux sans coordonnées" count={st.places_without_coordinates.length}>
        {st.places_without_coordinates.length === 0 ? <p className="text-sm text-[#2f6b3b]">✓ Tous les lieux sont localisés.</p> : (
          <p className="text-[13px]">{st.places_without_coordinates.map((p) => p.name).join(' · ')} <Link to="/listes/lieux" className="no-print ml-1 font-medium" style={{ color: RC }}>Voir la liste des lieux →</Link></p>
        )}
      </RSection>
    </ReportDoc>
  )
}
