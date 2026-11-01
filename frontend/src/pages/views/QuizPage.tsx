import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Flame, HelpCircle, RotateCcw, Trophy, X } from 'lucide-react'
import { api, type PersonDetail, type PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { COLORS, Card, EmptyState, ErrorState, LoadingState, PersonAvatar, Segmented, shortPlace, useLoader } from '../../components/views/common'

const C = COLORS.vues
const BEST_KEY = 'genealis.quiz.best'

interface Question { key: string; text: string; subject: PersonSummary; choices: string[]; answer: string; explain: string }
type Gen = (ctx: Ctx) => Promise<Question | null>
interface Ctx { persons: PersonSummary[]; detail: (id: string) => Promise<PersonDetail | null>; used: Set<string> }

const rnd = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const shuffle = <T,>(a: T[]): T[] => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }
const ne = (p: PersonSummary) => (p.sex === 'F' ? 'née' : p.sex === 'M' ? 'né' : 'né(e)')
const label = (p: PersonSummary) => (p.birth_year ? `${p.display_name} (${p.birth_year})` : p.display_name)

/** Choisit 3 leurres numériques plausibles autour de la bonne réponse, en privilégiant des valeurs réelles. */
function numberChoices(answer: number, real: number[], spread: number, min = 0): string[] {
  const pool = shuffle([...new Set(real.filter((v) => v !== answer && Math.abs(v - answer) <= spread * 2))])
  const out = new Set<number>(pool.slice(0, 2))
  const offsets = shuffle([1, 2, 3, 4, 5, 6, 8, 10, 12, 15].flatMap((o) => [o, -o]).filter((o) => Math.abs(o) <= spread))
  for (const o of offsets) { if (out.size >= 3) break; const v = answer + o; if (v >= min && v !== answer) out.add(v) }
  return shuffle([answer, ...[...out].slice(0, 3)]).map(String)
}
function textChoices(answer: string, others: string[]): string[] | null {
  const pool = shuffle([...new Set(others.filter((o) => o && o !== answer))])
  if (pool.length < 3) return null
  return shuffle([answer, ...pool.slice(0, 3)])
}
function personChoices(answer: PersonSummary, subject: PersonSummary, persons: PersonSummary[], sex: 'M' | 'F' | null): string[] | null {
  const ans = label(answer)
  const cands = persons.filter((p) => p.id !== answer.id && p.id !== subject.id && (!sex || p.sex === sex) && label(p) !== ans)
  const near = cands.filter((p) => answer.birth_year && p.birth_year && Math.abs(p.birth_year - answer.birth_year) <= 30)
  const picked = shuffle(near.length >= 3 ? near : cands).slice(0, 3).map(label)
  if (new Set(picked).size < 3) return null
  return shuffle([ans, ...picked])
}

const GENERATORS: { id: string; weight: number; gen: Gen }[] = [
  { id: 'birthYear', weight: 3, gen: async ({ persons, used }) => {
    const c = persons.filter((p) => p.birth_year && !used.has(`birthYear:${p.id}`))
    if (!c.length) return null
    const p = rnd(c), y = p.birth_year as number
    return { key: `birthYear:${p.id}`, subject: p, text: `En quelle année est ${ne(p)} ${p.display_name} ?`, answer: String(y), choices: numberChoices(y, persons.map((x) => x.birth_year ?? 0), 25, 1000), explain: `${p.display_name} est ${ne(p)} ${p.birth_display && p.birth_display !== String(y) ? `le ${p.birth_display}` : `en ${y}`}${p.birth_place ? ` à ${shortPlace(p.birth_place)}` : ''}.` }
  } },
  { id: 'deathYear', weight: 2, gen: async ({ persons, used }) => {
    const c = persons.filter((p) => p.death_year && !used.has(`deathYear:${p.id}`))
    if (!c.length) return null
    const p = rnd(c), y = p.death_year as number
    return { key: `deathYear:${p.id}`, subject: p, text: `En quelle année est ${p.sex === 'F' ? 'décédée' : p.sex === 'M' ? 'décédé' : 'décédé(e)'} ${p.display_name} ?`, answer: String(y), choices: numberChoices(y, persons.map((x) => x.death_year ?? 0), 25, 1000), explain: `${p.display_name} est mort${p.sex === 'F' ? 'e' : ''} en ${y}${p.death_place ? ` à ${shortPlace(p.death_place)}` : ''}.` }
  } },
  { id: 'birthPlace', weight: 3, gen: async ({ persons, used }) => {
    const c = persons.filter((p) => p.birth_place && !used.has(`birthPlace:${p.id}`))
    if (!c.length) return null
    const p = rnd(c), ans = shortPlace(p.birth_place)
    const choices = textChoices(ans, persons.flatMap((x) => [shortPlace(x.birth_place), shortPlace(x.death_place)]))
    if (!choices) return null
    return { key: `birthPlace:${p.id}`, subject: p, text: `Où est ${ne(p)} ${p.display_name} ?`, answer: ans, choices, explain: `${p.display_name} est ${ne(p)} à ${p.birth_place}${p.birth_year ? ` en ${p.birth_year}` : ''}.` }
  } },
  { id: 'ageAtDeath', weight: 2, gen: async ({ persons, used }) => {
    const c = persons.filter((p) => p.age_context === 'au décès' && typeof p.age_years === 'number' && !used.has(`age:${p.id}`))
    if (!c.length) return null
    const p = rnd(c), a = p.age_years as number
    return { key: `age:${p.id}`, subject: p, text: `Quel âge avait ${p.display_name} à son décès ?`, answer: `${a} ans`, choices: numberChoices(a, persons.filter((x) => x.age_context === 'au décès').map((x) => x.age_years ?? -1), 12).map((v) => `${v} ans`), explain: `${p.display_name} est mort${p.sex === 'F' ? 'e' : ''} à ${p.age_detail ?? p.age_display ?? `${a} ans`}.` }
  } },
  { id: 'occupation', weight: 1, gen: async ({ persons, used }) => {
    const c = persons.filter((p) => p.occupation && !used.has(`occ:${p.id}`))
    if (!c.length) return null
    const p = rnd(c), ans = p.occupation as string
    const choices = textChoices(ans, persons.map((x) => x.occupation ?? ''))
    if (!choices) return null
    return { key: `occ:${p.id}`, subject: p, text: `Quel était le métier de ${p.display_name} ?`, answer: ans, choices, explain: `${p.display_name} était ${ans}.` }
  } },
  { id: 'parent', weight: 4, gen: async ({ persons, detail, used }) => {
    const p = rnd(persons)
    const d = await detail(p.id)
    if (!d) return null
    const bio = d.parents.filter((x) => { const r = d.parent_relations.find((rel) => rel.parent_id === x.id); return !r || r.relation_type !== 'step' })
    const parent = rnd(bio.filter((x) => x.sex === 'M' || x.sex === 'F'))
    if (!parent) return null
    const role = parent.sex === 'M' ? 'père' : 'mère'
    const key = `${role}:${p.id}`
    if (used.has(key)) return null
    const choices = personChoices(parent, p, persons, parent.sex)
    if (!choices) return null
    return { key, subject: p, text: `Qui est ${parent.sex === 'M' ? 'le père' : 'la mère'} de ${p.display_name} ?`, answer: label(parent), choices, explain: `${parent.display_name} est ${parent.sex === 'M' ? 'le père' : 'la mère'} de ${p.display_name}.` }
  } },
  { id: 'children', weight: 2, gen: async ({ persons, detail, used }) => {
    const p = rnd(persons)
    if (used.has(`children:${p.id}`)) return null
    const d = await detail(p.id)
    if (!d || d.children.length < 1) return null
    const n = d.children.length
    const opts = shuffle([n + 1, n + 2, n - 1, n + 3, n - 2, n + 4].filter((v) => v >= 0 && v !== n)).slice(0, 3)
    return { key: `children:${p.id}`, subject: p, text: `Combien d’enfants de ${p.display_name} sont connus dans l’arbre ?`, answer: String(n), choices: shuffle([n, ...opts]).map(String), explain: `${p.display_name} a ${n} enfant${n > 1 ? 's' : ''} dans l’arbre : ${d.children.map((c) => c.display_name).join(', ')}.` }
  } },
  { id: 'spouse', weight: 2, gen: async ({ persons, detail, used }) => {
    const p = rnd(persons)
    if (used.has(`spouse:${p.id}`)) return null
    const d = await detail(p.id)
    const sp = d?.spouses[0]
    if (!d || !sp) return null
    const choices = personChoices(sp, p, persons, sp.sex)
    if (!choices) return null
    return { key: `spouse:${p.id}`, subject: p, text: `Avec qui ${p.display_name} a-t-${p.sex === 'F' ? 'elle' : 'il'} fondé une famille ?`, answer: label(sp), choices, explain: `${p.display_name} et ${sp.display_name} forment un couple dans l’arbre.` }
  } },
]

function Confetti({ seed }: { seed: number }) {
  const pieces = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    i, dx: (Math.random() - 0.5) * 520, dy: -140 - Math.random() * 260, rot: Math.random() * 720 - 360,
    color: ['#2e9a52', '#f5c242', '#2f6fd1', '#e5765f', '#8a35b8', '#34c759'][i % 6], delay: Math.random() * 0.12, w: 6 + Math.random() * 6,
  })), [seed])
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-0 w-0">
      {pieces.map((p) => (
        <span key={p.i} className="quiz-confetti absolute block rounded-[2px]" style={{ width: p.w, height: p.w * 0.45, background: p.color, animationDelay: `${p.delay}s`, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--rot' as string]: `${p.rot}deg` }} />
      ))}
    </div>
  )
}

export default function QuizPage() {
  const { data: persons, loading, error, reload } = useLoader<PersonSummary[]>(() => api.persons(undefined, 2000), [])
  const [length, setLength] = useState(10)
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 } })
  const [q, setQ] = useState<Question | null>(null)
  const [nextQ, setNextQ] = useState<Promise<Question | null> | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [burst, setBurst] = useState(0)
  const [answered, setAnswered] = useState(0)
  const used = useRef(new Set<string>())
  const cache = useRef(new Map<string, PersonDetail | null>())

  const dated = (persons ?? []).filter((p) => p.birth_year || p.birth_place).length
  const enough = (persons?.length ?? 0) >= 4 && dated >= 4

  const generate = useCallback(async (): Promise<Question | null> => {
    if (!persons) return null
    const ctx: Ctx = {
      persons, used: used.current,
      detail: async (id) => {
        if (cache.current.has(id)) return cache.current.get(id) ?? null
        try { const d = await api.person(id); cache.current.set(id, d); return d } catch { cache.current.set(id, null); return null }
      },
    }
    const total = GENERATORS.reduce((s, g) => s + g.weight, 0)
    for (let attempt = 0; attempt < 40; attempt++) {
      let r = Math.random() * total
      const g = GENERATORS.find((x) => (r -= x.weight) < 0) ?? GENERATORS[0]
      const res = await g.gen(ctx)
      if (res) res.text = res.text.replace(/ \?$/, '\u00a0?')
      if (res && !used.current.has(res.key) && new Set(res.choices).size === res.choices.length && res.choices.includes(res.answer)) { used.current.add(res.key); return res }
    }
    return null
  }, [persons])

  const start = useCallback(async () => {
    used.current.clear()
    setIndex(0); setScore(0); setStreak(0); setAnswered(0); setPicked(null); setExhausted(false); setGenerating(true)
    const first = await generate()
    setQ(first); setGenerating(false)
    if (!first) setExhausted(true)
    else setNextQ(generate())
  }, [generate])
  useEffect(() => { if (persons && enough) start() }, [persons, enough, start])

  const answer = (choice: string) => {
    if (!q || picked) return
    setPicked(choice)
    setAnswered((a) => a + 1)
    if (choice === q.answer) {
      setScore((s) => s + 1)
      const n = streak + 1
      setStreak(n)
      if (n > best) { setBest(n); try { localStorage.setItem(BEST_KEY, String(n)) } catch { /* stockage indisponible */ } }
      setBurst((b) => b + 1)
    } else setStreak(0)
  }
  const next = async () => {
    if (index + 1 >= length) { setIndex(length); return }
    setGenerating(true); setPicked(null)
    const n = await (nextQ ?? generate())
    setGenerating(false)
    if (!n) { setExhausted(true); setIndex(length); return }
    setQ(n); setIndex((i) => i + 1)
    setNextQ(generate())
  }

  const finished = index >= length
  const help = (
    <div className="space-y-2">
      <p className="font-semibold" style={{ color: C }}>Quiz familial</p>
      <p>Toutes les questions sont tirées de votre arbre : dates, lieux, parents, enfants, métiers… Les mauvaises réponses proposées sont aussi des données réelles (autres personnes, autres lieux) ou des années proches.</p>
      <p>Enchaînez les bonnes réponses pour faire grimper votre série !</p>
    </div>
  )
  const options = (
    <div><span className="label">Nombre de questions</span><Segmented value={String(length)} onChange={(v) => { setLength(Number(v)); start() }} color={C} options={[5, 10, 20].map((n) => ({ id: String(n), label: n }))} /></div>
  )

  return (
    <ChartFrame title="Quiz familial" color={C} help={help} options={options} actions={<button className="btn-ghost" onClick={start}><RotateCcw size={15} /> Nouvelle partie</button>}>
      <style>{`
        @keyframes quiz-confetti { 0% { transform: translate(0,0) rotate(0); opacity: 1 } 100% { transform: translate(var(--dx), calc(var(--dy) + 420px)) rotate(var(--rot)); opacity: 0 } }
        .quiz-confetti { animation: quiz-confetti 1.3s cubic-bezier(.2,.6,.4,1) forwards; }
        @keyframes quiz-shake { 0%,100% { transform: translateX(0) } 20%,60% { transform: translateX(-7px) } 40%,80% { transform: translateX(7px) } }
        .quiz-shake { animation: quiz-shake .4s ease; }
        @keyframes quiz-pop { 0% { transform: scale(.96); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
        .quiz-pop { animation: quiz-pop .3s ease-out both; }
      `}</style>
      {loading && <LoadingState label="Préparation du quiz…" color={C} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {persons && !enough && (
        <EmptyState icon={<HelpCircle size={30} />} color={C} title="Pas encore assez de données pour un quiz">
          Le quiz n’invente rien : il lui faut au moins <b>4 personnes</b> avec une date ou un lieu de naissance. Votre arbre en compte actuellement <b>{dated}</b> sur {persons.length} personne{persons.length > 1 ? 's' : ''}.
          <div className="mt-3"><Link to="/demarrer" className="font-semibold" style={{ color: C }}>Compléter mon arbre →</Link></div>
        </EmptyState>
      )}
      {persons && enough && (
        <div className="mx-auto max-w-xl space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: 'Score', v: `${score}`, icon: <Check size={14} /> },
              { k: 'Série', v: `${streak}`, icon: <Flame size={14} className={streak >= 3 ? 'text-orange-500' : ''} /> },
              { k: 'Record', v: `${best}`, icon: <Trophy size={14} /> },
            ].map((s) => (
              <Card key={s.k} className="px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wide text-mist-500">{s.icon}{s.k}</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: C }}>{s.v}</div>
              </Card>
            ))}
          </div>

          {!finished && (
            <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${((index + (picked ? 1 : 0)) / length) * 100}%`, background: C }} /></div>
          )}

          {!finished && generating && !q && <LoadingState label="Recherche d’une question…" color={C} />}
          {!finished && q && (
            <Card key={q.key} className={`quiz-pop relative overflow-visible p-5 ${picked && picked !== q.answer ? 'quiz-shake' : ''}`}>
              {picked === q.answer && <Confetti seed={burst} />}
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: C }}>Question {index + 1} sur {length}</p>
              <div className="mb-4 flex items-center gap-3">
                <PersonAvatar p={q.subject} size={52} ring />
                <h2 className="text-[19px] font-bold leading-snug text-night-900">{q.text}</h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.choices.map((c) => {
                  const isAns = c === q.answer, isPicked = c === picked
                  const state = !picked ? 'idle' : isAns ? 'good' : isPicked ? 'bad' : 'dim'
                  return (
                    <button key={c} disabled={!!picked} onClick={() => answer(c)}
                      className={`flex min-h-[52px] items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left text-[15px] font-medium transition-all ${state === 'idle' ? 'bg-[#f2f4f7] text-night-900 hover:bg-[#e8f5ec] active:scale-[0.98]' : state === 'good' ? 'bg-[#34c759] text-white shadow-lg' : state === 'bad' ? 'bg-[#ff3b30] text-white' : 'bg-[#f2f4f7] text-mist-400'}`}>
                      <span>{c}</span>
                      {state === 'good' && <Check size={18} />}{state === 'bad' && <X size={18} />}
                    </button>
                  )
                })}
              </div>
              {picked && (
                <div className="mt-4 rounded-2xl bg-black/[0.03] p-3 text-sm">
                  <p className="font-semibold" style={{ color: picked === q.answer ? '#1f8a3e' : '#c4302b' }}>{picked === q.answer ? (streak >= 3 ? `Bravo ! ${streak} bonnes réponses d’affilée 🔥` : 'Bonne réponse !') : 'Raté…'}</p>
                  <p className="mt-0.5 text-night-900">{q.explain}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link to={`/personnes/${q.subject.id}`} className="text-sm font-medium" style={{ color: C }}>Voir la fiche</Link>
                    <button onClick={next} disabled={generating} className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60" style={{ background: C }}>
                      {index + 1 >= length ? 'Voir le résultat' : generating ? 'Un instant…' : 'Question suivante'}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {(finished || (exhausted && !q)) && (
            <Card className="quiz-pop relative p-6 text-center">
              {score >= Math.ceil(length * 0.7) && <Confetti seed={-1} />}
              <Trophy size={40} className="mx-auto mb-2" style={{ color: score >= length * 0.7 ? '#f5b400' : C }} />
              <h2 className="text-2xl font-bold text-night-900">{score} / {answered}</h2>
              <p className="mt-1 text-sm text-mist-500">
                {exhausted ? 'Toutes les questions possibles avec vos données ont été posées. ' : ''}
                {score === answered && score > 0 ? 'Sans faute ! Vous connaissez votre famille sur le bout des doigts.' : score >= length * 0.7 ? 'Excellent score !' : score >= length * 0.4 ? 'Pas mal ! Encore une partie ?' : 'L’occasion de redécouvrir votre famille.'}
              </p>
              <p className="mt-2 text-xs text-mist-500">Meilleure série : {best}</p>
              <button onClick={start} className="mx-auto mt-4 flex items-center gap-2 rounded-2xl px-5 py-2.5 font-semibold text-white shadow-lg" style={{ background: C }}><RotateCcw size={16} /> Rejouer</button>
            </Card>
          )}
        </div>
      )}
    </ChartFrame>
  )
}
