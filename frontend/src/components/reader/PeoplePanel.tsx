import { Link } from 'react-router-dom'
import { Briefcase, Cake, Home, MapPinned, PenLine, ShieldCheck, UsersRound } from 'lucide-react'
import { RELATION_LABEL, ROLE_LABEL, SIDE_LABEL, type BBox, type Mention } from '../../lib/paleoApi'
import { Spinner } from '../ui'

const ROLE_TINT: Record<string, string> = { subject: '#5b3fd6', groom: '#5b3fd6', bride: '#b8456b', deceased: '#52607d', father: '#2c4f86', mother: '#2c4f86', godfather: '#426645', godmother: '#426645', witness: '#6b665c', declarant: '#6b665c' }

function relationText(m: Mention): string | null {
  if (!m.relation_kind) return null
  const parts = [RELATION_LABEL[m.relation_kind] ?? m.relation_kind]
  if (m.relation_side && m.relation_side !== 'unknown') parts.push(SIDE_LABEL[m.relation_side])
  if (m.relation_to_role) parts.push(`de : ${ROLE_LABEL[m.relation_to_role] ?? m.relation_to_role}`)
  return parts.join(' · ')
}

export function PeoplePanel({ mentions, loaded, busy, onExtract, onShow }: {
  mentions: Mention[]; loaded: boolean; busy: boolean; onExtract: () => void; onShow: (bbox: BBox, line: number) => void
}) {
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-[18px] text-night-900"><UsersRound size={18} className="text-gold-600" />Personnes citées</h2>
        <button type="button" className="btn-gold !py-1.5 text-[13.5px]" disabled={busy} onClick={onExtract}>{busy ? <Spinner /> : <UsersRound size={15} />}{mentions.length ? 'Extraire à nouveau' : 'Extraire les personnes'}</button>
      </div>
      <p className="mt-2 flex items-start gap-2 rounded-xl bg-ivory-100 px-3 py-2 text-[12.5px] text-night-800"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-sage-500" />Personne n’est ajoutée ni reliée à votre arbre automatiquement. Un nom identique ne prouve pas qu’il s’agit de la même personne.</p>
      {!loaded ? null : mentions.length === 0 ? <p className="mt-3 text-[13.5px] text-mist-500">Aucune personne extraite pour l’instant.</p> : (
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
          {mentions.map((m) => {
            const rel = relationText(m)
            const low = (m.reading_confidence ?? 1) < 0.5
            return (
              <li key={m.id} className="rounded-2xl border border-ivory-200 bg-white p-3 shadow-[0_1px_2px_rgba(28,35,51,0.05)]">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white" style={{ background: ROLE_TINT[m.role] ?? '#6b665c' }}>{ROLE_LABEL[m.role] ?? m.role}</span>
                  {low ? <span className="chip conf-red">nom difficile à lire</span> : <span className="chip conf-grey">lisibilité {Math.round((m.reading_confidence ?? 0) * 100)} %</span>}
                </div>
                <div className="mt-1.5 font-display text-[16.5px] text-night-900">{m.name_original}</div>
                {(m.given_names || m.surname) && <div className="text-[12.5px] text-mist-500">forme normalisée : {[m.given_names, m.surname?.toUpperCase()].filter(Boolean).join(' ')}</div>}
                {m.stated_relation && <div className="mt-1 text-[13.5px] text-night-800">« {m.stated_relation} »</div>}
                {rel && <div className="text-[12.5px] text-ios-blue">{rel}</div>}
                <ul className="mt-1.5 space-y-0.5 text-[13px] text-night-800">
                  {m.age_stated && <li className="flex gap-1.5"><Cake size={13} className="mt-0.5 text-mist-400" />âge indiqué : {m.age_stated}</li>}
                  {m.occupation && <li className="flex gap-1.5"><Briefcase size={13} className="mt-0.5 text-mist-400" />{m.occupation}</li>}
                  {m.residence && <li className="flex gap-1.5"><Home size={13} className="mt-0.5 text-mist-400" />{m.residence}</li>}
                  {m.signed != null && <li className="flex gap-1.5"><PenLine size={13} className="mt-0.5 text-mist-400" />{m.signed ? 'a signé' : 'n’a pas signé'}</li>}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.image_region?.bbox && <button type="button" className="btn-ghost !px-2 !py-1 text-[12px]" onClick={() => onShow(m.image_region!.bbox as BBox, m.image_region!.line_n)}><MapPinned size={13} />Voir sur l’image</button>}
                </div>
                {m.candidates.length > 0 && (
                  <div className="mt-2 rounded-xl bg-ivory-100 p-2 text-[12.5px]">
                    <div className="font-medium text-night-900">Peut-être dans votre arbre (à vérifier) :</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {m.candidates.map((c) => (
                        <li key={c.person_id}><Link className="text-ios-blue underline" to={`/personnes/${c.person_id}`}>voir la fiche</Link> · ressemblance {Math.round(c.score)} / 100{c.reasons.length ? ` — ${c.reasons.slice(0, 2).join(' ; ')}` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
