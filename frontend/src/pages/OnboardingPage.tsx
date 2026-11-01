import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FileUp, Globe, Lock, Sparkles, UserRound, Users } from 'lucide-react'
import { api, ApiError, type PersonIn } from '../api'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import { AutonomyCards } from '../components/settings/AutonomyCards'

type PersonForm = { given_names: string; surname: string; married_name: string; birth_date: string; birth_place: string; death_date: string; death_place: string; occupation: string }
const emptyPerson = (): PersonForm => ({ given_names: '', surname: '', married_name: '', birth_date: '', birth_place: '', death_date: '', death_place: '', occupation: '' })
const hasIdentity = (p: PersonForm) => p.given_names.trim() !== '' || p.surname.trim() !== ''
const toPersonIn = (p: PersonForm, sex: 'M' | 'F'): PersonIn => {
  const out: PersonIn = { sex }
  const put = (k: keyof PersonIn, v: string) => { if (v.trim()) (out as Record<string, unknown>)[k] = v.trim() }
  put('given_names', p.given_names); put('surname', p.surname); put('married_name', p.married_name)
  put('birth_date', p.birth_date); put('birth_place', p.birth_place); put('death_date', p.death_date); put('death_place', p.death_place); put('occupation', p.occupation)
  return out
}

type GpKey = 'ff' | 'fm' | 'mf' | 'mm'
const GRANDPARENTS: { key: GpKey; side: 'father' | 'mother'; role: 'father' | 'mother'; label: string }[] = [
  { key: 'ff', side: 'father', role: 'father', label: 'Père de mon père' },
  { key: 'fm', side: 'father', role: 'mother', label: 'Mère de mon père' },
  { key: 'mf', side: 'mother', role: 'father', label: 'Père de ma mère' },
  { key: 'mm', side: 'mother', role: 'mother', label: 'Mère de ma mère' },
]
const COUNTRIES = ['France', 'Italie', 'Pologne', 'Allemagne', 'Belgique', 'Luxembourg', 'Suisse', 'Autriche', 'Tchéquie', 'Slovaquie', 'Hongrie', 'Espagne', 'Portugal', 'Royaume-Uni', 'États-Unis', 'Canada', 'Autre']
const STEPS = ['Bienvenue', 'Moi', 'Mes parents', 'Mes grands-parents', 'Origines et documents', "Mode d'autonomie"]

const inp = 'w-full rounded-xl border border-night-600 bg-night-800/70 px-3 py-2 text-sm text-ivory-50 placeholder:text-ivory-200/30 outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20'
const lbl = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ivory-200/60'
function F({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className={lbl}>{label}</span>{children}</label> }
function errMsg(e: unknown, fallback: string) { return e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback }

export default function OnboardingPage() {
  const nav = useNavigate()
  const { notify, refreshSettings } = useApp()
  const [step, setStep] = useState(0)
  const [me, setMe] = useState({ given_names: '', surname: '', sex: '', birth_date: '', birth_place: '' })
  const [father, setFather] = useState<PersonForm>(emptyPerson())
  const [mother, setMother] = useState<PersonForm>(emptyPerson())
  const [gps, setGps] = useState<Record<GpKey, PersonForm>>({ ff: emptyPerson(), fm: emptyPerson(), mf: emptyPerson(), mm: emptyPerson() })
  const [countries, setCountries] = useState<string[]>([])
  const [documentsNote, setDocumentsNote] = useState('')
  const [autonomy, setAutonomy] = useState(1)
  const [startResearch, setStartResearch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyDone, setAlreadyDone] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const gedcomRef = useRef<HTMLInputElement>(null)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const onGedcom = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try {
      const r = await api.importGedcom(file)
      await api.patchSettings({ onboarding_done: true })
      await refreshSettings()
      setImportResult(`${r.persons} personnes, ${r.families} familles, ${r.events} événements, ${r.sources} sources importés${r.warnings.length ? ` (${r.warnings.length} avertissement(s))` : ''}.`)
      notify('success', `Arbre importé : ${r.persons} personnes.`)
      nav('/arbre')
    } catch (e) { setError(errMsg(e, "L'import GEDCOM a échoué.")) } finally { setBusy(false) }
  }

  const submit = async () => {
    setBusy(true); setError(null)
    const payload: Record<string, unknown> = {
      given_names: me.given_names.trim() || null, surname: me.surname.trim() || null, sex: me.sex || null,
      birth_date: me.birth_date.trim() || null, birth_place: me.birth_place.trim() || null,
      origin_countries: countries, documents_note: documentsNote.trim() || null, autonomy_mode: autonomy, start_research: startResearch,
    }
    if (hasIdentity(father)) payload.father = toPersonIn(father, 'M')
    if (hasIdentity(mother)) payload.mother = toPersonIn(mother, 'F')
    payload.grandparents = GRANDPARENTS.filter((g) => hasIdentity(gps[g.key])).map((g) => ({ side: g.side, role: g.role, ...toPersonIn(gps[g.key], g.role === 'father' ? 'M' : 'F') }))
    try {
      const r = await api.onboarding(payload)
      await refreshSettings()
      notify('success', `Bienvenue. ${1 + r.parents.length + r.grandparents.length} fiche(s) créée(s)${r.tasks.length ? `, ${r.tasks.length} enquête(s) lancée(s)` : ''}.`)
      nav('/')
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && /déjà/i.test(e.message)) { setAlreadyDone(true); setError(e.message) }
      else setError(errMsg(e, "La configuration initiale a échoué."))
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-night-900 text-ivory-50" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, #203762 0%, #0f1e3a 55%, #070e1c 100%)' }}>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-display text-3xl tracking-wide">GENEALIS <span className="text-gold-500">AI</span></div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-ivory-200/60">Généalogiste numérique · configuration initiale</div>
          </div>
          <ol className="flex flex-wrap items-center gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step} className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${i === step ? 'bg-gold-500 text-night-950' : i < step ? 'bg-sage-500 text-ivory-50' : 'bg-night-800 text-ivory-200/50'}`} title={s}>{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</button>
                {i < STEPS.length - 1 && <span className={`h-px w-4 ${i < step ? 'bg-sage-500' : 'bg-night-600'}`} />}
              </li>
            ))}
          </ol>
        </header>

        <main className="fade-up my-8 flex-1" key={step}>
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-gold-400">Étape {step + 1} sur {STEPS.length}</div>
            <h1 className="font-display text-4xl">{STEPS[step]}</h1>
          </div>

          {step === 0 && (
            <div className="space-y-6">
              <p className="max-w-2xl text-base leading-relaxed text-ivory-200/80">
                Je suis votre généalogiste numérique. Je travaille uniquement dans votre espace privé, je conserve la source de chaque information, je n'invente jamais un ancêtre et je vous pose une question dès qu'une décision m'échappe. Commençons par ce que vous savez déjà — même partiellement.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <button type="button" onClick={next} className="group rounded-2xl border border-night-600 bg-night-800/60 p-6 text-left transition-colors hover:border-gold-500">
                  <UserRound className="text-gold-400" size={26} strokeWidth={1.5} />
                  <div className="font-display mt-3 text-2xl">Commencer avec mes informations</div>
                  <p className="mt-1 text-sm text-ivory-200/70">Vous, vos parents, vos grands-parents : quelques champs, tous facultatifs. Je m'occupe ensuite des recherches.</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm text-gold-400 group-hover:underline">Continuer <ArrowRight size={14} /></span>
                </button>
                <button type="button" onClick={() => gedcomRef.current?.click()} disabled={busy} className="group rounded-2xl border border-night-600 bg-night-800/60 p-6 text-left transition-colors hover:border-gold-500 disabled:opacity-60">
                  <FileUp className="text-gold-400" size={26} strokeWidth={1.5} />
                  <div className="font-display mt-3 text-2xl">Importer un arbre existant (GEDCOM)</div>
                  <p className="mt-1 text-sm text-ivory-200/70">Fichier .ged exporté d'un autre logiciel. Les personnes, familles, événements et sources sont repris ; rien n'est réinterprété sans vous.</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm text-gold-400 group-hover:underline">{busy ? <><Spinner /> Import en cours…</> : <>Choisir un fichier <ArrowRight size={14} /></>}</span>
                </button>
                <input ref={gedcomRef} type="file" accept=".ged,.gedcom,text/plain" className="hidden" onChange={onGedcom} />
              </div>
              {importResult && <div className="rounded-xl border border-sage-500/50 bg-sage-500/10 px-4 py-3 text-sm">{importResult}</div>}
              <PrivacyNote />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Hint />
              <div className="grid gap-4 md:grid-cols-2">
                <F label="Prénom(s)"><input className={inp} value={me.given_names} onChange={(e) => setMe({ ...me, given_names: e.target.value })} autoFocus /></F>
                <F label="Nom de naissance"><input className={inp} value={me.surname} onChange={(e) => setMe({ ...me, surname: e.target.value })} /></F>
                <F label="Sexe"><select className={inp} value={me.sex} onChange={(e) => setMe({ ...me, sex: e.target.value })}><option value="">Non précisé</option><option value="M">Masculin</option><option value="F">Féminin</option></select></F>
                <F label="Date de naissance"><input className={inp} value={me.birth_date} onChange={(e) => setMe({ ...me, birth_date: e.target.value })} placeholder="12/03/1975, mars 1975, vers 1975…" /></F>
                <F label="Lieu de naissance"><input className={inp} value={me.birth_place} onChange={(e) => setMe({ ...me, birth_place: e.target.value })} placeholder="Commune, département, pays" /></F>
              </div>
              <p className="text-xs text-ivory-200/50">Formats de date acceptés : jour/mois/année, mois année, année seule, « vers », « avant », « après », « entre … et … ».</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <Hint />
              <div className="grid gap-5 lg:grid-cols-2">
                <PersonCard title="Mon père" icon={<UserRound size={16} />} value={father} onChange={setFather} />
                <PersonCard title="Ma mère" icon={<UserRound size={16} />} value={mother} onChange={setMother} married />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <Hint />
              <div className="grid gap-5 lg:grid-cols-2">
                {GRANDPARENTS.map((g) => (
                  <PersonCard key={g.key} title={g.label} icon={<Users size={16} />} value={gps[g.key]} onChange={(v) => setGps({ ...gps, [g.key]: v })} married={g.role === 'mother'} />
                ))}
              </div>
              {!hasIdentity(father) && !hasIdentity(mother) && <p className="text-xs text-conf-orange">Sans père ni mère renseigné à l'étape précédente, les grands-parents ne pourront pas être rattachés à l'arbre.</p>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <div className={lbl}><Globe size={12} className="mr-1 inline" /> Pays d'origine connus ou supposés de la famille</div>
                <div className="flex flex-wrap gap-2">
                  {COUNTRIES.map((c) => { const on = countries.includes(c); return (
                    <button key={c} type="button" onClick={() => setCountries(on ? countries.filter((x) => x !== c) : [...countries, c])} className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-gold-500 bg-gold-500 text-night-950' : 'border-night-600 bg-night-800/60 text-ivory-200 hover:border-gold-400'}`}>{on && <Check size={12} className="mr-1 inline" strokeWidth={3} />}{c}</button>
                  ) })}
                </div>
                <p className="mt-2 text-xs text-ivory-200/50">Cela oriente le choix des archives à consulter en priorité ; rien n'est déduit sans acte.</p>
              </div>
              <F label="Documents dont vous disposez">
                <textarea className={`${inp} min-h-28`} value={documentsNote} onChange={(e) => setDocumentsNote(e.target.value)} placeholder="Livret de famille, photos, actes, lettres, carnets militaires…" />
              </F>
              <p className="text-xs text-ivory-200/50">Vous pourrez ensuite numériser et déposer ces documents dans « Archives et documents » : ils seront analysés et chaque information en conservera la trace.</p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <AutonomyCards value={autonomy} onChange={setAutonomy} dark />
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-night-600 bg-night-800/60 p-4">
                <input type="checkbox" className="mt-1" checked={startResearch} onChange={(e) => setStartResearch(e.target.checked)} />
                <span><span className="block text-sm font-medium">Démarrer les premières investigations autorisées</span><span className="block text-xs text-ivory-200/60">Le moteur planifie des enquêtes sur vos parents et grands-parents (actes d'état civil, recensements) selon le mode choisi. Vous pourrez tout suivre, suspendre ou refuser.</span></span>
              </label>
              <PrivacyNote />
              {error && (
                <div className="rounded-xl border border-conf-red/50 bg-conf-red/10 px-4 py-3 text-sm">
                  {error}
                  {alreadyDone && <div className="mt-2"><Link to="/" className="btn-gold">Ouvrir le tableau de bord</Link></div>}
                </div>
              )}
            </div>
          )}
          {error && step !== 5 && <div className="mt-4 rounded-xl border border-conf-red/50 bg-conf-red/10 px-4 py-3 text-sm">{error}</div>}
        </main>

        <footer className="flex items-center justify-between gap-3 border-t border-night-700 pt-5">
          <div className="text-xs text-ivory-200/50 inline-flex items-center gap-1.5"><Lock size={12} /> Tout reste sur cet ordinateur.</div>
          <div className="flex gap-2">
            {step > 0 && <button type="button" className="btn-ghost !border-night-600 !text-ivory-50 hover:!bg-night-800" onClick={back} disabled={busy}><ArrowLeft size={15} /> Retour</button>}
            {step > 0 && step < STEPS.length - 1 && <button type="button" className="btn-gold" onClick={next}>Suivant <ArrowRight size={15} /></button>}
            {step === STEPS.length - 1 && <button type="button" className="btn-gold" onClick={submit} disabled={busy || alreadyDone}>{busy ? <Spinner /> : <Sparkles size={15} />} Créer mon espace généalogique</button>}
          </div>
        </footer>
      </div>
    </div>
  )
}

function Hint() {
  return <p className="text-sm text-ivory-200/70">Tous les champs sont facultatifs. <strong className="text-ivory-50">« Je ne sais pas » = laisser le champ vide</strong> : je ne compléterai rien à votre place, et je vous poserai la question si une recherche l'exige.</p>
}

function PrivacyNote() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-night-600 bg-night-800/40 px-4 py-3 text-xs text-ivory-200/70">
      <Lock size={16} className="mt-0.5 shrink-0 text-gold-400" />
      <span>Confidentialité : vos données sont enregistrées localement, chiffrées pour les secrets, jamais publiées. Aucun fournisseur d'IA externe n'est sollicité sans votre autorisation explicite dans les paramètres ; les personnes vivantes sont protégées par défaut.</span>
    </div>
  )
}

function PersonCard({ title, icon, value, onChange, married = false }: { title: string; icon: ReactNode; value: PersonForm; onChange: (v: PersonForm) => void; married?: boolean }) {
  const upd = (k: keyof PersonForm) => (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  const filled = hasIdentity(value)
  return (
    <section className={`rounded-2xl border p-4 transition-colors ${filled ? 'border-gold-500/60 bg-night-800/70' : 'border-night-600 bg-night-800/40'}`}>
      <header className="mb-3 flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${filled ? 'bg-gold-500 text-night-950' : 'bg-night-700 text-ivory-200/70'}`}>{icon}</span>
        <h2 className="font-display text-xl">{title}</h2>
        {!filled && <span className="ml-auto text-[11px] uppercase tracking-wide text-ivory-200/40">facultatif</span>}
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Prénoms"><input className={inp} value={value.given_names} onChange={upd('given_names')} /></F>
        <F label="Nom de naissance"><input className={inp} value={value.surname} onChange={upd('surname')} /></F>
        {married && <F label="Nom marital"><input className={inp} value={value.married_name} onChange={upd('married_name')} /></F>}
        <F label="Profession"><input className={inp} value={value.occupation} onChange={upd('occupation')} /></F>
        <F label="Date de naissance"><input className={inp} value={value.birth_date} onChange={upd('birth_date')} placeholder="1921, vers 1920…" /></F>
        <F label="Lieu de naissance"><input className={inp} value={value.birth_place} onChange={upd('birth_place')} /></F>
        <F label="Date de décès"><input className={inp} value={value.death_date} onChange={upd('death_date')} placeholder="Vide si vivant(e) ou inconnu" /></F>
        <F label="Lieu de décès"><input className={inp} value={value.death_place} onChange={upd('death_place')} /></F>
      </div>
    </section>
  )
}
