import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, CalendarRange, ExternalLink, FileText, Files, Globe, Images, Lightbulb, MapPin, MapPinOff, TriangleAlert } from 'lucide-react'
import { api, EVENT_LABEL, openExternal, type EventRow, type MediaOut, type PersonSummary, type SourceOut } from '../../api'
import { useApp } from '../../store'
import { Spinner } from '../ui'
import { EmptyState, ErrorState, LoadingState, errorText, eventLabel, normalize, shortPlace, useLoader } from '../views/common'
import { CAT_COLOR, catOf } from '../views/eventCats'
import { Chip, ChipBar, Group, PageFrame, Row, SectionIndex } from './ListKit'
import { LC, type ListProps } from './PeopleLists'

const letterOf = (s: string) => { const c = normalize(s.trim()).charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#' }

/* ------------------------------------------------------------------ */
type PFilter = 'tous' | 'localises' | 'sans'
export function PlacesList({ search, setSearch }: ListProps) {
  const { data, loading, error, reload } = useLoader(() => Promise.all([api.places(), api.events()]), [])
  const [sort, setSort] = useState<'nom' | 'nombre'>('nom')
  const [filter, setFilter] = useState<PFilter>('tous')
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => {
    if (!data) return []
    const [places, events] = data
    const evByName = new Map<string, EventRow[]>()
    for (const e of events) { if (!e.place) continue; const k = normalize(shortPlace(e.place)); if (!evByName.has(k)) evByName.set(k, []); evByName.get(k)!.push(e) }
    const n = normalize(search.trim())
    return places.map((p) => ({ p, evs: evByName.get(normalize(p.name)) ?? [] }))
      .filter(({ p }) => (filter === 'tous' || (filter === 'localises') === (p.lat !== null && p.lon !== null)) && (!n || normalize(`${p.name} ${p.department ?? ''} ${p.country ?? ''} ${p.historical_names.join(' ')}`).includes(n)))
      .sort((a, b) => sort === 'nombre' ? b.evs.length - a.evs.length || a.p.name.localeCompare(b.p.name) : normalize(a.p.name).localeCompare(normalize(b.p.name)))
  }, [data, search, sort, filter])
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>()
    rows.forEach((r) => { const k = sort === 'nom' ? letterOf(r.p.name) : 'Par nombre d’événements'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r) })
    return m
  }, [rows, sort])
  const missing = data ? data[0].filter((p) => p.lat === null || p.lon === null).length : 0
  return (
    <PageFrame title="Lieux" subtitle={data ? `${data[0].length} lieux · ${missing} sans coordonnées` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Commune, département, pays…"
      toolbar={<ChipBar>
        <Chip active={sort === 'nom'} onClick={() => setSort('nom')} color={LC}>A → Z</Chip>
        <Chip active={sort === 'nombre'} onClick={() => setSort('nombre')} color={LC}>Plus d’événements</Chip>
        <span className="mx-1 w-px shrink-0 bg-black/10" />
        <Chip active={filter === 'tous'} onClick={() => setFilter('tous')} color={LC}>Tous</Chip>
        <Chip active={filter === 'localises'} onClick={() => setFilter('localises')} color={LC}>Localisés</Chip>
        <Chip active={filter === 'sans'} onClick={() => setFilter('sans')} color={LC}>Sans coordonnées</Chip>
      </ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && rows.length === 0 && <EmptyState icon={<MapPin size={28} />} color={LC} title="Aucun lieu">Les lieux sont créés automatiquement quand vous saisissez un lieu de naissance, de mariage ou de décès.</EmptyState>}
      <div className={sort === 'nom' ? 'pr-5 sm:pr-8' : ''}>
        {[...groups.entries()].map(([k, list]) => (
          <Group key={k} id={`l-${k}`} title={k} footer={k === [...groups.keys()].slice(-1)[0] && missing > 0 ? <>Les lieux sans coordonnées n’apparaissent pas sur les cartes. <Link to="/carte" className="font-medium" style={{ color: LC }}>Les géocoder depuis la Carte familiale →</Link></> : undefined}>
            {list.map(({ p, evs }) => {
              const located = p.lat !== null && p.lon !== null
              return (
                <Row key={p.id} onClick={() => setOpen(open === p.id ? null : p.id)} chevron={false}
                  left={<span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${located ? 'bg-[#e6f6ea] text-[#2e9a52]' : 'bg-[#fff1e0] text-[#c4651a]'}`}>{located ? <MapPin size={17} /> : <MapPinOff size={17} />}</span>}
                  title={p.name}
                  subtitle={[[...new Set([p.department, p.country].filter(Boolean))].join(', '), located ? `${p.lat!.toFixed(3)}°, ${p.lon!.toFixed(3)}°` : 'Sans coordonnées'].filter(Boolean).join(' · ')}
                  right={<span className="font-semibold tabular-nums" style={{ color: LC }}>{evs.length}</span>}>
                  {open === p.id && (
                    <ul className="mt-2 space-y-1 border-t border-black/5 pt-2 text-[13px]">
                      {evs.length === 0 && <li className="text-mist-500">Aucun événement rattaché.</li>}
                      {evs.slice().sort((a, b) => (a.sort_year ?? 9999) - (b.sort_year ?? 9999)).map((e) => (
                        <li key={e.id} className="flex gap-2">
                          <span className="w-10 shrink-0 tabular-nums text-mist-500">{e.sort_year ?? '—'}</span>
                          <span className="w-20 shrink-0 truncate text-mist-500">{eventLabel(e.event_type)}</span>
                          <span className="min-w-0 truncate">{e.persons.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link to={`/personnes/${x.id}`} onClick={(ev) => ev.stopPropagation()} className="font-medium" style={{ color: LC }}>{x.name}</Link></span>)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Row>
              )
            })}
          </Group>
        ))}
      </div>
      {sort === 'nom' && <SectionIndex letters={[...groups.keys()]} color={LC} onJump={(l) => document.getElementById(`l-${l}`)?.scrollIntoView({ behavior: 'smooth' })} />}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
export function EventsList({ search, setSearch }: ListProps) {
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [range, setRange] = useState<{ from?: number; to?: number }>({})
  const [limit, setLimit] = useState(300)
  useEffect(() => { const t = setTimeout(() => setRange({ from: /^\d{3,4}$/.test(from) ? Number(from) : undefined, to: /^\d{3,4}$/.test(to) ? Number(to) : undefined }), 400); return () => clearTimeout(t) }, [from, to])
  const { data, loading, error, reload } = useLoader<EventRow[]>(() => api.events({ event_type: type || undefined, year_from: range.from, year_to: range.to }), [type, range.from, range.to])
  const filtered = useMemo(() => {
    const n = normalize(search.trim())
    return (data ?? []).filter((e) => !n || normalize(`${e.persons.map((p) => p.name).join(' ')} ${e.place ?? ''} ${e.description ?? ''}`).includes(n))
      .sort((a, b) => (a.sort_year ?? 99999) - (b.sort_year ?? 99999) || (a.date_start ?? '').localeCompare(b.date_start ?? ''))
  }, [data, search])
  const groups = useMemo(() => {
    const m = new Map<string, EventRow[]>()
    filtered.slice(0, limit).forEach((e) => { const k = e.sort_year ? `Années ${Math.floor(e.sort_year / 10) * 10}` : 'Sans date'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e) })
    return m
  }, [filtered, limit])
  const types = Object.entries(EVENT_LABEL).sort((a, b) => a[1].localeCompare(b[1]))
  return (
    <PageFrame title="Événements" subtitle={data ? `${filtered.length} événement${filtered.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Personne, lieu…"
      toolbar={<div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="min-w-0 flex-1 rounded-xl border-0 bg-black/[0.06] px-3 py-1.5 text-[14px] text-night-900 outline-none sm:flex-none">
          <option value="">Tous les types</option>
          {types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-[13px] text-mist-500">
          <span>de</span><input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="année" className="w-[68px] rounded-xl border-0 bg-black/[0.06] px-2 py-1.5 text-center text-night-900 outline-none" />
          <span>à</span><input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="année" className="w-[68px] rounded-xl border-0 bg-black/[0.06] px-2 py-1.5 text-center text-night-900 outline-none" />
        </div>
      </div>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && filtered.length === 0 && <EmptyState icon={<CalendarRange size={28} />} color={LC} title="Aucun événement">Aucun événement ne correspond à ces filtres.</EmptyState>}
      {[...groups.entries()].map(([k, list]) => (
        <Group key={k} title={k}>
          {list.map((e) => (
            <Row key={e.id} to={e.persons[0] ? `/personnes/${e.persons[0].id}` : undefined}
              left={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[catOf(e.event_type)] }} />}
              title={<><span className="text-mist-500">{eventLabel(e.event_type)} · </span>{e.persons.map((p) => p.name).join(' & ') || '—'}</>}
              subtitle={[e.date_display, e.place && shortPlace(e.place), e.description].filter(Boolean).join(' · ')} />
          ))}
        </Group>
      ))}
      {filtered.length > limit && <button onClick={() => setLimit((l) => l + 300)} className="mx-auto mb-4 block rounded-full bg-white px-4 py-2 text-sm font-semibold shadow" style={{ color: LC }}>Afficher {Math.min(300, filtered.length - limit)} de plus</button>}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
const RELIABILITY: Record<string, string> = { primary: 'Source primaire', secondary: 'Source secondaire', derivative: 'Source dérivée', unknown: 'Fiabilité inconnue' }
export function SourcesList({ search, setSearch }: ListProps) {
  const notify = useApp((s) => s.notify)
  const { data, loading, error, reload } = useLoader<SourceOut[]>(() => api.sources(), [])
  const [sort, setSort] = useState<'titre' | 'annee' | 'citations'>('titre')
  const [busy, setBusy] = useState<string | null>(null)
  const [archived, setArchived] = useState<Record<string, number>>({})
  const list = useMemo(() => {
    const n = normalize(search.trim())
    return (data ?? []).filter((s) => !n || normalize(`${s.title} ${s.repository ?? ''} ${s.reference ?? ''} ${s.commune ?? ''}`).includes(n))
      .sort((a, b) => sort === 'annee' ? (a.year ?? 99999) - (b.year ?? 99999) : sort === 'citations' ? b.citation_count - a.citation_count : normalize(a.title).localeCompare(normalize(b.title)))
  }, [data, search, sort])
  const archive = async (s: SourceOut) => {
    setBusy(s.id)
    try {
      const res = await api.archiveSource(s.id)
      setArchived((a) => ({ ...a, [s.id]: res.length }))
      notify('success', res.length ? `${res.length} copie${res.length > 1 ? 's' : ''} archivée${res.length > 1 ? 's' : ''} dans vos documents.` : 'Aucun document à archiver sur cette page.')
    } catch (e) { notify('error', errorText(e, 'Archivage impossible.')) } finally { setBusy(null) }
  }
  return (
    <PageFrame title="Sources" subtitle={data ? `${list.length} source${list.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Titre, dépôt, cote…"
      help={<p>« Archiver une copie » enregistre dans vos documents une copie de la page ou du fichier en ligne, pour la conserver même si le site change.</p>}
      toolbar={<ChipBar>{([['titre', 'Titre'], ['annee', 'Année'], ['citations', 'Plus citées']] as const).map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => setSort(k)} color={LC}>{l}</Chip>)}</ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && list.length === 0 && <EmptyState icon={<Files size={28} />} color={LC} title="Aucune source">Les actes et documents consultés apparaîtront ici.</EmptyState>}
      {list.length > 0 && (
        <Group>
          {list.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <Link to={`/archives?source=${s.id}`} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fbe4f0]" style={{ color: LC }}><Files size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug text-night-900">{s.title}</div>
                  <div className="text-[13px] text-mist-500">{[s.repository, s.reference, s.page, s.year].filter(Boolean).join(' · ') || 'Sans référence'}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="chip bg-black/[0.05] text-mist-500">{RELIABILITY[s.reliability] ?? s.reliability}</span>
                    <span className="chip bg-black/[0.05] text-mist-500">{s.citation_count} citation{s.citation_count > 1 ? 's' : ''}</span>
                    {(s.local_copy_path || archived[s.id]) && <span className="chip bg-[#e6f6ea] text-[#2f6b3b]"><Archive size={11} /> copie archivée</span>}
                  </div>
                </div>
              </Link>
              {s.url && (
                <div className="mt-2 flex gap-2 pl-12">
                  <button onClick={() => openExternal(s.url!)} className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium text-night-900"><ExternalLink size={13} /> Ouvrir</button>
                  <button onClick={() => archive(s)} disabled={busy === s.id} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: LC }}>{busy === s.id ? <Spinner /> : <Archive size={13} />} Archiver une copie</button>
                </div>
              )}
            </li>
          ))}
        </Group>
      )}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
type MFilter = 'tous' | 'photos' | 'pdf' | 'web' | 'documents'
const archivedFrom = (m: MediaOut) => (typeof m.analysis?.archived_from === 'string' ? (m.analysis.archived_from as string) : null)
const isImage = (m: MediaOut) => !!m.mime_type?.startsWith('image/')
const isPdf = (m: MediaOut) => m.mime_type === 'application/pdf' || /\.pdf$/i.test(m.original_filename ?? '')
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
function mediaMatches(m: MediaOut, f: MFilter) {
  if (f === 'tous') return true
  if (f === 'photos') return isImage(m)
  if (f === 'pdf') return isPdf(m)
  if (f === 'web') return !!archivedFrom(m)
  return !isImage(m) && !isPdf(m) && !archivedFrom(m)
}
export function MediaList({ search, setSearch }: ListProps) {
  const { data, loading, error, reload } = useLoader<MediaOut[]>(() => api.media(), [])
  const [filter, setFilter] = useState<MFilter>('tous')
  const counts = useMemo(() => Object.fromEntries((['tous', 'photos', 'pdf', 'web', 'documents'] as MFilter[]).map((f) => [f, (data ?? []).filter((m) => mediaMatches(m, f)).length])) as Record<MFilter, number>, [data])
  const list = useMemo(() => {
    const n = normalize(search.trim())
    return (data ?? []).filter((m) => mediaMatches(m, filter) && (!n || normalize(`${m.title ?? ''} ${m.original_filename ?? ''} ${archivedFrom(m) ?? ''} ${m.ocr_text ?? ''}`).includes(n)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [data, filter, search])
  const labels: [MFilter, string][] = [['tous', 'Tous'], ['photos', 'Photos'], ['pdf', 'PDF'], ['web', 'Pages web'], ['documents', 'Documents']]
  return (
    <PageFrame title="Médias" subtitle={data ? `${list.length} élément${list.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Titre, fichier, texte reconnu…" wide
      toolbar={<ChipBar>{labels.map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)} color={LC}>{l} <span className="opacity-60">{counts[k]}</span></Chip>)}</ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && list.length === 0 && <EmptyState icon={<Images size={28} />} color={LC} title={data.length ? 'Aucun média pour ce filtre' : 'Aucun média'}>{data.length ? 'Essayez un autre filtre.' : 'Importez des photos, actes scannés ou PDF depuis les Archives, ou archivez une page web depuis une source.'} <div className="mt-2"><Link to="/archives?tab=documents" className="font-semibold" style={{ color: LC }}>Ouvrir les archives →</Link></div></EmptyState>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((m) => {
          const web = archivedFrom(m)
          return (
            <Link key={m.id} to={`/archives?media=${m.id}`} className="group overflow-hidden rounded-[18px] bg-white shadow-[0_4px_18px_-10px_rgba(20,40,80,0.3)] ring-1 ring-black/[0.04] transition active:scale-[0.98]">
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#f6eef3]">
                {isImage(m)
                  ? <img src={api.mediaFileUrl(m.id)} alt={m.title ?? ''} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                  : isPdf(m) ? <FileText size={40} strokeWidth={1.4} className="text-[#d0453a]" />
                  : web ? <Globe size={40} strokeWidth={1.4} style={{ color: LC }} />
                  : <FileText size={40} strokeWidth={1.4} className="text-mist-400" />}
                <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-night-900 shadow-sm">
                  {web ? 'Web' : isPdf(m) ? 'PDF' : isImage(m) ? 'Photo' : 'Doc'}
                </span>
              </div>
              <div className="p-2.5">
                <div className="line-clamp-2 text-[13px] font-medium leading-snug text-night-900">{m.title || m.original_filename || 'Sans titre'}</div>
                <div className="mt-0.5 truncate text-[11px] text-mist-500">{web ? host(web) : new Date(m.created_at).toLocaleDateString('fr-FR')}</div>
              </div>
            </Link>
          )
        })}
      </div>
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
export function ContradictionsList({ search, setSearch }: ListProps) {
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open')
  const { data, loading, error, reload } = useLoader(() => Promise.all([api.contradictions(status), api.persons(undefined, 2000)]), [status])
  const byId = useMemo(() => new Map((data?.[1] ?? []).map((p) => [p.id, p])), [data])
  const list = (data?.[0] ?? []).filter((c) => !search.trim() || normalize(`${c.description} ${c.person_ids.map((id) => byId.get(id)?.display_name ?? '').join(' ')}`).includes(normalize(search.trim())))
  return (
    <PageFrame title="Contradictions" subtitle={data ? `${list.length} contradiction${list.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch}
      help={<p>Les incohérences détectées automatiquement (dates impossibles, doublons possibles…). Ouvrez la fiche concernée pour les corriger.</p>}
      toolbar={<ChipBar>{([['open', 'Ouvertes'], ['resolved', 'Résolues'], ['all', 'Toutes']] as const).map(([k, l]) => <Chip key={k} active={status === k} onClick={() => setStatus(k)} color={LC}>{l}</Chip>)}</ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && list.length === 0 && <EmptyState icon={<TriangleAlert size={28} />} color={LC} title="Aucune contradiction">{status === 'open' ? 'Votre arbre ne présente aucune incohérence ouverte.' : 'Rien à afficher.'}</EmptyState>}
      {list.length > 0 && (
        <Group>
          {list.map((c) => {
            const ps = c.person_ids.map((id) => byId.get(id)).filter((p): p is PersonSummary => !!p)
            return (
              <li key={c.id} className="flex gap-3 px-4 py-3">
                <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${c.severity === 'red' ? 'bg-[#fde8e6] text-conf-red' : 'bg-[#fff3df] text-[#b7791f]'}`}><TriangleAlert size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] leading-snug text-night-900">{c.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {ps.map((p) => <Link key={p.id} to={`/personnes/${p.id}`} className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] font-medium" style={{ color: LC }}>{p.display_name}</Link>)}
                    {c.status !== 'open' && <span className="chip bg-[#e6f6ea] text-[#2f6b3b]">{c.status === 'resolved' ? 'Résolue' : c.status}</span>}
                  </div>
                  {c.resolution_note && <p className="mt-1 text-xs text-mist-500">{c.resolution_note}</p>}
                </div>
              </li>
            )
          })}
        </Group>
      )}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
const H_STATUS: Record<string, string> = { open: 'Ouverte', confirmed: 'Confirmée', rejected: 'Rejetée', superseded: 'Remplacée' }
export function HypothesesList({ search, setSearch }: ListProps) {
  const [status, setStatus] = useState<'open' | 'confirmed' | 'rejected' | 'all'>('open')
  const { data, loading, error, reload } = useLoader(() => Promise.all([api.hypotheses(status), api.persons(undefined, 2000)]), [status])
  const byId = useMemo(() => new Map((data?.[1] ?? []).map((p) => [p.id, p])), [data])
  const list = (data?.[0] ?? []).filter((h) => !search.trim() || normalize(`${h.title} ${h.description ?? ''}`).includes(normalize(search.trim())))
  return (
    <PageFrame title="Hypothèses" subtitle={data ? `${list.length} hypothèse${list.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch}
      help={<p>Les pistes proposées par le généalogiste IA (parents possibles, rapprochements…), avec leur score de vraisemblance. Elles ne modifient pas l’arbre tant que vous ne les confirmez pas.</p>}
      toolbar={<ChipBar>{([['open', 'Ouvertes'], ['confirmed', 'Confirmées'], ['rejected', 'Rejetées'], ['all', 'Toutes']] as const).map(([k, l]) => <Chip key={k} active={status === k} onClick={() => setStatus(k)} color={LC}>{l}</Chip>)}</ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && list.length === 0 && <EmptyState icon={<Lightbulb size={28} />} color={LC} title="Aucune hypothèse">Lancez une enquête depuis la fiche d’une personne : le généalogiste IA proposera des pistes ici.</EmptyState>}
      {list.length > 0 && (
        <Group>
          {list.map((h) => {
            const subj = h.subject_person_id ? byId.get(h.subject_person_id) : undefined
            const score = typeof h.score === 'number' ? Math.round(h.score <= 1 ? h.score * 100 : h.score) : null
            return (
              <Row key={h.id} to={subj ? `/personnes/${subj.id}` : '/enquetes'}
                left={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff6d6] text-[#b98900]"><Lightbulb size={17} /></span>}
                title={h.title} subtitle={[subj?.display_name, H_STATUS[h.status] ?? h.status, h.description].filter(Boolean).join(' · ')}
                right={score !== null ? <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold text-white" style={{ background: score >= 70 ? '#2e9a52' : score >= 40 ? '#d4930f' : '#9aa1ad' }}>{score} %</span> : undefined} />
            )
          })}
        </Group>
      )}
    </PageFrame>
  )
}

