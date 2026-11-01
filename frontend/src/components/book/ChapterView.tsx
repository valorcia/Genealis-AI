import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, FileSearch, FileText, FileUp, Image as ImageIcon, Landmark, Search, TriangleAlert } from 'lucide-react'
import { API_BASE } from '../../api'
import type { BookAct, BookChapter, BookParagraph, ResearchItem } from '../../lib/bookApi'
import { BookPage, ContextBox, H2 } from './BookKit'
import { LifeMap } from './LifeMap'

const ACT_TR: Record<string, string> = {
  birth: 'de l’acte de naissance', baptism: 'de l’acte de baptême', child_baptism: 'de l’acte de baptême', marriage: 'de l’acte de mariage',
  civil_marriage: 'de l’acte de mariage', religious_marriage: 'de l’acte de mariage religieux', death: 'de l’acte de décès', burial: 'de l’acte de sépulture',
  marriage_contract: 'du contrat de mariage', census: 'du recensement', military: 'du registre matricule',
}

function upperSurname(name: string, surname: string | null) {
  if (!surname) return name
  const up = surname.toUpperCase()
  const i = name.lastIndexOf(up)
  if (i < 0) return name
  return <>{name.slice(0, i)}<span className="tracking-[0.02em]">{up}</span>{name.slice(i + up.length)}</>
}

/** Numérotation des notes : une source = un numéro, dans l'ordre d'apparition. */
function useNotes(ch: BookChapter) {
  const order: { id: string; title: string; excerpts: string[] }[] = []
  const index = new Map<string, number>()
  for (const b of ch.blocks) {
    if (b.type !== 'paragraph') continue
    for (const s of b.sources) {
      if (!index.has(s.source_id)) { index.set(s.source_id, order.length + 1); order.push({ id: s.source_id, title: s.title ?? 'Source', excerpts: [] }) }
      const n = order[index.get(s.source_id)! - 1]
      if (s.excerpt && !n.excerpts.includes(s.excerpt)) n.excerpts.push(s.excerpt)
    }
  }
  return { order, index }
}

export function ChapterView({ ch, number, showAi, mapEnabled = true, folioStart = 1, anchorPrefix = '' }: {
  ch: BookChapter; number?: number | null; showAi: boolean; mapEnabled?: boolean; folioStart?: number; anchorPrefix?: string
}) {
  const { order, index } = useNotes(ch)
  const gen = ch.generation
  const sosaLabel = ch.sosa.length ? `Sosa ${ch.sosa.join(' · ')}` : null
  const runRight = [sosaLabel, gen && ch.sosa.length ? `génération ${gen}` : null].filter(Boolean).join(' · ') || 'Famille'
  const shortName = ch.name
  let folio = folioStart
  const nextFolio = () => folio++
  const firstParaIdx = ch.blocks.findIndex((b) => b.type === 'paragraph')
  const actsWithImage = ch.acts.filter((a) => a.image_url && !a.transcription)  // les actes transcrits ont leur propre page
  const actsWithText = ch.acts.filter((a) => a.transcription)
  const hasLife = ch.places.length > 0
  const docs = ch.documents

  return (
    <div className="book-chapter">
      {/* ---------------- Page 1 : récit ---------------- */}
      <BookPage left={shortName} right={runRight} folio={nextFolio()}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="book-eyebrow">{number ? `Chapitre ${number}` : 'Chapitre'}{ch.sosa.length ? ` · Sosa ${ch.sosa[0]}` : ''}{ch.ancestor_generation ? ` · ${ch.ancestor_generation === 1 ? '1re' : `${ch.ancestor_generation}e`} génération d’ancêtres` : ''}</div>
            <h1 className="book-h1">{upperSurname(ch.name, ch.surname)}</h1>
            <div className="book-dates">{[ch.years, ch.place].filter(Boolean).join('  ·  ') || 'Dates et lieux encore inconnus'}</div>
            {ch.married_name && <div className="mt-0.5 text-[14px] italic text-[#85785f]">{ch.sex === 'F' ? 'épouse' : 'nom d’usage'} {ch.married_name}</div>}
          </div>
          {ch.portrait_media_id && (
            <img src={`${API_BASE}/api/media/${ch.portrait_media_id}/file`} alt={`Portrait de ${ch.name}`} className="h-[92px] w-[74px] shrink-0 rounded-[50%] border border-[rgb(122_79_42/0.3)] object-cover shadow-sm sm:h-[116px] sm:w-[92px]" />
          )}
        </div>
        <div className="book-title-rule" />

        {showAi && ch.ai_story && (
          <aside className="book-box is-ai">
            <div className="book-box-kicker" style={{ color: '#5b3fd6' }}>{ch.ai_story.label}</div>
            {ch.ai_story.stale && <p className="m-0 mb-1 text-[13px] font-semibold text-[#8e2e1f]">Les faits ont changé depuis cette reformulation : relancez « Réécrire avec l’IA ».</p>}
            {ch.ai_story.text.split(/\n\s*\n/).map((p, i) => <p key={i} className="m-0 mb-2 text-justify">{p}</p>)}
            <div className="book-box-src">Reformulation produite par {ch.ai_story.provider}{ch.ai_story.model ? ` (${ch.ai_story.model})` : ''} le {new Date(ch.ai_story.created_at).toLocaleDateString('fr-FR')}, à partir des seuls faits ci-dessous. Le texte factuel fait foi.</div>
          </aside>
        )}

        <div className="book-text">
          {ch.blocks.map((b, i) => b.type === 'paragraph'
            ? <Para key={i} b={b} first={i === firstParaIdx} refs={b.sources.map((s) => index.get(s.source_id)!).filter((x, j, a) => a.indexOf(x) === j)} anchorPrefix={anchorPrefix} />
            : <ContextBox key={i} box={b} />)}
        </div>
        {order.length > 0 && (
          <div className="mt-5 border-t border-[rgb(122_79_42/0.15)] pt-2">
            <div className="book-h3">Notes et sources</div>
            <ol className="m-0 list-none p-0 text-[12.5px] leading-snug text-[#5d5141]">
              {order.map((n, i) => (
                <li key={n.id} id={`${anchorPrefix}note-${i + 1}`} className="mb-0.5"><span className="mr-1 font-semibold text-[#876a2e]">{i + 1}.</span>{n.title}{n.excerpts.length > 0 && <span className="italic"> — « {n.excerpts.join(' » ; « ')} »</span>}</li>
              ))}
            </ol>
          </div>
        )}
        <p className="book-small mt-3 italic">{ch.sources_note}</p>
      </BookPage>

      {/* ---------------- Page 2 : lieux de vie ---------------- */}
      {hasLife && (
        <BookPage left={shortName} right="suite" folio={nextFolio()}>
          <H2>Mes lieux de vie</H2>
          {mapEnabled ? <LifeMap points={ch.places.map((p) => ({ n: p.n, name: p.name, lat: p.lat, lon: p.lon }))} /> : null}
          <ol className="book-legend m-0 list-none p-0">
            {ch.places.map((p) => (
              <li key={p.n}><b>{p.n}.</b> {p.name}{' '}
                {p.year_start != null && <span className="yr">{p.year_start}{p.year_end != null && p.year_end !== p.year_start ? ` – ${p.year_end}` : ''}</span>}
                {p.labels.length > 0 && <span> — {p.labels.join(', ')}</span>}
                {p.lat == null && <span className="book-small italic"> (non localisé)</span>}
              </li>
            ))}
          </ol>
        </BookPage>
      )}

      {/* ---------------- Page 3 : tableaux et entourage ---------------- */}
      <BookPage left={shortName} right="suite" folio={nextFolio()}>
        {actsWithImage.length > 0 && (
          <>
            <H2>Les actes</H2>
            <div className={`book-figures ${actsWithImage.length > 1 ? 'two' : ''}`}>
              {actsWithImage.slice(0, 4).map((a) => <ActFigure key={a.media_id ?? a.title} a={a} />)}
            </div>
          </>
        )}
        <H2>Famille</H2>
        {ch.family.length === 0 ? <p className="italic text-[#85785f]">Aucun proche n’est encore relié à cette personne dans l’arbre.</p> : (
          <table className="book-table"><tbody>
            {ch.family.map((r, i) => (
              <tr key={i}><th>{r.role}</th><td>{r.persons.map((x, j) => (
                <Fragment key={x.id}>{j > 0 && ' ; '}<Link to={`/livre/personne/${x.id}`}>{x.name}</Link>{x.years && <span className="text-[#85785f]"> ({x.years})</span>}{x.extra && <span> — {x.extra}</span>}{x.sosa[0] != null && <span className="book-sosa ml-1">{x.sosa[0]}</span>}</Fragment>
              ))}</td></tr>
            ))}
          </tbody></table>
        )}
        <H2>Repères</H2>
        {ch.landmarks.length === 0 ? <p className="italic text-[#85785f]">Aucun événement daté pour l’instant.</p> : (
          <table className="book-table"><tbody>
            {ch.landmarks.map((l, i) => (
              <tr key={l.event_id ?? i}><th>{l.label}</th><td>{[l.date, l.place].filter(Boolean).join(' · ')}{l.value ? `${l.date || l.place ? ' — ' : ''}${l.value}` : ''}{!l.date && !l.place && !l.value && <span className="italic text-[#85785f]">date et lieu à trouver</span>}</td></tr>
            ))}
          </tbody></table>
        )}
        {ch.people_around.length > 0 && (
          <>
            <H2>Les gens autour de moi</H2>
            <ul className="book-list">
              {ch.people_around.map((e) => (
                <li key={e.event_id}>
                  <b>{e.label}</b>{(e.date || e.place) && <> ({[e.date, e.place].filter(Boolean).join(', ')})</>}
                  {e.participants.length > 0 && <> — {e.participants.map((p, i) => (
                    <Fragment key={i}>{i > 0 && ' ; '}{p.role_label} : {p.name}{participantDetails(p)}</Fragment>
                  ))}</>}
                  {e.officer && <span className="italic">. {e.officer}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <H2>Documents ({docs.length})</H2>
        {docs.length === 0 ? <p className="italic text-[#85785f]">Aucun document ni source n’est encore rattaché à cette personne.</p> : (
          <ul className="book-list">
            {docs.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                {d.kind === 'media'
                  ? <><span className="text-[#85785f]">{d.is_image ? 'Image' : 'Document'} — </span><a className="book-link" href={`${API_BASE}${d.url}`} target="_blank" rel="noreferrer">{d.title}</a></>
                  : <><span className="text-[#85785f]">Source — </span>{d.url ? <a className="book-link" href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}{d.reference && <span className="text-[#85785f]"> · {d.reference}</span>}</>}
              </li>
            ))}
          </ul>
        )}
        <H2>Recherches en cours</H2>
        {ch.research.length === 0 ? <p className="italic text-[#85785f]">Rien d’ouvert pour cette personne.</p> : (
          <ul className="book-list">{ch.research.map((r) => <ResearchLine key={`${r.kind}-${r.id}`} r={r} />)}</ul>
        )}
        <div className="book-noprint mt-4 flex flex-wrap gap-2 font-sans">
          <Link to={`/documents/importer?personne=${ch.person_id}`} className="btn-ghost !text-[13px]"><FileUp size={14} />Importer un acte</Link>
          <Link to={`/personnes/${ch.person_id}`} className="btn-ghost !text-[13px]"><FileText size={14} />Ouvrir la fiche</Link>
          <Link to="/" className="btn-ghost !text-[13px]"><Search size={14} />Centre de recherche</Link>
        </div>
      </BookPage>

      {/* ---------------- Pages suivantes : transcriptions ---------------- */}
      {actsWithText.map((a) => (
        <BookPage key={`tr-${a.event_id ?? a.media_id}`} left="Acte" right={shortName} folio={nextFolio()}>
          <H2>{a.image_url ? a.title : `Transcription ${a.event_type ? ACT_TR[a.event_type] ?? 'de l’acte' : 'du document'}`}</H2>
          {a.image_url && <ActFigure a={a} large />}
          {a.image_url && <h3 className="book-h2 !mt-5 !text-[16px]">Transcription {a.event_type ? ACT_TR[a.event_type] ?? 'de l’acte' : 'du document'}</h3>}
          <p className="book-small m-0 mb-2">{[a.act_number ? `N° ${a.act_number}` : null, a.date, a.place, a.officer, a.source ? `source : ${a.source.title}` : null].filter(Boolean).join(' · ')}</p>
          <div className="book-transcription">{a.transcription}</div>
        </BookPage>
      ))}
    </div>
  )
}

function participantDetails(p: { age: string | null; occupation: string | null; residence: string | null; relation: string | null }) {
  const bits = [p.age ? (/[a-z]/i.test(p.age) ? p.age : `${p.age} ans`) : null, p.occupation, p.residence ? `à ${p.residence}` : null, p.relation].filter(Boolean)
  return bits.length ? ` (${bits.join(', ')})` : ''
}

/** Les noms de famille en capitales ne sont jamais coupés en fin de ligne (« PER-RIN »). */
function noHyphenNames(text: string) {
  const parts = text.split(/(?<!\p{L})(\p{Lu}[\p{Lu}'’-]{2,})(?!\p{L})/u)
  return parts.map((t, i) => (i % 2 === 1 ? <span key={i} className="book-name">{t}</span> : t))
}

function Para({ b, first, refs, anchorPrefix }: { b: BookParagraph; first: boolean; refs: number[]; anchorPrefix: string }) {
  return (
    <p className={`${first ? 'is-first' : ''} ${b.kind === 'sosa' ? 'is-sosa' : ''}`}>
      {noHyphenNames(b.text)}
      {refs.map((n) => <sup key={n} className="book-ref"><a href={`#${anchorPrefix}note-${n}`} onClick={(e) => { e.preventDefault(); document.getElementById(`${anchorPrefix}note-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>{n}</a></sup>)}
    </p>
  )
}

function ActFigure({ a, large = false }: { a: BookAct; large?: boolean }) {
  return (
    <figure className="book-figure">
      <a href={`${API_BASE}${a.file_url ?? a.image_url}`} target="_blank" rel="noreferrer">
        <img src={`${API_BASE}${a.image_url}`} alt={a.title} loading="lazy" style={large ? { maxHeight: 760 } : undefined} />
      </a>
      <figcaption>{a.title}{a.date ? `, ${a.date}` : ''}{a.place ? `, ${a.place}` : ''}{a.act_number ? ` — n° ${a.act_number}` : ''}</figcaption>
    </figure>
  )
}

const R_ICON: Record<ResearchItem['kind'], ReactNode> = {
  task: <Search size={13} />, question: <CircleHelp size={13} />, hypothesis: <FileSearch size={13} />, contradiction: <TriangleAlert size={13} />, missing: <Landmark size={13} />,
}
const R_LABEL: Record<ResearchItem['kind'], string> = { task: 'Enquête', question: 'Question', hypothesis: 'Hypothèse', contradiction: 'Contradiction', missing: 'À trouver' }

function ResearchLine({ r }: { r: ResearchItem }) {
  return (
    <li>
      <span className="mr-1 inline-flex translate-y-[2px] text-[#876a2e]">{R_ICON[r.kind] ?? <ImageIcon size={13} />}</span>
      <span className="text-[#85785f]">{R_LABEL[r.kind]} — </span>
      <Link to={r.link} className="book-link">{r.title}</Link>
    </li>
  )
}
