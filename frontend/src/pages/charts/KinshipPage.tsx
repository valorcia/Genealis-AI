import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Search, X } from 'lucide-react'
import { api, ApiError, type Kinship, type PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { Avatar } from '../../components/charts/Avatar'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { PersonCard, DEFAULT_CARD_OPTIONS } from '../../components/charts/PersonCard'
import { firstName, fullName, GRAPH_COLOR, norm, withArticle } from '../../components/charts/format'
import { Spinner } from '../../components/ui'

function sentence(k: Kinship, a: PersonSummary, b: PersonSummary) {
  const A = firstName(a), B = firstName(b)
  if (!k.found) return `Aucun lien de parenté n’a été trouvé entre ${A} et ${B} dans l’arbre.`
  if (k.relation === 'même personne') return `${A} et ${B} sont la même personne.`
  const m = k.relation.match(/^(.*) de votre conjoint\(e\) (.+) \(par alliance\)$/)
  if (m) return `${B} est ${withArticle(m[1], b.sex)} de ${m[2]}, conjoint(e) de ${A} (lien par alliance).`
  if (k.by_marriage) return `${B} est ${withArticle(k.relation.split(' / ')[0], b.sex)} de ${A}.`
  return `${B} est ${withArticle(k.relation, b.sex)} de ${A}.`
}

function PersonSearch({ persons, value, onChange, exclude }: { persons: PersonSummary[]; value: PersonSummary | null; onChange: (p: PersonSummary | null) => void; exclude?: string | null }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const list = useMemo(() => { const n = norm(q.trim()); return persons.filter((p) => p.id !== exclude && (!n || norm(`${p.display_name} ${p.married_name ?? ''} ${p.birth_year ?? ''}`).includes(n))).slice(0, 40) }, [persons, q, exclude])
  if (value && !open) {
    return (
      <button onClick={() => { setOpen(true); setQ('') }} className="flex w-full items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-black/10 hover:ring-[#13918c]/50">
        <Avatar person={value} size={36} />
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-night-900">{fullName(value)}</span><span className="block text-xs text-mist-500">{value.birth_year ?? '?'}–{value.death_year ?? ''} · toucher pour changer</span></span>
        <span role="button" onClick={(e) => { e.stopPropagation(); onChange(null) }} className="rounded-full bg-black/5 p-1 text-mist-500"><X size={14} /></span>
      </button>
    )
  }
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-3 text-mist-400" />
      <input autoFocus={open} className="input !rounded-2xl !py-2.5 pl-9" placeholder="Rechercher la seconde personne…" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} />
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-2xl bg-white shadow-xl ring-1 ring-black/10">
          {list.map((p) => (
            <button key={p.id} onClick={() => { onChange(p); setOpen(false); setQ('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#13918c]/5">
              <Avatar person={p} size={26} /><span className="flex-1 truncate">{p.display_name}</span><span className="text-xs text-mist-500">{p.birth_year ?? '?'}–{p.death_year ?? ''}</span>
            </button>
          ))}
          {list.length === 0 && <p className="px-3 py-3 text-sm text-mist-500">Aucune personne trouvée.</p>}
          {value && <button className="w-full border-t border-black/5 px-3 py-2 text-left text-xs text-mist-500" onClick={() => setOpen(false)}>Annuler</button>}
        </div>
      )}
    </div>
  )
}

const opts = { ...DEFAULT_CARD_OPTIONS, showPlaces: false }

function Chain({ people, label }: { people: PersonSummary[]; label: string }) {
  return (
    <div className="flex flex-col items-center">
      {people.map((p, i) => (
        <div key={p.id + i} className="flex flex-col items-center">
          <div className="h-7 w-0.5 bg-[#13918c]/45" />
          <div className="relative">
            <span className="absolute -left-2 top-1/2 z-10 flex h-5 w-5 -translate-x-full -translate-y-1/2 items-center justify-center rounded-full bg-[#13918c]/10 text-[10px] font-semibold text-[#13918c]" title="Générations depuis l’ancêtre commun">{i + 1}</span>
            <PersonCard person={p} variant="compact" opts={opts} root={i === people.length - 1} />
          </div>
        </div>
      ))}
      <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-mist-500">{label}</div>
    </div>
  )
}

export default function KinshipPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [pref, setPref] = usePref('liens', { other: '' as string, cards: true })
  const other = persons.find((p) => p.id === pref.other) ?? null
  const [k, setK] = useState<Kinship | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setK(null); setError(null)
    if (!focusId || !other) return
    let alive = true
    setLoading(true)
    api.kinship(focusId, other.id).then((r) => { if (alive) setK(r) }).catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : 'Calcul impossible.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [focusId, other])

  const ga = k?.generations_a ?? 0
  const path = k?.path ?? []
  const ancestor = k?.found && k.generations_a != null && path.length > ga ? path[ga] : null
  const left = ancestor ? path.slice(0, ga).reverse() : []
  const right = ancestor ? path.slice(ga + 1) : []
  const swap = () => { if (focus && other) { setPref({ other: focus.id }); setFocusId(other.id) } }

  return (
    <ChartFrame title="Liens de parenté" color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId} fullBleed
      help={<HelpText title="Liens de parenté"><p>Choisissez deux personnes : GENEALIS calcule leur lien (grand-père, cousine germaine, oncle à la mode de Bretagne…), le degré civil et l’ancêtre commun le plus proche, puis dessine le chemin qui les relie.</p><p>La première personne est la personne centrale (bouton 👤) ; la seconde se choisit dans le champ de recherche.</p></HelpText>}
      actions={<ChartActions exportTarget={() => ref.current} filename={`Lien ${focus ? fullName(focus) : ''} ${other ? fullName(other) : ''}`} />}
      options={<OptionGroup title="Affichage"><ToggleRow label="Afficher le chemin de parenté" checked={pref.cards} onChange={(v) => setPref({ cards: v })} /></OptionGroup>}>
      <PrintStyle />
      {!pl && persons.length < 2 ? <ChartMessage>Il faut au moins deux personnes dans l’arbre pour calculer un lien de parenté.</ChartMessage> : (
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="grid items-center gap-2 rounded-3xl bg-white/80 p-3 shadow-sm ring-1 ring-black/5 sm:grid-cols-[1fr_auto_1fr]">
            <div>
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">Personne A</div>
              {focus ? <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-black/10"><Avatar person={focus} size={36} /><span className="min-w-0"><span className="block truncate font-semibold text-night-900">{fullName(focus)}</span><span className="block text-xs text-mist-500">personne centrale (bouton 👤)</span></span></div> : <Spinner />}
            </div>
            <button onClick={swap} disabled={!other} className="mx-auto mt-4 rounded-full bg-[#13918c]/10 p-2.5 text-[#13918c] disabled:opacity-40" title="Inverser A et B" aria-label="Inverser A et B"><ArrowLeftRight size={18} /></button>
            <div>
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">Personne B</div>
              <PersonSearch persons={persons} value={other} onChange={(p) => setPref({ other: p?.id ?? '' })} exclude={focusId} />
            </div>
          </div>

          <div ref={ref} className="chart-print-area rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-black/5 sm:p-8">
            {!other && <p className="py-10 text-mist-500">Choisissez la personne B pour découvrir son lien avec {focus ? firstName(focus) : 'la personne A'}.</p>}
            {other && loading && <p className="flex items-center justify-center gap-2 py-10 text-mist-500"><Spinner /> Recherche de l’ancêtre commun…</p>}
            {error && <p className="py-6 text-conf-red">{error}</p>}
            {k && focus && other && !loading && (
              <>
                <p className="text-balance text-2xl font-semibold leading-snug text-night-900 sm:text-3xl">{sentence(k, focus, other)}</p>
                {k.found && k.relation !== 'même personne' && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
                    {k.civil_degree != null && <span className="rounded-full bg-[#13918c]/10 px-3 py-1 font-medium text-[#0f7470]">Degré civil : {k.civil_degree}</span>}
                    {k.generations_a != null && k.generations_b != null && <span className="rounded-full bg-black/5 px-3 py-1 text-night-900/75">{k.generations_a} génération{k.generations_a > 1 ? 's' : ''} côté {firstName(focus)} · {k.generations_b} côté {firstName(other)}</span>}
                    {k.half && <span className="rounded-full bg-[#ece6ff] px-3 py-1 text-[#5b3fd6]">Demi-lien (un seul parent commun)</span>}
                    {k.by_marriage && <span className="rounded-full bg-[#fbe9db] px-3 py-1 text-[#c4651a]">Par alliance</span>}
                  </div>
                )}
                {k.common_ancestors.length > 0 && left.length > 0 && right.length > 0 && <p className="mt-3 text-sm text-mist-500">Ancêtre{k.common_ancestors.length > 1 ? 's' : ''} commun{k.common_ancestors.length > 1 ? 's' : ''} le{k.common_ancestors.length > 1 ? 's' : ''} plus proche{k.common_ancestors.length > 1 ? 's' : ''} : <b className="text-night-900">{k.common_ancestors.map(fullName).join(' et ')}</b></p>}

                {pref.cards && ancestor && (
                  <div className="mt-8 flex flex-col items-center overflow-x-auto pb-2">
                    <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-mist-500">{left.length && right.length ? 'Ancêtre commun' : firstName(ancestor)}</div>
                    <PersonCard person={ancestor} variant="compact" opts={opts} root={left.length === 0 || right.length === 0} />
                    {(left.length > 0 || right.length > 0) && <div className="h-4 w-0.5 bg-[#13918c]/45" />}
                    {(left.length > 0 || right.length > 0) && (
                      <div className="flex justify-center gap-8 sm:gap-16">
                        {left.length > 0 && <div className="relative">{right.length > 0 && <div className="absolute -right-4 left-1/2 top-0 h-0.5 bg-[#13918c]/45 sm:-right-8" />}<Chain people={left} label={k.by_marriage ? 'Conjoint(e)' : firstName(focus)} /></div>}
                        {right.length > 0 && <div className="relative">{left.length > 0 && <div className="absolute -left-4 right-1/2 top-0 h-0.5 bg-[#13918c]/45 sm:-left-8" />}<Chain people={right} label={firstName(other)} /></div>}
                      </div>
                    )}
                  </div>
                )}
                {pref.cards && k.found && !ancestor && path.length > 1 && (
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    {path.map((p, i) => <div key={p.id + i} className="flex items-center gap-3">{i > 0 && <span className="text-xl text-[#13918c]">∞</span>}<PersonCard person={p} variant="compact" opts={opts} /></div>)}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </ChartFrame>
  )
}
