import { useMemo, useState } from 'react'
import { Cake, CircleDashed, Cross, Heart, HeartHandshake, MapPinOff, Users } from 'lucide-react'
import { api, type EventRow, type FamilyOut, type PersonSummary } from '../../api'
import { ConfidenceDot } from '../ui'
import { COLORS, EmptyState, ErrorState, LoadingState, PersonAvatar, normalize, pool, shortPlace, useLoader } from '../views/common'
import { catOf } from '../views/eventCats'
import { Chip, ChipBar, Group, PageFrame, Row, SectionIndex } from './ListKit'

export const LC = COLORS.listes
export interface ListProps { search: string; setSearch: (v: string) => void; autoFocus: boolean }

const letterOf = (s: string | null | undefined) => {
  const c = normalize((s ?? '').trim()).charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}
const jump = (prefix: string) => (l: string) => document.getElementById(`${prefix}-${l}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })

/* ------------------------------------------------------------------ */
type PSort = 'nom' | 'prenom' | 'naissance' | 'deces' | 'sosa'
const sosaOf = (p: PersonSummary) => (p.sosa && p.sosa.length ? Math.min(...p.sosa) : null)
const genOf = (n: number) => Math.floor(Math.log2(n)) + 1
export function PersonsList({ search, setSearch, autoFocus }: ListProps) {
  const { data, loading, error, reload } = useLoader<PersonSummary[]>(() => api.persons(undefined, 2000), [])
  const [sort, setSort] = useState<PSort>('nom')
  const groups = useMemo(() => {
    const n = normalize(search.trim())
    const list = (data ?? []).filter((p) => !n || normalize(`${p.display_name} ${p.married_name ?? ''} ${p.birth_place ?? ''} ${p.occupation ?? ''}`).includes(n))
    const key = (p: PersonSummary): string => {
      if (sort === 'nom') return letterOf(p.surname || p.display_name)
      if (sort === 'prenom') return letterOf(p.given_names || p.display_name)
      if (sort === 'sosa') { const n = sosaOf(p); return n ? `${genOf(n)}` : '—' }
      const y = sort === 'naissance' ? p.birth_year : p.death_year
      return y ? `${Math.floor(y / 10) * 10}` : '—'
    }
    const cmp = (a: PersonSummary, b: PersonSummary) => {
      if (sort === 'nom') return normalize(`${a.surname ?? ''} ${a.given_names ?? ''}`).localeCompare(normalize(`${b.surname ?? ''} ${b.given_names ?? ''}`))
      if (sort === 'prenom') return normalize(`${a.given_names ?? ''} ${a.surname ?? ''}`).localeCompare(normalize(`${b.given_names ?? ''} ${b.surname ?? ''}`))
      if (sort === 'sosa') return (sosaOf(a) ?? 1e15) - (sosaOf(b) ?? 1e15) || normalize(`${a.surname ?? ''} ${a.given_names ?? ''}`).localeCompare(normalize(`${b.surname ?? ''} ${b.given_names ?? ''}`))
      const ya = (sort === 'naissance' ? a.birth_year : a.death_year) ?? 99999, yb = (sort === 'naissance' ? b.birth_year : b.death_year) ?? 99999
      return ya - yb || a.display_name.localeCompare(b.display_name)
    }
    const map = new Map<string, PersonSummary[]>()
    list.slice().sort(cmp).forEach((p) => { const k = key(p); if (!map.has(k)) map.set(k, []); map.get(k)!.push(p) })
    const keys = [...map.keys()].sort((a, b) => (a === '#' || a === '—' ? 1 : b === '#' || b === '—' ? -1 : sort === 'nom' || sort === 'prenom' ? a.localeCompare(b) : Number(a) - Number(b)))
    return { keys, map, total: list.length }
  }, [data, search, sort])

  const nameNode = (p: PersonSummary) => {
    if (sort === 'nom' && p.surname) return <><b className="font-semibold">{p.surname.toUpperCase()}</b> {p.given_names}</>
    if (sort === 'prenom' && p.given_names) return <><b className="font-semibold">{p.given_names}</b> {p.surname?.toUpperCase()}</>
    return p.display_name
  }
  const sub = (p: PersonSummary) => [
    p.birth_display || p.birth_year ? `° ${p.birth_display ?? p.birth_year}${p.birth_place ? ` ${shortPlace(p.birth_place)}` : ''}` : null,
    p.death_display || p.death_year ? `† ${p.death_display ?? p.death_year}` : null,
    p.age_display ? (p.age_context === 'au décès' ? `${p.age_display}` : `${p.age_display}`) : null,
  ].filter(Boolean).join(' · ')

  return (
    <PageFrame title="Liste des personnes" subtitle={data ? `${groups.total} personne${groups.total > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch} autoFocus={autoFocus} searchPlaceholder="Nom, prénom, lieu, métier…"
      help={<p>Touchez une personne pour ouvrir sa fiche. L’index à droite permet de sauter directement à une lettre ; le point coloré indique la fiabilité de la fiche.</p>}
      toolbar={<ChipBar>{([['nom', 'Nom'], ['prenom', 'Prénom'], ['naissance', 'Naissance'], ['deces', 'Décès'], ['sosa', 'Trier par Sosa']] as [PSort, string][]).map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => setSort(k)} color={LC}>{l}</Chip>)}</ChipBar>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && groups.total === 0 && <EmptyState icon={<Users size={28} />} color={LC} title={search ? 'Aucun résultat' : 'Aucune personne'}>{search ? `Aucune personne ne correspond à « ${search} ».` : 'Commencez par ajouter vos grands-parents depuis « Démarrer ».'}</EmptyState>}
      <div className="pr-5 sm:pr-8">
        {groups.keys.map((k) => (
          <Group key={k} id={`p-${k}`} title={sort === 'sosa' ? (k === '—' ? 'Hors ascendance directe' : `Génération ${k}`) : sort === 'naissance' || sort === 'deces' ? (k === '—' ? 'Date inconnue' : `Années ${k}`) : k}>
            {groups.map.get(k)!.map((p) => (
              <Row key={p.id} to={`/personnes/${p.id}`} left={<PersonAvatar p={p} size={38} />} title={<>{nameNode(p)}{p.is_root && <span className="ml-1 text-[#f5b400]">★</span>}</>} subtitle={sub(p) || 'Aucune date'}
                right={<span className="flex items-center gap-2">{(p.sosa?.length ?? 0) > 0 && <span className="rounded-full border border-brass-300/70 bg-brass-200/50 px-1.5 py-px text-[11px] font-semibold tabular-nums text-brass-600" title="Numéro Sosa">Sosa {p.sosa!.join(' · ')}</span>}<ConfidenceDot level={p.confidence} /></span>} />
            ))}
          </Group>
        ))}
      </div>
      {(sort === 'nom' || sort === 'prenom') && <SectionIndex letters={groups.keys} color={LC} onJump={jump('p')} />}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
interface Fam { id: string; partners: { id: string; name: string; sex: string | null }[]; union: EventRow | null; children: number | null; type: string | null }
export function FamiliesList({ search, setSearch }: ListProps) {
  const [progress, setProgress] = useState(0)
  const [sort, setSort] = useState<'nom' | 'date'>('nom')
  const { data, loading, error, reload } = useLoader(async () => {
    const [events, persons] = await Promise.all([api.events(), api.persons(undefined, 2000)])
    const byId = new Map(persons.map((p) => [p.id, p]))
    const fams = new Map<string, Fam>()
    for (const e of events) {
      if (!e.family_id) continue
      const f = fams.get(e.family_id) ?? { id: e.family_id, partners: e.persons, union: null, children: null, type: null }
      if (catOf(e.event_type) === 'mariages' && (!f.union || (e.sort_year ?? 99999) < (f.union.sort_year ?? 99999))) f.union = e
      if (f.partners.length < e.persons.length) f.partners = e.persons
      fams.set(e.family_id, f)
    }
    // Compléter : nombre d'enfants et unions sans événement, à partir des fiches des conjoints.
    const anchors = [...new Set([...fams.values()].map((f) => f.partners[0]?.id).filter((x): x is string => !!x))].slice(0, 300)
    const details = await pool(anchors, 6, (id) => api.person(id), setProgress)
    const addFamily = (fo: FamilyOut) => {
      const f = fams.get(fo.id) ?? { id: fo.id, partners: [fo.partner1_id, fo.partner2_id].filter((x): x is string => !!x).map((id) => ({ id, name: byId.get(id)?.display_name ?? 'Inconnu', sex: byId.get(id)?.sex ?? null })), union: null, children: null, type: null }
      f.children = fo.children_ids.length; f.type = fo.union_type
      fams.set(fo.id, f)
    }
    details.forEach((d) => d?.families.forEach(addFamily))
    return { fams: [...fams.values()], byId }
  }, [])
  const list = useMemo(() => {
    const n = normalize(search.trim())
    const l = (data?.fams ?? []).filter((f) => !n || normalize(`${f.partners.map((p) => p.name).join(' ')} ${f.union?.place ?? ''}`).includes(n))
    return l.sort((a, b) => sort === 'date' ? (a.union?.sort_year ?? 99999) - (b.union?.sort_year ?? 99999) : normalize(a.partners[0]?.name.split(' ').slice(-1)[0] ?? '').localeCompare(normalize(b.partners[0]?.name.split(' ').slice(-1)[0] ?? '')))
  }, [data, search, sort])
  return (
    <PageFrame title="Familles" subtitle={data ? `${list.length} couple${list.length > 1 ? 's' : ''}` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Nom d’un conjoint, lieu…"
      toolbar={<ChipBar><Chip active={sort === 'nom'} onClick={() => setSort('nom')} color={LC}>Nom</Chip><Chip active={sort === 'date'} onClick={() => setSort('date')} color={LC}>Date d’union</Chip></ChipBar>}>
      {loading && <LoadingState color={LC} label={progress ? `Chargement des familles… ${progress}` : 'Chargement…'} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && list.length === 0 && <EmptyState icon={<HeartHandshake size={28} />} color={LC} title="Aucune famille">Ajoutez un conjoint ou un mariage depuis la fiche d’une personne.</EmptyState>}
      {list.length > 0 && (
        <Group footer="Les couples sont retrouvés à partir de leurs unions (mariage, PACS…) et des fiches des conjoints.">
          {list.map((f) => {
            const ps = f.partners.map((p) => data!.byId.get(p.id) ?? null)
            return (
              <Row key={f.id} to={f.partners[0] ? `/personnes/${f.partners[0].id}` : undefined}
                left={<span className="flex -space-x-3">{ps.slice(0, 2).map((p, i) => p ? <PersonAvatar key={i} p={p} size={34} ring /> : null)}</span>}
                title={f.partners.length ? f.partners.map((p) => p.name).join(' & ') : 'Couple'}
                subtitle={f.union ? `∞ ${f.union.date_display || 'date inconnue'}${f.union.place ? ` · ${shortPlace(f.union.place)}` : ''}` : 'Union sans date'}
                right={f.children !== null ? `${f.children} enfant${f.children > 1 ? 's' : ''}` : undefined} />
            )
          })}
        </Group>
      )}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
type AType = 'tous' | 'naissances' | 'mariages' | 'deces'
export function AnniversariesList({ search, setSearch }: ListProps) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [type, setType] = useState<AType>('tous')
  const { data, loading, error, reload } = useLoader<EventRow[]>(() => api.events(), [])
  const days = useMemo(() => {
    const n = normalize(search.trim())
    const out = new Map<number, { e: EventRow; y: number }[]>()
    for (const e of data ?? []) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.date_start ?? '')
      if (!m || e.date_kind !== 'exact' || Number(m[2]) !== month) continue
      const cat = catOf(e.event_type)
      if (!['birth', 'death'].includes(e.event_type) && cat !== 'mariages') continue
      if (type !== 'tous' && cat !== type) continue
      if (n && !normalize(e.persons.map((p) => p.name).join(' ')).includes(n)) continue
      const d = Number(m[3])
      if (!out.has(d)) out.set(d, [])
      out.get(d)!.push({ e, y: Number(m[1]) })
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0])
  }, [data, month, type, search])
  const icon = (t: string) => (t === 'birth' ? <Cake size={18} /> : t === 'death' ? <Cross size={18} /> : <Heart size={18} />)
  const tone = (t: string) => (t === 'birth' ? '#2e9a52' : t === 'death' ? '#47506a' : '#d4930f')
  const verb = (e: EventRow) => (e.event_type === 'birth' ? 'Naissance' : e.event_type === 'death' ? 'Décès' : 'Mariage')
  const total = days.reduce((s, [, l]) => s + l.length, 0)
  return (
    <PageFrame title="Anniversaires" subtitle={`${MONTHS[month - 1]} · ${total} anniversaire${total > 1 ? 's' : ''}`} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Nom…"
      help={<p>Les naissances, mariages et décès dont la date exacte tombe dans le mois choisi, avec le nombre d’années écoulées.</p>}
      toolbar={<div className="space-y-2">
        <ChipBar>{MONTHS.map((m, i) => <Chip key={m} active={month === i + 1} onClick={() => setMonth(i + 1)} color={LC}>{m}</Chip>)}</ChipBar>
        <ChipBar>{([['tous', 'Tous'], ['naissances', 'Naissances'], ['mariages', 'Mariages'], ['deces', 'Décès']] as [AType, string][]).map(([k, l]) => <Chip key={k} active={type === k} onClick={() => setType(k)} color={LC}>{l}</Chip>)}</ChipBar>
      </div>}>
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && total === 0 && <EmptyState icon={<Cake size={28} />} color={LC} title={`Aucun anniversaire en ${MONTHS[month - 1].toLowerCase()}`}>Seuls les événements avec une date complète (jour, mois, année) apparaissent ici.</EmptyState>}
      {days.map(([d, items]) => {
        const today = d === now.getDate() && month === now.getMonth() + 1
        return (
          <Group key={d} title={<>{d} {MONTHS[month - 1].toLowerCase()}{today && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] normal-case text-white" style={{ background: LC }}>Aujourd’hui</span>}</>}>
            {items.map(({ e, y }) => {
              const ago = now.getFullYear() - y
              return (
                <Row key={e.id} to={e.persons[0] ? `/personnes/${e.persons[0].id}` : undefined}
                  left={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: tone(e.event_type) }}>{icon(e.event_type)}</span>}
                  title={`${verb(e)} ${/^[aeiouyhéè]/i.test(e.persons[0]?.name ?? '') ? 'd’' : 'de '}${e.persons.map((p) => p.name).join(' et ')}`}
                  subtitle={`${e.date_display}${e.place ? ` · ${shortPlace(e.place)}` : ''}`}
                  right={<span className="flex flex-col items-end leading-tight"><span className="text-[10px] text-mist-400">il y a</span><span className="font-semibold" style={{ color: LC }}>{ago} an{ago > 1 ? 's' : ''}</span></span>} />
              )
            })}
          </Group>
        )
      })}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
export function MissingFactsList({ search, setSearch }: ListProps) {
  const { data, loading, error, reload } = useLoader(() => api.databaseState(), [])
  const n = normalize(search.trim())
  const f = (l: PersonSummary[]) => l.filter((p) => !n || normalize(p.display_name).includes(n))
  const sections: { t: string; l: PersonSummary[]; hint: string }[] = data ? [
    { t: 'Sans date de naissance', l: f(data.missing_birth), hint: 'Cherchez l’acte de naissance ou de baptême.' },
    { t: 'Sans parents connus', l: f(data.missing_parents), hint: 'L’acte de naissance ou de mariage donne en général le nom des parents.' },
    { t: 'Probablement décédés, sans date de décès', l: f(data.probably_deceased_without_date), hint: 'Le fichier des décès INSEE (depuis 1970) ou les tables décennales peuvent aider.' },
    { t: 'Sans aucune source', l: f(data.without_sources), hint: 'Ajoutez au moins un acte pour fiabiliser la fiche.' },
  ] : []
  const places = (data?.places_without_coordinates ?? []).filter((p) => !n || normalize(p.name).includes(n))
  return (
    <PageFrame title="Faits manquants" subtitle={data ? `${sections.reduce((s, x) => s + x.l.length, 0)} manques` : undefined} color={LC} search={search} onSearch={setSearch} searchPlaceholder="Nom…">
      {loading && <LoadingState color={LC} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {sections.map((s) => (
        <Group key={s.t} title={`${s.t} (${s.l.length})`} footer={s.l.length ? s.hint : undefined}>
          {s.l.length === 0 ? <Row title={<span className="text-[#2f6b3b]">✓ Rien à signaler</span>} /> : s.l.map((p) => (
            <Row key={p.id} to={`/personnes/${p.id}`} left={<PersonAvatar p={p} size={34} />} title={p.display_name} subtitle={[p.birth_year && `° ${p.birth_year}`, p.death_year && `† ${p.death_year}`].filter(Boolean).join(' · ') || 'Aucune date'} right={<ConfidenceDot level={p.confidence} />} />
          ))}
        </Group>
      ))}
      {data && (
        <Group title={`Lieux sans coordonnées (${places.length})`} footer={places.length ? 'Ils n’apparaissent pas sur les cartes : géocodez-les depuis la Carte familiale.' : undefined}>
          {places.length === 0 ? <Row title={<span className="text-[#2f6b3b]">✓ Tous les lieux sont localisés</span>} /> : places.map((p) => (
            <Row key={p.id} to="/carte" left={<span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fff1e0] text-[#c4651a]"><MapPinOff size={16} /></span>} title={p.name} />
          ))}
        </Group>
      )}
      {data && sections.every((s) => s.l.length === 0) && places.length === 0 && !search && <EmptyState icon={<CircleDashed size={26} />} color={LC} title="Base complète">Aucun fait manquant détecté. Bravo !</EmptyState>}
    </PageFrame>
  )
}
