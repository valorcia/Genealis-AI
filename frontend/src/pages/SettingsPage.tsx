import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BookOpen, Cpu, Database, Download, FolderOpen, Info, KeyRound, Lock, RefreshCw, RotateCcw, Save, ScrollText, Shield, ShieldCheck, Sliders, Trash2, Unlock } from 'lucide-react'
import { api, ApiError, type Settings } from '../api'
import { useApp } from '../store'
import { Empty, Field, Panel, Spinner, formatDate } from '../components/ui'
import { AutonomyCards } from '../components/settings/AutonomyCards'

type TabKey = 'general' | 'ia' | 'sauvegardes' | 'confidentialite' | 'journal' | 'apropos'
const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'general', label: 'Général', icon: <Sliders size={15} /> },
  { key: 'ia', label: 'Intelligence artificielle', icon: <Cpu size={15} /> },
  { key: 'sauvegardes', label: 'Sauvegardes', icon: <Database size={15} /> },
  { key: 'confidentialite', label: 'Confidentialité', icon: <Shield size={15} /> },
  { key: 'journal', label: 'Journal technique', icon: <ScrollText size={15} /> },
  { key: 'apropos', label: 'À propos', icon: <Info size={15} /> },
]
const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v)

type Values = Record<string, unknown>
type Health = { status: string; version: string; data_dir: string; serverless?: boolean; database?: string; auth_required?: boolean; secret_key_set?: boolean }
type AiStatus = { provider: string; available: boolean; ok: boolean; message: string; models?: string[] }
type Backup = { name: string; size: number; created_at: string; encrypted: boolean }
type Transmission = { id: number; ts: string; provider: string; purpose: string; payload_summary: string; bytes_sent: number; contains_personal_data: boolean; authorized: boolean }

function errMsg(e: unknown, fallback: string) { return e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback }
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v))
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : d)
const bool = (v: unknown) => v === true || v === 'true' || v === 1

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab: TabKey = isTab(params.get('tab')) ? (params.get('tab') as TabKey) : 'general'
  const setTab = (t: TabKey) => setParams({ tab: t })
  const { notify, refreshSettings } = useApp()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Values>({})
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api.settings().then(setSettings).catch((e: unknown) => setLoadError(errMsg(e, 'Impossible de charger les paramètres.')))
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  const get = useCallback((k: string): unknown => (k in draft ? draft[k] : settings?.[k]), [draft, settings])
  const set = (k: string, v: unknown) => setDraft((d) => (settings && settings[k] === v ? Object.fromEntries(Object.entries({ ...d }).filter(([key]) => key !== k)) : { ...d, [k]: v }))
  const dirty = Object.keys(draft).length > 0 || apiKey.length > 0

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    try {
      const values: Values = { ...draft }
      const keyName = str(get('ai_provider')) === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key'
      if (apiKey.trim()) values[keyName] = apiKey.trim()
      const s = await api.patchSettings(values)
      setSettings(s); setDraft({}); setApiKey('')
      await refreshSettings()
      notify('success', 'Paramètres enregistrés.')
    } catch (e) { notify('error', errMsg(e, "Impossible d'enregistrer les paramètres.")) } finally { setSaving(false) }
  }
  const discard = () => { setDraft({}); setApiKey('') }

  const removeKey = async () => {
    setSaving(true)
    try { const s = await api.patchSettings({ [str(get('ai_provider')) === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key']: '' }); setSettings(s); setApiKey(''); await refreshSettings(); notify('success', 'Clé API supprimée.') }
    catch (e) { notify('error', errMsg(e, 'Impossible de supprimer la clé.')) } finally { setSaving(false) }
  }

  const showSaveBar = tab === 'general' || tab === 'ia' || tab === 'sauvegardes'

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="fade-up">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-600">Configuration</div>
        <h1 className="font-display text-3xl text-night-900">Paramètres</h1>
      </header>
      <nav className="fade-up flex flex-wrap gap-1 rounded-xl border border-ivory-300 bg-ivory-50 p-1">
        {TABS.map((t) => (
          <button key={t.key} className={`btn !py-1.5 ${tab === t.key ? 'bg-night-900 text-ivory-50' : 'text-night-900 hover:bg-ivory-200'}`} onClick={() => setTab(t.key)}>{t.icon} {t.label}</button>
        ))}
      </nav>

      {loadError && <div className="rounded-xl border border-conf-red/30 bg-conf-red/10 px-4 py-3 text-sm text-conf-red">{loadError}</div>}
      {!settings && !loadError && <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement…</div>}

      {settings && tab === 'general' && <GeneralTab get={get} set={set} />}
      {settings && tab === 'ia' && <AiTab get={get} set={set} settings={settings} apiKey={apiKey} setApiKey={setApiKey} removeKey={removeKey} saving={saving} hosted={Boolean(health?.serverless)} secretKeyMissing={Boolean(health?.serverless && health && !health.secret_key_set)} />}
      {settings && tab === 'sauvegardes' && <BackupsTab get={get} set={set} health={health} notify={notify} />}
      {tab === 'confidentialite' && <PrivacyTab get={get} />}
      {tab === 'journal' && <JournalTab />}
      {tab === 'apropos' && <AboutTab health={health} />}

      {settings && showSaveBar && (
        <div className={`sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-colors ${dirty ? 'border-gold-500/60 bg-night-900 text-ivory-50' : 'border-ivory-300 bg-ivory-50 text-mist-500'}`}>
          <span className="text-sm">{dirty ? `${Object.keys(draft).length + (apiKey ? 1 : 0)} modification(s) non enregistrée(s)` : 'Aucune modification en attente'}</span>
          <div className="flex gap-2">
            {dirty && <button className="btn-ghost !border-night-600 !text-ivory-50 hover:!bg-night-800" onClick={discard} disabled={saving}>Annuler</button>}
            <button className="btn-gold" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner /> : <Save size={15} />} Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  )
}

type GetSet = { get: (k: string) => unknown; set: (k: string, v: unknown) => void }

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-sage-500' : 'bg-mist-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <span><span className="block text-sm font-medium text-night-900">{label}</span>{hint && <span className="block text-xs text-mist-500">{hint}</span>}</span>
    </label>
  )
}

function RadioCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-gold-500 bg-gold-500/10' : 'border-ivory-300 bg-white hover:border-gold-400'}`}>
      <div className="text-sm font-medium text-night-900">{title}</div>
      <div className="text-xs text-mist-500">{desc}</div>
    </button>
  )
}

function GeneralTab({ get, set }: GetSet) {
  return (
    <div className="space-y-5">
      <Panel title="Mode d'autonomie du moteur">
        <p className="mb-3 text-xs text-mist-500">Quel que soit le mode, aucune filiation n'est créée sur le seul nom de famille, et toute information enregistrée conserve sa source.</p>
        <AutonomyCards value={num(get('autonomy_mode'), 1)} onChange={(v) => set('autonomy_mode', v)} />
      </Panel>
      <Panel title="Recherches">
        <div className="space-y-4">
          <Toggle checked={bool(get('research_pause'))} onChange={(v) => set('research_pause', v)} label="Mettre les recherches en pause" hint="Les enquêtes en file restent conservées ; rien n'est lancé tant que la pause est active." />
          <Field label="Intervalle minimal entre deux requêtes vers une archive (secondes)">
            <input type="number" min={0} step={0.5} className="input max-w-xs" value={num(get('connector_min_interval'), 2)} onChange={(e) => set('connector_min_interval', Number(e.target.value))} />
            <span className="mt-1 block text-xs text-mist-500">Respecte les conditions d'utilisation des services d'archives.</span>
          </Field>
        </div>
      </Panel>
      <Panel title="Personnes vivantes">
        <Toggle checked={bool(get('living_persons_privacy'))} onChange={(v) => set('living_persons_privacy', v)} label="Protéger les personnes vivantes" hint="Leurs données restent masquées dans les exports, récits et transmissions externes." />
      </Panel>
    </div>
  )
}

function AiTab({ get, set, settings, apiKey, setApiKey, removeKey, saving, hosted, secretKeyMissing }: GetSet & { settings: Settings; apiKey: string; setApiKey: (v: string) => void; removeKey: () => void; saving: boolean; hosted: boolean; secretKeyMissing: boolean }) {
  const provider = str(get('ai_provider'), 'none')
  const [models, setModels] = useState<string[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectErr, setDetectErr] = useState<string | null>(null)
  const [test, setTest] = useState<AiStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [testErr, setTestErr] = useState<string | null>(null)

  const [gModels, setGModels] = useState<string[] | null>(null)
  const [gDetecting, setGDetecting] = useState(false)
  const [gErr, setGErr] = useState<string | null>(null)
  const detectGemini = async () => {
    setGDetecting(true); setGErr(null)
    try { const m = await api.geminiModels(); setGModels(m); if (m.length === 0) setGErr('Aucun modèle renvoyé : vérifiez la clé.') }
    catch (e) { setGErr(errMsg(e, 'Détection impossible.')) } finally { setGDetecting(false) }
  }
  const detect = async () => {
    setDetecting(true); setDetectErr(null)
    try { const m = await api.ollamaModels(); setModels(m); if (m.length === 0) setDetectErr('Ollama est joignable mais aucun modèle n\'est installé.') }
    catch (e) { setModels(null); setDetectErr(errMsg(e, 'Ollama injoignable à cette adresse.')) } finally { setDetecting(false) }
  }
  const runTest = async () => {
    setTesting(true); setTestErr(null); setTest(null)
    try { setTest(await api.aiStatus()) } catch (e) { setTestErr(errMsg(e, 'Test impossible.')) } finally { setTesting(false) }
  }
  const modelSelect = (key: string, label: string, hint: string) => {
    const current = str(get(key))
    const opts = models ? Array.from(new Set([current, ...models].filter(Boolean))) : null
    return (
      <Field label={label}>
        {opts ? <select className="input" value={current} onChange={(e) => set(key, e.target.value)}>{opts.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          : <input className="input" value={current} onChange={(e) => set(key, e.target.value)} />}
        <span className="mt-1 block text-xs text-mist-500">{hint}</span>
      </Field>
    )
  }

  return (
    <div className="space-y-5">
      {secretKeyMissing && <div className="flex items-start gap-2 rounded-xl border border-conf-red/40 bg-conf-red/10 px-4 py-3 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-conf-red" /><span><strong>Variable SECRET_KEY absente sur l'hébergement.</strong> Les clés API saisies ici seront perdues au prochain redémarrage. Dans Vercel → Settings → Environment Variables, ajoutez <code>SECRET_KEY</code> (phrase longue et aléatoire), redéployez, puis ressaisissez votre clé.</span></div>}
      <Panel title="Fournisseur d'intelligence artificielle">
        <p className="mb-3 text-xs text-mist-500">L'application fonctionne entièrement sans modèle : l'IA n'ajoute que de l'aide à la lecture des actes, à la reformulation et à l'analyse d'intention. Elle ne décide jamais seule d'une filiation.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" role="radiogroup">
          <RadioCard active={provider === 'manual'} onClick={() => set('ai_provider', 'manual')} title="Claude / ChatGPT (abonnement)" desc="Copier-coller : l'app prépare le texte, vous collez la réponse. Gratuit avec votre abonnement, rien d'automatique." />
          <RadioCard active={provider === 'gemini'} onClick={() => set('ai_provider', 'gemini')} title="Gemini (Google, gratuit)" desc="Clé gratuite sans carte bancaire ; lecture automatique des actes, y compris depuis l'application hébergée." />
          <RadioCard active={provider === 'none'} onClick={() => set('ai_provider', 'none')} title="Aucun" desc="Règles seules, gratuit, hors ligne." />
          <RadioCard active={provider === 'ollama'} onClick={() => set('ai_provider', 'ollama')} title="Ollama (PC)" desc={hosted ? 'Indisponible en version hébergée : Ollama tourne sur votre ordinateur, pas sur Vercel.' : 'Modèle local, gratuit ; rien ne quitte votre ordinateur.'} />
          <RadioCard active={provider === 'anthropic'} onClick={() => set('ai_provider', 'anthropic')} title="Claude via API" desc="Payant à l'usage (clé API, distincte de l'abonnement claude.ai)." />
        </div>
        {provider === 'ollama' && hosted && <div className="mt-3 flex items-start gap-2 rounded-xl border border-conf-orange/40 bg-conf-orange/10 px-4 py-3 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-conf-orange" /><span>Cette installation est hébergée sur Vercel : elle ne peut pas joindre un Ollama installé sur votre PC (adresse 127.0.0.1). Choisissez « Gemini (gratuit) » ou « Claude / ChatGPT (abonnement) ».</span></div>}
      </Panel>

      {provider === 'manual' && (
        <Panel title="Claude / ChatGPT avec votre abonnement (copier-coller)">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Ouvrez un document dans <Link to="/archives?tab=documents" className="text-gold-600 underline">Archives et documents</Link> et cliquez « Analyser avec Claude / ChatGPT ».</li>
            <li>L'application copie le texte à coller et vous donne l'image à joindre dans claude.ai ou chatgpt.com (votre abonnement habituel).</li>
            <li>Collez la réponse de l'assistant dans l'application : la transcription, les personnes et les dates sont intégrées, puis vérifiées comme n'importe quelle hypothèse.</li>
          </ol>
          <p className="mt-3 text-xs text-mist-500">Les abonnements claude.ai et ChatGPT n'offrent pas d'accès automatique aux applications tierces : ce mode respecte leurs conditions d'utilisation. Pour une lecture automatique gratuite, choisissez Gemini.</p>
        </Panel>
      )}

      {provider === 'gemini' && (
        <Panel title="Gemini (Google AI Studio) — niveau gratuit">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modèle">
              {gModels && gModels.length > 0
                ? <select className="input" value={str(get('gemini_model'), 'gemini-3.8-flash')} onChange={(e) => set('gemini_model', e.target.value)}>{Array.from(new Set([str(get('gemini_model'), 'gemini-3.8-flash'), ...gModels])).map((m) => <option key={m} value={m}>{m}</option>)}</select>
                : <input className="input" value={str(get('gemini_model'), 'gemini-3.8-flash')} onChange={(e) => set('gemini_model', e.target.value)} />}
              <span className="mt-1 flex items-center gap-2 text-xs text-mist-500">
                <button className="text-gold-600 hover:underline disabled:opacity-50" disabled={gDetecting || !settings.gemini_api_key_set} onClick={detectGemini}>{gDetecting ? 'Détection…' : 'Détecter les modèles disponibles'}</button>
                {!settings.gemini_api_key_set && <span>(enregistrez d'abord la clé)</span>}
                {gErr && <span className="text-conf-orange">{gErr}</span>}
              </span>
            </Field>
            <Field label="Clé API Gemini (gratuite)">
              <input type="password" autoComplete="off" className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.gemini_api_key_set ? '•••••••••••• (remplacer)' : 'AIza…'} />
              <span className="mt-1 flex items-center gap-2 text-xs">
                {settings.gemini_api_key_set ? <span className="inline-flex items-center gap-1 text-sage-600"><KeyRound size={12} /> Clé enregistrée (chiffrée)</span> : <span className="text-mist-500">Créez une clé gratuite sur aistudio.google.com/apikey (compte Google, sans carte bancaire).</span>}
                {settings.gemini_api_key_set && <button className="text-conf-red hover:underline disabled:opacity-50" onClick={removeKey} disabled={saving}>Supprimer la clé</button>}
              </span>
            </Field>
          </div>
          <p className="mt-3 text-xs text-mist-500">Pensez à activer « Autoriser l'envoi de données à un fournisseur d'IA externe » ci-dessous : les images d'actes sont transmises à Google pour lecture.</p>
        </Panel>
      )}

      {provider === 'ollama' && (
        <Panel title="Ollama (local)">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Adresse du serveur Ollama"><input className="input" value={str(get('ollama_url'))} onChange={(e) => set('ollama_url', e.target.value)} placeholder="http://127.0.0.1:11434" /></Field>
            <div className="flex items-end gap-2">
              <button className="btn-ghost" onClick={detect} disabled={detecting}>{detecting ? <Spinner /> : <RefreshCw size={15} />} Détecter les modèles</button>
              {models && models.length > 0 && <span className="text-xs text-sage-600">{models.length} modèle(s) détecté(s)</span>}
            </div>
            {modelSelect('ollama_model', 'Modèle de texte', 'Reformulation, analyse de transcriptions.')}
            {modelSelect('ollama_vision_model', 'Modèle de vision', "Lecture d'images d'actes (OCR assisté).")}
          </div>
          {detectErr && <div className="mt-3 text-xs text-conf-orange">{detectErr} Enregistrez l'adresse avant de détecter si vous venez de la modifier.</div>}
        </Panel>
      )}

      {provider === 'anthropic' && (
        <Panel title="Claude via API (Anthropic)">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modèle"><input className="input" value={str(get('anthropic_model'))} onChange={(e) => set('anthropic_model', e.target.value)} /></Field>
            <Field label="Clé API">
              <input type="password" autoComplete="off" className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.anthropic_api_key_set ? '•••••••••••• (remplacer)' : 'sk-ant-…'} />
              <span className="mt-1 flex items-center gap-2 text-xs">
                {settings.anthropic_api_key_set ? <span className="inline-flex items-center gap-1 text-sage-600"><KeyRound size={12} /> Clé enregistrée (chiffrée localement)</span> : <span className="text-mist-500">Aucune clé enregistrée. La clé est chiffrée sur disque et jamais affichée.</span>}
                {settings.anthropic_api_key_set && <button className="text-conf-red hover:underline disabled:opacity-50" onClick={removeKey} disabled={saving}>Supprimer la clé</button>}
              </span>
            </Field>
          </div>
        </Panel>
      )}

      {provider !== 'none' && (
        <Panel title="Transmission de données">
          <div className="space-y-4">
            <Toggle checked={bool(get('allow_external_ai'))} onChange={(v) => set('allow_external_ai', v)} label="Autoriser l'envoi de données à un fournisseur d'IA externe" hint="Nécessaire pour Gemini et Claude via API. Inutile avec Ollama en local ou en mode copier-coller." />
            {bool(get('allow_external_ai')) && (
              <div className="flex items-start gap-3 rounded-xl border border-conf-red/40 bg-gold-500/10 px-4 py-3 text-sm text-night-900">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-conf-red" />
                <div><strong className="text-conf-red">Attention.</strong> Vos données (noms, dates, images d'actes) seront transmises au fournisseur choisi. Chaque transmission est journalisée et consultable dans l'onglet <Link to="/parametres?tab=confidentialite" className="text-gold-600 underline">Confidentialité</Link>.</div>
              </div>
            )}
            <div>
              <span className="label">Étendue des données transmises</span>
              <div className="grid gap-3 md:grid-cols-2" role="radiogroup">
                <RadioCard active={str(get('external_ai_scope'), 'anonymized') === 'anonymized'} onClick={() => set('external_ai_scope', 'anonymized')} title="Anonymisées" desc="Noms et lieux remplacés par des jetons avant envoi, quand c'est possible." />
                <RadioCard active={str(get('external_ai_scope')) === 'full'} onClick={() => set('external_ai_scope', 'full')} title="Complètes" desc="Données réelles transmises (meilleure lecture des actes)." />
              </div>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Reconnaissance de texte (OCR)">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Moteur OCR">
            <select className="input" value={str(get('ocr_engine'), 'auto')} onChange={(e) => set('ocr_engine', e.target.value)}>
              <option value="auto">Automatique (le meilleur disponible)</option>
              <option value="tesseract">Tesseract (local)</option>
              <option value="ai">Modèle IA de vision</option>
              <option value="none">Désactivé</option>
            </select>
          </Field>
          <Field label="Chemin de l'exécutable Tesseract (optionnel)"><input className="input" value={str(get('tesseract_cmd'))} onChange={(e) => set('tesseract_cmd', e.target.value)} placeholder="Laisser vide pour la détection automatique" /></Field>
        </div>
        <p className="mt-2 text-xs text-mist-500">Une transcription automatique n'est jamais une preuve parfaite : elle reste à relire et à sourcer.</p>
      </Panel>

      <Panel title="Vérification" actions={<button className="btn-ghost" onClick={runTest} disabled={testing}>{testing ? <Spinner /> : <Cpu size={15} />} Tester la configuration IA</button>}>
        <p className="text-xs text-mist-500">Le test utilise la configuration <em>enregistrée</em> : enregistrez d'abord vos modifications.</p>
        {test && <div className={`mt-3 rounded-xl px-4 py-3 text-sm ${test.ok ? 'conf-green' : 'conf-orange'}`}><strong>{test.provider}</strong> — {test.message}{test.models && test.models.length > 0 && <span className="block text-xs">Modèles : {test.models.join(', ')}</span>}</div>}
        {testErr && <div className="mt-3 text-sm text-conf-red">{testErr}</div>}
      </Panel>
    </div>
  )
}

function BackupsTab({ get, set, health, notify }: GetSet & { health: Health | null; notify: (k: 'info' | 'error' | 'success', t: string) => void }) {
  const [backups, setBackups] = useState<Backup[] | null>(null)
  const [listErr, setListErr] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [busyRestore, setBusyRestore] = useState(false)
  const [restoredInfo, setRestoredInfo] = useState<{ restored: string; safety_backup: string } | null>(null)

  const load = useCallback(async () => { try { setBackups(await api.backups()); setListErr(null) } catch (e) { setListErr(errMsg(e, 'Impossible de lister les sauvegardes.')) } }, [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    setCreating(true)
    try { const r = await api.createBackup(passphrase.trim() || undefined); notify('success', `Sauvegarde créée : ${r.name}`); setPassphrase(''); await load() }
    catch (e) { notify('error', errMsg(e, 'La sauvegarde a échoué.')) } finally { setCreating(false) }
  }
  const restore = async (b: Backup) => {
    setBusyRestore(true)
    try {
      const r = await api.restoreBackup(b.name, b.encrypted ? restorePass : undefined)
      setRestoredInfo(r); setRestoring(null); setRestorePass('')
      notify('success', 'Base restaurée. Redémarrez l\'application.')
      await load()
    } catch (e) { notify('error', errMsg(e, 'La restauration a échoué.')) } finally { setBusyRestore(false) }
  }
  const folder = health ? `${health.data_dir.replace(/[\\/]+$/, '')}/backups` : null

  const hosted = Boolean(health?.serverless || health?.database === 'postgresql')
  const [importing, setImporting] = useState(false)
  const importJson = async (f: File | undefined) => {
    if (!f) return
    setImporting(true)
    try { const st = await api.importJson(f); notify('success', `Sauvegarde restaurée : ${Object.values(st).reduce((a, b) => a + b, 0)} enregistrements.`) }
    catch (e) { notify('error', errMsg(e, 'La restauration a échoué.')) } finally { setImporting(false) }
  }
  if (hosted) {
    return (
      <div className="space-y-5">
        <Panel title="Sauvegarde complète (mode hébergé)">
          <p className="text-sm text-mist-500">Votre base est hébergée ({health?.database}). Téléchargez régulièrement une sauvegarde complète : elle contient toutes vos personnes, sources, documents référencés et l'historique des recherches, et peut être restaurée ici ou dans l'application de bureau.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="btn-primary" href={api.exportJsonUrl()} download><Download size={15} /> Télécharger la sauvegarde (JSON)</a>
            <label className="btn-ghost cursor-pointer"><RotateCcw size={15} /> {importing ? 'Restauration…' : 'Restaurer un fichier JSON'}<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => importJson(e.target.files?.[0])} /></label>
          </div>
          <p className="mt-3 text-xs text-conf-red">La restauration remplace l'intégralité du contenu actuel.</p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Panel title="Sauvegardes automatiques">
        <div className="space-y-4">
          <Toggle checked={bool(get('backup_enabled'))} onChange={(v) => set('backup_enabled', v)} label="Activer les sauvegardes automatiques" hint="Une copie complète de la base et des documents, en local uniquement." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Intervalle (heures)"><input type="number" min={1} className="input" value={num(get('backup_interval_hours'), 24)} onChange={(e) => set('backup_interval_hours', Number(e.target.value))} /></Field>
            <Field label="Nombre de sauvegardes conservées"><input type="number" min={1} className="input" value={num(get('backup_keep'), 14)} onChange={(e) => set('backup_keep', Number(e.target.value))} /></Field>
          </div>
          {folder && <div className="flex items-center gap-2 text-xs text-mist-500"><FolderOpen size={14} /> Dossier des sauvegardes : <code className="rounded bg-ivory-200 px-1.5 py-0.5 text-night-900">{folder}</code><span>— copiez-le régulièrement sur un support externe.</span></div>}
        </div>
      </Panel>

      <Panel title="Sauvegarder maintenant">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Phrase secrète (optionnelle, chiffre l'archive)"><input type="password" autoComplete="off" className="input min-w-64" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Laisser vide pour une sauvegarde non chiffrée" /></Field>
          <button className="btn-primary" onClick={create} disabled={creating}>{creating ? <Spinner /> : <Download size={15} />} Sauvegarder maintenant</button>
        </div>
        {passphrase && <p className="mt-2 text-xs text-conf-orange">Sans cette phrase, la sauvegarde ne pourra pas être restaurée. Elle n'est enregistrée nulle part.</p>}
      </Panel>

      <Panel title="Sauvegardes disponibles" actions={<button className="btn-ghost !px-2" onClick={load} title="Actualiser"><RefreshCw size={15} /></button>}>
        {restoredInfo && (
          <div className="conf-green mb-3 rounded-xl px-4 py-3 text-sm">
            Base restaurée depuis <strong>{restoredInfo.restored}</strong>. Une sauvegarde de sécurité de l'état précédent a été créée : <code>{restoredInfo.safety_backup}</code>. <strong>Redémarrez l'application</strong> pour travailler sur les données restaurées.
          </div>
        )}
        {listErr && <div className="mb-3 text-sm text-conf-red">{listErr}</div>}
        {backups === null && !listErr && <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement…</div>}
        {backups && backups.length === 0 && <Empty>Aucune sauvegarde pour l'instant.</Empty>}
        {backups && backups.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-mist-500"><th className="py-1.5">Nom</th><th>Taille</th><th>Date</th><th></th><th></th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name} className="border-t border-ivory-200 align-top">
                  <td className="py-2 font-medium text-night-900">{b.name}</td>
                  <td className="py-2 text-mist-500">{(b.size / 1048576).toFixed(2)} Mo</td>
                  <td className="py-2 text-mist-500">{formatDate(b.created_at)}</td>
                  <td className="py-2">{b.encrypted ? <span className="inline-flex items-center gap-1 text-xs text-gold-600"><Lock size={12} /> chiffrée</span> : <span className="inline-flex items-center gap-1 text-xs text-mist-400"><Unlock size={12} /> en clair</span>}</td>
                  <td className="py-2 text-right">
                    {restoring === b.name ? (
                      <div className="fade-up inline-flex flex-wrap items-center justify-end gap-2 rounded-xl border border-conf-red/30 bg-conf-red/5 px-3 py-2 text-xs">
                        <span className="text-night-900">Remplacer la base actuelle par cette sauvegarde ? Une sauvegarde de sécurité est créée d'abord ; l'application devra être redémarrée.</span>
                        {b.encrypted && <input type="password" autoComplete="off" className="input !w-48 !py-1" placeholder="Phrase secrète" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />}
                        <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => restore(b)} disabled={busyRestore || (b.encrypted && !restorePass)}>{busyRestore ? <Spinner /> : <RotateCcw size={12} />} Confirmer</button>
                        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => { setRestoring(null); setRestorePass('') }} disabled={busyRestore}>Annuler</button>
                      </div>
                    ) : (
                      <button className="btn-ghost !py-1 text-xs" onClick={() => { setRestoring(b.name); setRestorePass('') }} disabled={busyRestore}><RotateCcw size={13} /> Restaurer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function PrivacyTab({ get }: { get: (k: string) => unknown }) {
  const [rows, setRows] = useState<Transmission[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => { try { setRows(await api.transmissions()); setErr(null) } catch (e) { setErr(errMsg(e, 'Impossible de charger le journal des transmissions.')) } }, [])
  useEffect(() => { load() }, [load])
  const living = bool(get('living_persons_privacy'))
  return (
    <div className="space-y-5">
      <Panel title="Vos données restent chez vous">
        <ul className="space-y-2 text-sm text-night-900">
          <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage-600" /> Toutes les données (personnes, actes, images, sources, journal) sont stockées localement sur cet ordinateur. Rien n'est publié ni synchronisé.</li>
          <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage-600" /> Les archives en ligne ne sont consultées que lors des recherches, dans le respect de leurs conditions d'utilisation ; seules des requêtes de recherche (noms, lieux, périodes) leur sont adressées.</li>
          <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage-600" /> Un fournisseur d'IA externe ne reçoit des données que si vous l'avez explicitement autorisé dans l'onglet <Link to="/parametres?tab=ia" className="text-gold-600 underline">Intelligence artificielle</Link>. Chaque transmission est journalisée ci-dessous.</li>
          <li className="flex gap-2"><ShieldCheck size={16} className={`mt-0.5 shrink-0 ${living ? 'text-sage-600' : 'text-conf-orange'}`} /> Protection des personnes vivantes : <strong className="ml-1">{living ? 'activée' : 'désactivée'}</strong>. {living ? 'Leurs données sont masquées dans les exports, récits et transmissions.' : 'Pensez à l\'activer dans l\'onglet Général avant tout export ou partage.'}</li>
        </ul>
      </Panel>

      <Panel title="Journal des transmissions externes" actions={<button className="btn-ghost !px-2" onClick={load} title="Actualiser"><RefreshCw size={15} /></button>}>
        {err && <div className="text-sm text-conf-red">{err}</div>}
        {rows === null && !err && <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement…</div>}
        {rows && rows.length === 0 && <Empty>Aucune donnée n'a jamais été transmise à un service externe d'IA.</Empty>}
        {rows && rows.length > 0 && (
          <div className="scrollbar-thin max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-mist-500"><th className="py-1.5">Date</th><th>Fournisseur</th><th>Objet</th><th>Octets</th><th>Données personnelles</th><th>Autorisée</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-ivory-200">
                    <td className="py-1.5 text-mist-500">{formatDate(r.ts)}</td>
                    <td className="py-1.5">{r.provider}</td>
                    <td className="py-1.5" title={r.payload_summary}>{r.purpose}</td>
                    <td className="py-1.5 text-mist-500">{r.bytes_sent}</td>
                    <td className="py-1.5">{r.contains_personal_data ? <span className="chip conf-orange">oui</span> : <span className="chip conf-grey">non</span>}</td>
                    <td className="py-1.5">{r.authorized ? <span className="chip conf-green">oui</span> : <span className="chip conf-red">non</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Supprimer définitivement des données">
        <p className="text-sm text-night-900">La suppression d'une personne se fait depuis sa fiche (bouton « Supprimer »). Elle efface sa fiche, ses événements, ses liens et ses citations ; les documents originaux et les sources partagées avec d'autres personnes sont conservés, car aucun original n'est jamais détruit automatiquement.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/arbre" className="btn-ghost"><Trash2 size={15} /> Parcourir l'arbre pour choisir une fiche</Link>
          <Link to="/archives" className="btn-ghost"><FolderOpen size={15} /> Gérer les documents</Link>
        </div>
      </Panel>
    </div>
  )
}

function JournalTab() {
  const [log, setLog] = useState<{ path: string; lines: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => { setLoading(true); try { setLog(await api.technicalLog()); setErr(null) } catch (e) { setErr(errMsg(e, 'Impossible de lire le journal technique.')) } finally { setLoading(false) } }, [])
  useEffect(() => { load() }, [load])
  return (
    <Panel title="Journal technique" actions={<button className="btn-ghost" onClick={load} disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={15} />} Actualiser</button>}>
      <p className="mb-3 text-xs text-mist-500">Messages internes du moteur (dernières lignes). Utile pour diagnostiquer un problème ; le journal généalogique des décisions se trouve dans <Link to="/enquetes" className="text-gold-600 underline">Enquêtes IA</Link>.</p>
      {log && <div className="mb-2 text-xs text-mist-500">Fichier : <code className="rounded bg-ivory-200 px-1.5 py-0.5 text-night-900">{log.path}</code></div>}
      {err && <div className="text-sm text-conf-red">{err}</div>}
      {log && log.lines.length === 0 && <Empty>Le journal est vide.</Empty>}
      {log && log.lines.length > 0 && (
        <pre className="scrollbar-thin max-h-[60vh] overflow-auto rounded-xl bg-night-950 p-4 font-mono text-[12px] leading-relaxed text-ivory-200">{log.lines.join('\n')}</pre>
      )}
    </Panel>
  )
}

const RULES: string[] = [
  "Ne jamais inventer un ancêtre : une personne n'existe dans l'arbre que si une source ou votre déclaration l'atteste.",
  'Ne jamais créer une filiation sur le seul nom de famille : il faut des critères concordants (lieux, dates, témoins, actes).',
  "Toujours conserver les sources : chaque information garde l'origine qui la justifie.",
  'Ne jamais masquer une contradiction : elle est affichée, datée et laissée à votre arbitrage.',
  "Demander votre avis lorsqu'une décision ne peut être tranchée : le moteur pose une question plutôt que de choisir.",
  "Ne jamais prétendre avoir consulté une archive qui ne l'a pas été.",
  'Ne jamais inventer un résultat de recherche : une recherche vide est rapportée comme telle.',
  "Une transcription automatique n'est jamais une preuve parfaite : elle reste à relire.",
  'Ne jamais supprimer automatiquement une hypothèse concurrente : les pistes rejetées restent consultables.',
  'Ne jamais déclarer une fonctionnalité terminée sans l\'avoir testée.',
  "Respecter les conditions d'utilisation des archives et la protection des données personnelles.",
  'Préserver les documents originaux : aucun original n\'est modifié ni supprimé automatiquement.',
]

function AboutTab({ health }: { health: Health | null }) {
  const docs = useMemo(() => [
    { title: 'Documentation du projet (dossier docs/)', hint: 'Guides d\'utilisation et de configuration, fournis avec l\'application.' },
    { title: 'Conditions d\'utilisation des archives', hint: 'Consultables depuis chaque connecteur dans Enquêtes IA.' },
  ], [])
  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="font-display text-3xl tracking-wide text-night-900">GENEALIS <span className="text-gold-500">AI</span></div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-mist-500">Généalogiste numérique local</div>
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-mist-500">Version</dt><dd className="font-medium text-night-900">{health ? health.version : <Spinner />}</dd>
            <dt className="text-mist-500">Dossier de données</dt><dd><code className="rounded bg-ivory-200 px-1.5 py-0.5 text-xs text-night-900">{health?.data_dir ?? '—'}</code></dd>
            <dt className="text-mist-500">État du moteur</dt><dd className="text-night-900">{health ? health.status : 'non joignable'}</dd>
            <dt className="text-mist-500">Mode</dt><dd className="text-night-900">{health ? (health.serverless ? 'Hébergé (Vercel, exécution à la demande)' : 'Local (application de bureau)') : '—'}</dd>
            <dt className="text-mist-500">Base de données</dt><dd className="text-night-900">{health ? (health.database === 'postgresql' ? <span className="chip conf-green">PostgreSQL (Neon) — connectée</span> : <span className="chip conf-orange">SQLite {health.serverless ? '— attention : éphémère en mode hébergé, connectez Neon' : '(fichier local)'}</span>) : '—'}</dd>
            <dt className="text-mist-500">Clé de chiffrement (SECRET_KEY)</dt><dd className="text-night-900">{health ? (health.secret_key_set ? 'définie' : (health.serverless ? <span className="text-conf-red">absente : les clés API enregistrées seront perdues à chaque redémarrage — définissez SECRET_KEY</span> : 'clé locale sur disque')) : '—'}</dd>
            <dt className="text-mist-500">Mot de passe d'accès</dt><dd className="text-night-900">{health ? (health.auth_required ? 'activé' : <span className="text-conf-orange">désactivé (définissez ACCESS_TOKEN)</span>) : '—'}</dd>
          </dl>
        </div>
      </Panel>
      <Panel title="Documentation">
        <ul className="space-y-2 text-sm">
          {docs.map((d) => <li key={d.title} className="flex items-start gap-2"><BookOpen size={15} className="mt-0.5 shrink-0 text-gold-600" /><span><span className="font-medium text-night-900">{d.title}</span><span className="block text-xs text-mist-500">{d.hint}</span></span></li>)}
        </ul>
      </Panel>
      <Panel title="Les douze règles absolues du généalogiste numérique">
        <ol className="grid gap-2 text-sm text-night-900 md:grid-cols-2">
          {RULES.map((r, i) => <li key={i} className="flex gap-3 rounded-xl border border-ivory-200 bg-white px-3 py-2"><span className="font-display text-lg leading-none text-gold-500">{String(i + 1).padStart(2, '0')}</span><span>{r}</span></li>)}
        </ol>
      </Panel>
    </div>
  )
}
