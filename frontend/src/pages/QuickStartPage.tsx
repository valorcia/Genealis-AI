import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Heart, Plus, Sparkles, Trash2, User, Users } from 'lucide-react'
import { api, type PersonIn } from '../api'
import { useApp, pulseEngine } from '../store'
import { Spinner } from '../components/ui'
import { AI, errMsg } from '../components/person/helpers'

type CoupleKind = 'paternal' | 'maternal' | 'other' | 'single'
interface PersonForm { given_names: string; surname: string; birth_date: string; birth_place: string; death_date: string; death_place: string; occupation: string; sex: 'M' | 'F' }
interface ChildForm { given_names: string; surname: string; birth_date: string; sex: '' | 'M' | 'F' }

const KINDS: { id: CoupleKind; title: string; hint: string; icon: ReactNode }[] = [
  { id: 'paternal', title: 'Grands-parents paternels', hint: 'Les parents de votre père', icon: <Users size={22} /> },
  { id: 'maternal', title: 'Grands-parents maternels', hint: 'Les parents de votre mère', icon: <Users size={22} /> },
  { id: 'other', title: 'Un autre couple d’ancêtres', hint: 'Vos parents, des arrière-grands-parents…', icon: <Heart size={22} /> },
  { id: 'single', title: 'Une seule personne', hint: 'Un ancêtre dont vous connaissez le nom', icon: <User size={22} /> },
]
const emptyPerson = (sex: 'M' | 'F'): PersonForm => ({ given_names: '', surname: '', birth_date: '', birth_place: '', death_date: '', death_place: '', occupation: '', sex })
const toIn = (f: PersonForm | ChildForm): PersonIn => {
  const o: PersonIn = {}
  for (const [k, v] of Object.entries(f)) if (typeof v === 'string' && v.trim()) (o as Record<string, string>)[k] = v.trim()
  return o
}
const named = (f: { given_names: string; surname: string }) => !!(f.given_names.trim() || f.surname.trim())
const fullName = (f: { given_names: string; surname: string }) => [f.given_names.trim(), f.surname.trim().toUpperCase()].filter(Boolean).join(' ')

export default function QuickStartPage() {
  const nav = useNavigate()
  const { notify, refreshDashboard, refreshSettings } = useApp()
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<CoupleKind>('paternal')
  const [people, setPeople] = useState<PersonForm[]>([emptyPerson('M'), emptyPerson('F')])
  const [marriage, setMarriage] = useState({ date: '', place: '' })
  const [children, setChildren] = useState<ChildForm[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const single = kind === 'single'
  const used = single ? people.slice(0, 1) : people
  const roleLabel = (i: number) => single ? 'La personne' : kind === 'other' ? (i === 0 ? 'Lui' : 'Elle') : (i === 0 ? 'Le grand-père' : 'La grand-mère')
  const setP = (i: number, k: keyof PersonForm, v: string) => setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const setC = (i: number, k: keyof ChildForm, v: string) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const canNext = used.some(named)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const res = await api.quickstart({
        people: used.filter(named).map(toIn), couple: !single && used.filter(named).length === 2,
        marriage_date: !single && marriage.date.trim() ? marriage.date.trim() : undefined, marriage_place: !single && marriage.place.trim() ? marriage.place.trim() : undefined,
        children: single ? [] : children.filter(named).map(toIn), research: true,
      })
      pulseEngine()
      await Promise.all([refreshSettings(), refreshDashboard()])
      notify('success', `C’est parti ! ${res.persons.length + res.children.length} fiche(s) créée(s), ${res.tasks.length} recherche(s) IA lancée(s).`)
      nav('/')
    } catch (e) { setError(errMsg(e, 'Impossible de démarrer. Réessayez.')) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div className="flex items-center gap-2">
        {step > 1 ? <button onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[15px] text-[#2f6fd1]"><ArrowLeft size={16} />Retour</button>
          : <Link to="/" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[15px] text-[#2f6fd1]"><ArrowLeft size={16} />Accueil</Link>}
        <div className="ml-auto flex items-center gap-1.5">{[1, 2, 3].map((n) => <span key={n} className={`h-2 rounded-full transition-all ${n === step ? 'w-6' : 'w-2'}`} style={{ background: n <= step ? AI.color : '#d6d3e6' }} />)}</div>
      </div>

      <div className="fade-up rounded-3xl p-5" style={{ background: `linear-gradient(135deg, ${AI.soft}, #f7f4ff)` }}>
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider" style={{ color: AI.color }}><Sparkles size={15} />Étape {step} sur 3</div>
        <h1 className="mt-1 text-2xl font-bold text-night-900">{step === 1 ? 'Démarrer par mes grands-parents' : step === 2 ? 'Ce que vous savez' : 'Tout est prêt'}</h1>
        <p className="mt-1 text-[15px] text-night-900/75">
          {step === 1 ? 'Pas besoin de vous inscrire vous-même : commencez par les ancêtres dont vous connaissez le nom.'
            : step === 2 ? 'Remplissez seulement ce que vous savez. Un nom suffit : l’IA cherchera le reste dans les archives.'
            : 'Vérifiez, puis lancez la recherche. L’IA ne vous dérangera que si elle a besoin de vous.'}
        </p>
      </div>

      {step === 1 && (
        <div className="fade-up space-y-2.5">
          {KINDS.map((k) => (
            <button key={k.id} onClick={() => { setKind(k.id); setStep(2) }}
              className={`flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left shadow-sm ring-1 transition hover:ring-[#5b3fd6]/50 ${kind === k.id ? 'ring-[#5b3fd6]/50' : 'ring-black/5'}`}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: AI.soft, color: AI.color }}>{k.icon}</span>
              <span className="min-w-0 flex-1"><span className="block text-[17px] font-semibold text-night-900">{k.title}</span><span className="block text-sm text-mist-500">{k.hint}</span></span>
              <span className="text-2xl text-mist-300">›</span>
            </button>
          ))}
          <p className="px-2 pt-2 text-center text-sm text-mist-500">Vous préférez commencer par vous ? <Link to="/bienvenue" className="font-medium text-[#2f6fd1]">Commencer par moi</Link></p>
        </div>
      )}

      {step === 2 && (
        <div className="fade-up space-y-4">
          <div className={`grid gap-4 ${single ? '' : 'md:grid-cols-2'}`}>
            {used.map((f, i) => (
              <div key={i} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-[17px] font-semibold text-night-900">{roleLabel(i)}</h2>
                  <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-black/5 p-0.5 text-[13px]">
                    {(['M', 'F'] as const).map((s) => <button key={s} onClick={() => setP(i, 'sex', s)} className={`rounded-lg px-2.5 py-1 ${f.sex === s ? 'bg-white font-medium shadow-sm' : 'text-mist-500'}`}>{s === 'M' ? 'Homme' : 'Femme'}</button>)}
                  </div>
                </div>
                <div className="space-y-3">
                  <Inp label="Prénom(s)" value={f.given_names} onChange={(v) => setP(i, 'given_names', v)} autoFocus={i === 0} />
                  <Inp label="Nom de naissance" value={f.surname} onChange={(v) => setP(i, 'surname', v)} hint={f.sex === 'F' ? 'Son nom de jeune fille, si vous le connaissez' : undefined} />
                  <div className="grid grid-cols-2 gap-3">
                    <Inp label={f.sex === 'F' ? 'Née en' : 'Né en'} value={f.birth_date} onChange={(v) => setP(i, 'birth_date', v)} placeholder="1908, vers 1900…" />
                    <Inp label="Lieu de naissance" value={f.birth_place} onChange={(v) => setP(i, 'birth_place', v)} placeholder="Commune" />
                    <Inp label={f.sex === 'F' ? 'Décédée en' : 'Décédé en'} value={f.death_date} onChange={(v) => setP(i, 'death_date', v)} placeholder="1985…" />
                    <Inp label="Lieu de décès" value={f.death_place} onChange={(v) => setP(i, 'death_place', v)} />
                  </div>
                  <Inp label="Profession" value={f.occupation} onChange={(v) => setP(i, 'occupation', v)} placeholder="ex. cultivateur, couturière" />
                </div>
              </div>
            ))}
          </div>
          <p className="px-1 text-xs text-mist-500">Dates en saisie libre : « 1908 », « vers 1900 », « 12/03/1895 ». Tout est facultatif sauf au moins un nom.</p>

          {!single && (
            <>
              <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-night-900"><Heart size={17} className="text-[#e2574c]" />Mariage <span className="text-sm font-normal text-mist-500">(facultatif)</span></h2>
                <div className="grid grid-cols-2 gap-3">
                  <Inp label="Date" value={marriage.date} onChange={(v) => setMarriage((m) => ({ ...m, date: v }))} placeholder="vers 1930" />
                  <Inp label="Lieu" value={marriage.place} onChange={(v) => setMarriage((m) => ({ ...m, place: v }))} placeholder="Commune" />
                </div>
              </div>
              <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <h2 className="text-[17px] font-semibold text-night-900">Leurs enfants que vous connaissez <span className="text-sm font-normal text-mist-500">(facultatif)</span></h2>
                <p className="mb-3 text-sm text-mist-500">Par exemple votre père ou votre mère, vos oncles et tantes.</p>
                <div className="space-y-3">
                  {children.map((c, i) => (
                    <div key={i} className="rounded-2xl bg-[#f4f6fb] p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Inp label="Prénom" value={c.given_names} onChange={(v) => setC(i, 'given_names', v)} />
                        <Inp label="Nom" value={c.surname} onChange={(v) => setC(i, 'surname', v)} />
                        <Inp label="Né(e) en" value={c.birth_date} onChange={(v) => setC(i, 'birth_date', v)} placeholder="1935…" />
                        <label className="block"><span className="label">Sexe</span>
                          <select className="input" value={c.sex} onChange={(e) => setC(i, 'sex', e.target.value)}><option value="">?</option><option value="M">Fils</option><option value="F">Fille</option></select>
                        </label>
                      </div>
                      <button onClick={() => setChildren((cs) => cs.filter((_, j) => j !== i))} className="mt-2 inline-flex items-center gap-1 text-xs text-conf-red"><Trash2 size={12} />Retirer</button>
                    </div>
                  ))}
                  <button onClick={() => setChildren((cs) => [...cs, { given_names: '', surname: people[0].surname, birth_date: '', sex: '' }])} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#2f6fd1]/40 py-2.5 text-[15px] font-medium text-[#2f6fd1]"><Plus size={16} />Ajouter un enfant</button>
                </div>
              </div>
            </>
          )}
          {!canNext && <p className="text-center text-sm text-mist-500">Indiquez au moins un prénom ou un nom pour continuer.</p>}
          <button disabled={!canNext} onClick={() => setStep(3)} className="btn-gold w-full justify-center !py-3.5 text-base">Continuer</button>
        </div>
      )}

      {step === 3 && (
        <div className="fade-up space-y-4">
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
            {used.filter(named).map((f, i) => (
              <Recap key={i} title={fullName(f)} lines={[f.birth_date || f.birth_place ? `☆ ${[f.birth_date, f.birth_place].filter(Boolean).join(' à ')}` : '', f.death_date || f.death_place ? `† ${[f.death_date, f.death_place].filter(Boolean).join(' à ')}` : '', f.occupation]} sub={f.sex === 'F' ? 'Femme' : 'Homme'} />
            ))}
            {!single && (marriage.date || marriage.place) && <Recap title="Mariage" lines={[[marriage.date, marriage.place].filter(Boolean).join(' à ')]} />}
            {!single && children.filter(named).map((c, i) => <Recap key={`c${i}`} title={fullName(c)} sub="Enfant" lines={[c.birth_date ? `☆ ${c.birth_date}` : '']} />)}
          </div>
          <div className="rounded-3xl p-4 text-sm" style={{ background: AI.soft, color: AI.dark }}>
            <p className="font-semibold">Ce que fera l’IA</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>chercher les actes de naissance, mariage et décès dans les archives en ligne ;</li>
              <li>remonter vers leurs parents, sur 3 générations ;</li>
              <li>vous poser une question seulement en cas de doute.</li>
            </ul>
            <p className="mt-2 text-xs opacity-80">Rien n’est inventé : chaque information trouvée est liée à sa source.</p>
          </div>
          {error && <p className="rounded-2xl bg-conf-red/10 p-3 text-sm text-conf-red">{error}</p>}
          <button disabled={busy} onClick={submit} className="btn-gold w-full justify-center !py-4 text-[17px]">{busy ? <Spinner /> : <Sparkles size={19} />}Lancer la recherche IA</button>
          <button onClick={() => setStep(2)} className="w-full py-1 text-center text-[15px] text-[#2f6fd1]">Modifier</button>
        </div>
      )}
    </div>
  )
}

function Inp({ label, value, onChange, placeholder, hint, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; autoFocus?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input className="input" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-0.5 block text-xs text-mist-500">{hint}</span>}
    </label>
  )
}
function Recap({ title, sub, lines }: { title: string; sub?: string; lines: string[] }) {
  return (
    <div className="flex items-start gap-3 border-b border-black/5 px-4 py-3 last:border-0">
      <Check size={18} className="mt-0.5 shrink-0 text-sage-600" />
      <div className="min-w-0"><div className="font-semibold text-night-900">{title}{sub && <span className="ml-2 text-xs font-normal text-mist-500">{sub}</span>}</div>{lines.filter(Boolean).map((l, i) => <div key={i} className="text-sm text-mist-500">{l}</div>)}</div>
    </div>
  )
}
