import { useMemo, useState, type ReactNode } from 'react'
import { api, CONF_LABEL, RELATION_LABEL, type CitationOut, type EventOut, type PersonDetail, type PersonSummary } from '../../api'
import { ConfidenceDot } from '../ui'
import { ErrorState, LoadingState, PersonAvatar, ageBetween, eventLabel, pool, useLoader } from '../views/common'
import { ageText } from '../views/people'
import { Facts, Muted, PersonRef, RC, RSection, RTable, ReportDoc, lifeLine } from './ReportKit'

export interface ReportProps { focusId: string; persons: PersonSummary[]; gens: number }

const SEX_LABEL: Record<string, string> = { M: 'Homme', F: 'Femme' }
const approx = (e: Pick<EventOut, 'date_kind'>) => !!e.date_kind && e.date_kind !== 'exact'
const placeOf = (e: EventOut) => e.place_name ?? e.place_original ?? ''
const sortEvents = <T extends Pick<EventOut, 'sort_year' | 'date_start'>>(a: T, b: T) => (a.sort_year ?? 9999) - (b.sort_year ?? 9999) || (a.date_start ?? '').localeCompare(b.date_start ?? '')

/** Événements de la personne + événements de ses unions (mariage…), avec le conjoint concerné. */
function allEvents(d: PersonDetail) {
  const spouseName = (fid: string | null) => {
    const f = d.families.find((x) => x.id === fid)
    const other = f ? (f.partner1_id === d.id ? f.partner2_id : f.partner1_id) : null
    return d.spouses.find((s) => s.id === other) ?? null
  }
  const own = d.events.map((e) => ({ e, partner: null as PersonSummary | null }))
  const fam = d.families.flatMap((f) => f.events.map((e) => ({ e, partner: spouseName(f.id) })))
  const seen = new Set<string>()
  return [...own, ...fam].filter((x) => (seen.has(x.e.id) ? false : (seen.add(x.e.id), true))).sort((a, b) => sortEvents(a.e, b.e))
}
const birthOf = (d: PersonDetail) => d.events.find((e) => e.event_type === 'birth') ?? d.events.find((e) => e.event_type === 'baptism') ?? null

function useDetail(id: string) { return useLoader<PersonDetail>(() => api.person(id), [id]) }

function Header({ d }: { d: PersonDetail }) {
  return (
    <div className="flex items-center gap-3">
      {d.portrait_media_id
        ? <img src={api.mediaFileUrl(d.portrait_media_id)} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-black/10" />
        : <PersonAvatar p={d} size={56} />}
      <div>
        <div className="text-lg font-bold">{d.display_name}</div>
        <div className="text-sm text-mist-500">{lifeLine(d) || 'Dates inconnues'}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
export function SynthesePersonnelle({ focusId }: ReportProps) {
  const { data: d, loading, error, reload } = useDetail(focusId)
  if (loading) return <LoadingState color={RC} />
  if (error || !d) return <ErrorState message={error ?? 'Personne introuvable.'} onRetry={reload} />
  const evs = allEvents(d)
  const cits = new Map<string, CitationOut>()
  ;[...d.citations, ...d.events.flatMap((e) => e.citations), ...d.families.flatMap((f) => f.events.flatMap((e) => e.citations))].forEach((c) => cits.set(c.id, c))
  const relOf = (pid: string) => d.parent_relations.find((r) => r.parent_id === pid)?.relation_type
  const marriageWith = (sid: string) => {
    const f = d.families.find((x) => x.partner1_id === sid || x.partner2_id === sid)
    const m = f?.events.find((e) => /marriage|pacs/.test(e.event_type)) ?? f?.events[0]
    return m ? `${eventLabel(m.event_type)} ${m.date_display}${placeOf(m) ? ` à ${placeOf(m)}` : ''}` : ''
  }
  const photo = d.portrait_media_id
  return (
    <ReportDoc title="Synthèse personnelle" subject={d.display_name}>
      <RSection title="Identité">
        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <Facts rows={[
              ['Nom', <b key="n">{d.display_name}</b>],
              ['Prénoms', d.given_names],
              ['Nom de famille', d.surname],
              ['Nom d’usage', d.married_name],
              ['Autres graphies', d.name_variants.join(', ')],
              ['Sexe', SEX_LABEL[d.sex ?? ''] ?? 'Inconnu'],
              ['Naissance', (d.birth_display || d.birth_place) && `${d.birth_display ?? ''}${d.birth_place ? ` à ${d.birth_place}` : ''}`],
              ['Décès', (d.death_display || d.death_place) && `${d.death_display ?? ''}${d.death_place ? ` à ${d.death_place}` : ''}`],
              ['Âge', d.age_display && <span key="a">{d.age_display} {d.age_detail && <Muted>{ageText(d)}</Muted>} <Muted>{d.age_context}</Muted></span>],
              ['Profession', d.occupation],
              ['Nationalité', d.nationality],
              ['Fiabilité', <span key="c" className="inline-flex items-center gap-1.5"><ConfidenceDot level={d.confidence} />{CONF_LABEL[d.confidence]}</span>],
            ]} />
          </div>
          {photo
            ? <img src={api.mediaFileUrl(photo)} alt={d.display_name} className="h-28 w-24 self-start rounded-2xl object-cover shadow ring-1 ring-black/10 sm:h-40 sm:w-32" />
            : <div className="self-start"><PersonAvatar p={d} size={64} /></div>}
        </div>
      </RSection>

      <RSection title="Événements" count={evs.length}>
        <RTable head={['Événement', 'Date', 'Lieu', 'Détails']} empty="Aucun événement enregistré."
          rows={evs.map(({ e, partner }) => [
            <span key="t" className="inline-flex items-center gap-1.5 font-medium"><ConfidenceDot level={e.confidence} className="!h-2 !w-2" />{eventLabel(e.event_type)}</span>,
            <span key="d" className="whitespace-nowrap">{e.date_display || '—'}</span>,
            placeOf(e) || '—',
            partner || e.description || e.value_original || e.citations.length ? <span key="x">{partner && <>avec <PersonRef p={partner} years={false} /> </>}{e.description ?? e.value_original ?? ''}{e.citations.length > 0 && <Muted> · {e.citations.length} source{e.citations.length > 1 ? 's' : ''}</Muted>}</span> : null,
          ])} />
      </RSection>

      <RSection title="Famille">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { t: 'Parents', list: d.parents, extra: (p: PersonSummary) => { const r = relOf(p.id); return r && r !== 'biological' ? `lien ${RELATION_LABEL[r] ?? r}` : '' } },
            { t: 'Conjoints', list: d.spouses, extra: (p: PersonSummary) => marriageWith(p.id) },
            { t: 'Enfants', list: d.children, extra: () => '' },
            { t: 'Frères et sœurs', list: d.siblings, extra: () => '' },
          ].map((g) => (
            <div key={g.t} className="avoid-break">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mist-500">{g.t} ({g.list.length})</h3>
              {g.list.length === 0 ? <p className="text-sm italic text-mist-400">Aucun</p> : (
                <ul className="space-y-1">
                  {g.list.map((p) => <li key={p.id}><PersonRef p={p} />{g.extra(p) && <div className="text-xs text-mist-500">{g.extra(p)}</div>}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </RSection>

      <RSection title="Sources" count={cits.size}>
        {cits.size === 0 ? <p className="text-sm italic text-mist-500">Aucune source citée pour l’instant : les informations restent à vérifier.</p> : (
          <ol className="list-decimal space-y-1.5 pl-5">
            {[...cits.values()].map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.source_title ?? 'Source'}</span>
                {c.source_reliability && <Muted> · {c.source_reliability === 'primary' ? 'source primaire' : c.source_reliability === 'secondary' ? 'source secondaire' : c.source_reliability}</Muted>}
                {c.excerpt && <div className="text-xs italic text-mist-500">« {c.excerpt} »</div>}
              </li>
            ))}
          </ol>
        )}
      </RSection>

      {d.notes && <RSection title="Notes"><p className="whitespace-pre-wrap">{d.notes}</p></RSection>}

      {d.media.length > 0 && (
        <RSection title="Documents et photos" count={d.media.length}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.media.map((m) => (
              <li key={m.id} className="avoid-break overflow-hidden rounded-xl bg-[#fbf6f1] text-xs">
                {m.mime_type?.startsWith('image/') && <img src={api.mediaFileUrl(m.id)} alt="" className="h-24 w-full object-cover" loading="lazy" />}
                <div className="truncate p-1.5">{m.title ?? m.original_filename ?? 'Document'}</div>
              </li>
            ))}
          </ul>
        </RSection>
      )}

      {(d.contradictions.length > 0 || d.questions.length > 0) && (
        <RSection title="Points à vérifier">
          <ul className="list-disc space-y-1 pl-5">
            {d.contradictions.map((c) => <li key={c.id}><span className={c.severity === 'red' ? 'text-conf-red' : 'text-[#8a5a10]'}>{c.description}</span></li>)}
            {d.questions.map((q) => <li key={q.id}>{q.title}</li>)}
          </ul>
        </RSection>
      )}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function EvenementsPersonnels({ focusId }: ReportProps) {
  const { data: d, loading, error, reload } = useDetail(focusId)
  if (loading) return <LoadingState color={RC} />
  if (error || !d) return <ErrorState message={error ?? 'Personne introuvable.'} onRetry={reload} />
  const b = birthOf(d)
  const evs = allEvents(d)
  return (
    <ReportDoc title="Événements personnels" subject={<Header d={d} />}>
      <RSection title="Événements datés et localisés" count={evs.length}>
        <RTable head={['Date', 'Événement', 'Lieu', 'Âge', 'Sources']} empty="Aucun événement enregistré pour cette personne."
          rows={evs.map(({ e, partner }) => {
            const age = b && e.id !== b.id ? ageBetween(b.date_start, e.date_start) : null
            return [
              <span key="d" className="whitespace-nowrap font-medium">{e.date_display || '—'}</span>,
              <span key="t">{eventLabel(e.event_type)}{partner && <> avec <PersonRef p={partner} years={false} /></>}{e.description && <div className="text-xs text-mist-500">{e.description}</div>}</span>,
              placeOf(e) || <Muted key="p">—</Muted>,
              <span key="a" className="whitespace-nowrap">{age ? (approx(e) || approx(b!) ? (age.startsWith('≈') ? age : `≈ ${age}`) : age) : <Muted>—</Muted>}</span>,
              <span key="s">{e.citations.length || <Muted>0</Muted>}</span>,
            ]
          })} />
        <p className="mt-2 text-xs text-mist-500">L’âge est calculé à partir de la date de naissance ; « ≈ » signale une date approximative ou incomplète.</p>
      </RSection>
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function Biographie({ focusId, gens }: ReportProps) {
  const [lineage, setLineage] = useState(false)
  const { data, loading, error, reload } = useLoader(() => (lineage ? api.familyNarrative(focusId, gens) : api.narrative(focusId).then((n) => [n])), [focusId, lineage, gens])
  return (
    <ReportDoc title="Biographie" subject={data?.[0]?.name}
      intro={<label className="no-print inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={lineage} onChange={(e) => setLineage(e.target.checked)} style={{ accentColor: RC }} /> Inclure les ancêtres ({gens} générations)</label>}>
      {loading && <LoadingState color={RC} label="Rédaction de la biographie…" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data?.map((n, idx) => {
        const notes: CitationOut[] = []
        return (
          <RSection key={n.person_id} title={idx === 0 && !lineage ? 'Récit' : n.name}>
            {n.paragraphs.length === 0 && <p className="italic text-mist-500">Pas encore assez d’informations pour rédiger un récit.</p>}
            {n.paragraphs.map((p, i) => (
              <p key={i} className="mb-2 text-[14.5px] leading-7">
                {p.text}
                {p.sources.map((s) => { notes.push(s); return <sup key={s.id} className="ml-0.5 font-semibold" style={{ color: RC }}>{notes.length}</sup> })}
                {p.sources.length === 0 && <span className="no-print ml-1 align-middle"><ConfidenceDot level={p.confidence} className="!h-2 !w-2" /></span>}
              </p>
            ))}
            {notes.length > 0 && (
              <ol className="mt-3 list-decimal space-y-0.5 border-t pl-5 pt-2 text-xs text-mist-500" style={{ borderColor: `${RC}22` }}>
                {notes.map((s, i) => <li key={i}>{s.source_title ?? 'Source'}{s.excerpt ? ` — « ${s.excerpt} »` : ''}</li>)}
              </ol>
            )}
            {n.unsourced_count > 0 && <p className="mt-2 text-xs text-mist-500">{n.unsourced_count} affirmation{n.unsourced_count > 1 ? 's' : ''} sans source : à confirmer par un acte.</p>}
            {n.historical_context.length > 0 && (
              <div className="avoid-break mt-3 rounded-2xl bg-[#fbf3ec] p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: RC }}>Contexte historique</h3>
                <ul className="space-y-0.5 text-sm">
                  {n.historical_context.map((h, i) => <li key={i}><span className="tabular-nums text-mist-500">{h.start}{h.end !== h.start ? `–${h.end}` : ''}</span> · {h.label}</li>)}
                </ul>
              </div>
            )}
          </RSection>
        )
      })}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
interface ChronoItem { key: string; year: number | null; sortKey: string; date: string; text: ReactNode; place: string; own: boolean; age: string | null; history?: boolean }
const REL_NOUN = {
  parent: (p: PersonSummary) => (p.sex === 'M' ? 'son père' : p.sex === 'F' ? 'sa mère' : 'son parent'),
  spouse: (p: PersonSummary) => (p.sex === 'M' ? 'son époux' : p.sex === 'F' ? 'son épouse' : 'son conjoint'),
  child: (p: PersonSummary) => (p.sex === 'M' ? 'son fils' : p.sex === 'F' ? 'sa fille' : 'son enfant'),
  sibling: (p: PersonSummary) => (p.sex === 'M' ? 'son frère' : p.sex === 'F' ? 'sa sœur' : 'son frère ou sa sœur'),
}
const DE = (s: string) => (/^[aeiouyhéèêàâîôû]/i.test(s) ? 'd’' : 'de ')

export function Chronologie({ focusId }: ReportProps) {
  const [progress, setProgress] = useState(0)
  const { data, loading, error, reload } = useLoader(async () => {
    setProgress(0)
    const d = await api.person(focusId)
    const rels: { p: PersonSummary; kind: keyof typeof REL_NOUN }[] = [
      ...d.parents.map((p) => ({ p, kind: 'parent' as const })), ...d.spouses.map((p) => ({ p, kind: 'spouse' as const })),
      ...d.children.map((p) => ({ p, kind: 'child' as const })), ...d.siblings.map((p) => ({ p, kind: 'sibling' as const })),
    ].slice(0, 30)
    const [details, tl] = await Promise.all([
      pool(rels, 6, (r) => api.person(r.p.id), setProgress),
      api.timeline(focusId).catch(() => null),
    ])
    return { d, rels, details, hist: tl?.historical_events ?? [] }
  }, [focusId])

  const items = useMemo(() => {
    if (!data) return []
    const { d, rels, details, hist } = data
    const b = birthOf(d)
    const out: ChronoItem[] = []
    for (const { e, partner } of allEvents(d)) {
      out.push({ key: e.id, year: e.sort_year, sortKey: e.date_start ?? String(e.sort_year ?? ''), date: e.date_display, own: true, place: placeOf(e),
        age: b && e.id !== b.id ? ageBetween(b.date_start, e.date_start) : null,
        text: <>{eventLabel(e.event_type)}{partner && <> avec <PersonRef p={partner} years={false} /></>}{e.description ? ` — ${e.description}` : ''}</> })
    }
    const ownIds = new Set(out.map((o) => o.key))
    rels.forEach((r, i) => {
      const rd = details[i]
      if (!rd) return
      for (const e of rd.events) {
        if (!['birth', 'death', 'burial', 'baptism'].includes(e.event_type) || ownIds.has(e.id)) continue
        if (r.kind === 'parent' && e.event_type === 'birth') continue
        const lbl = eventLabel(e.event_type)
        out.push({ key: `${r.p.id}-${e.id}`, year: e.sort_year, sortKey: e.date_start ?? String(e.sort_year ?? ''), date: e.date_display, own: false, place: placeOf(e),
          age: b ? ageBetween(b.date_start, e.date_start) : null,
          text: <>{lbl} {DE(REL_NOUN[r.kind](r.p))}{REL_NOUN[r.kind](r.p)} <PersonRef p={r.p} years={false} /></> })
      }
    })
    const years = out.map((o) => o.year).filter((y): y is number => y !== null)
    if (years.length) {
      const lo = d.birth_year ?? Math.min(...years), hi = d.death_year ?? (d.is_living ? new Date().getFullYear() : Math.max(...years))
      for (const h of hist) if (h.end >= lo && h.start <= hi) out.push({ key: `h-${h.label}`, year: Math.max(h.start, lo), sortKey: String(Math.max(h.start, lo)), date: h.start === h.end ? String(h.start) : `${h.start}–${h.end}`, own: false, place: '', age: null, history: true, text: h.label })
    }
    return out.sort((x, y) => (x.year ?? 99999) - (y.year ?? 99999) || x.sortKey.localeCompare(y.sortKey) || Number(!!x.history) - Number(!!y.history))
  }, [data])

  if (loading) return <LoadingState color={RC} label={progress ? `Chargement de la famille proche… ${progress}` : 'Chargement…'} />
  if (error || !data) return <ErrorState message={error ?? 'Personne introuvable.'} onRetry={reload} />
  return (
    <ReportDoc title="Chronologie" subject={<Header d={data.d} />} intro="Les événements de la personne, ceux de sa famille proche (parents, conjoints, enfants, frères et sœurs) et le contexte historique de son époque.">
      {items.length === 0 ? <p className="italic text-mist-500">Aucun événement daté.</p> : (
        <ol className="relative ml-1 border-l-2 pl-5" style={{ borderColor: `${RC}33` }}>
          {items.map((it) => (
            <li key={it.key} className="avoid-break relative pb-3">
              <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white" style={{ background: it.history ? '#c9b8a6' : it.own ? RC : '#e8b48a' }} />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="min-w-[70px] font-semibold tabular-nums" style={{ color: it.history ? '#8b7b6b' : RC }}>{it.date || 'sans date'}</span>
                <span className={it.history ? 'italic text-mist-500' : it.own ? 'font-semibold' : ''}>{it.text}</span>
              </div>
              {(it.place || it.age) && <div className="text-xs text-mist-500">{it.place}{it.place && it.age ? ' · ' : ''}{it.age && `âge : ${it.age}`}</div>}
            </li>
          ))}
        </ol>
      )}
    </ReportDoc>
  )
}
