/**
 * Réglages v0.4 : coûts et quotas, enquêtes, navigateur autonome, confidentialité des personnes vivantes, audit Gemini.
 * Composant autonome (chargement et enregistrement propres). Les choix sensibles (mode COMMERCIAL, Browser Use Cloud,
 * données de personnes vivantes, budget payant) passent par une confirmation explicite.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleHelp, Coins, Globe, Plus, Radar, Save, ShieldCheck, Stethoscope, Trash2, XCircle } from 'lucide-react'
import { api, type Settings } from '../../api'
import { useApp } from '../../store'
import { Field, Panel, Spinner } from '../ui'
import { errMsg } from '../person/helpers'
import { ConfirmDialog, Notice, WorkerCard } from '../investigation/common'
import { costsApi, type GeminiAuditReport } from '../../lib/costsApi'
import { investigationApi, isUnavailable, type WorkerStatus } from '../../lib/investigationApi'

type Values = Record<string, unknown>
type PriceRow = { model: string; input: string; output: string }
type Sensitive = 'commercial' | 'cloud' | 'living' | 'budget'

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : d)
const bool = (v: unknown) => v === true || v === 'true' || v === 1
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const pricesToRows = (v: unknown): PriceRow[] => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.entries(v as Record<string, { input?: number; output?: number }>).map(([model, p]) => ({ model, input: p?.input != null ? String(p.input) : '', output: p?.output != null ? String(p.output) : '' }))
  : [])
const rowsToPrices = (rows: PriceRow[]) => Object.fromEntries(rows.filter((r) => r.model.trim()).map((r) => [r.model.trim(), { input: Number(r.input.replace(',', '.')) || 0, output: Number(r.output.replace(',', '.')) || 0 }]))

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${disabled ? 'opacity-60' : ''}`}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-sage-500' : 'bg-mist-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <span className="min-w-0"><span className="block text-sm font-medium text-night-900">{label}</span>{hint && <span className="block text-xs leading-snug text-mist-500">{hint}</span>}</span>
    </div>
  )
}
function NumberField({ label, value, onChange, min = 0, max, step = 1, hint, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string; suffix?: string }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input type="number" className="input" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Math.max(min, max !== undefined ? Math.min(max, Number(e.target.value)) : Number(e.target.value)))} />
        {suffix && <span className="shrink-0 text-xs text-mist-500">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-mist-500">{hint}</span>}
    </Field>
  )
}

export function V04Settings() {
  const { notify, refreshSettings } = useApp()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Values>({})
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [allowText, setAllowText] = useState('')
  const [blockText, setBlockText] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<Sensitive | null>(null)
  const [worker, setWorker] = useState<{ data: WorkerStatus | null; missing: boolean } | null>(null)

  const reset = useCallback((s: Settings) => {
    setSettings(s); setDraft({}); setPrices(pricesToRows(s.ai_prices))
    setAllowText(list(s.browser_extra_allowed_domains).join('\n')); setBlockText(list(s.browser_blocked_domains).join('\n'))
  }, [])
  useEffect(() => {
    api.settings().then(reset).catch((e: unknown) => setError(errMsg(e, 'Impossible de charger les réglages.')))
    investigationApi.workerStatus().then((w) => setWorker({ data: w, missing: false })).catch((e: unknown) => setWorker({ data: null, missing: isUnavailable(e) }))
  }, [reset])

  const get = useCallback((k: string): unknown => (k in draft ? draft[k] : settings?.[k]), [draft, settings])
  const set = (k: string, v: unknown) => setDraft((d) => {
    const n = { ...d }
    if (settings && JSON.stringify(settings[k]) === JSON.stringify(v)) delete n[k]; else n[k] = v
    return n
  })
  const domains = (t: string) => t.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
  const extra = useMemo<Values>(() => {
    if (!settings) return {}
    const out: Values = {}
    const p = rowsToPrices(prices)
    if (JSON.stringify(p) !== JSON.stringify(settings.ai_prices ?? {})) out.ai_prices = p
    const a = domains(allowText), b = domains(blockText)
    if (JSON.stringify(a) !== JSON.stringify(list(settings.browser_extra_allowed_domains))) out.browser_extra_allowed_domains = a
    if (JSON.stringify(b) !== JSON.stringify(list(settings.browser_blocked_domains))) out.browser_blocked_domains = b
    return out
  }, [settings, prices, allowText, blockText])
  const changes = { ...draft, ...extra }
  const dirty = Object.keys(changes).length > 0

  const patch = async (values: Values, ok = 'Réglages enregistrés.') => {
    setSaving(true)
    try {
      const s = await api.patchSettings(values)
      // Conserve les modifications non enregistrées des autres champs.
      setSettings(s); setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !(k in values))))
      if ('ai_prices' in values) setPrices(pricesToRows(s.ai_prices))
      await refreshSettings(); notify('success', ok); return true
    } catch (e) { notify('error', errMsg(e, 'Impossible d’enregistrer.')); return false } finally { setSaving(false) }
  }
  const save = async () => {
    const budget = num(changes.ai_monthly_budget_usd, -1)
    if (budget > 0 && num(settings?.ai_monthly_budget_usd) <= 0) { setConfirm('budget'); return }
    await patch(changes)
  }
  const confirmSensitive = async () => {
    if (confirm === 'commercial') { if (await patch({ cost_mode: 'commercial' }, 'Mode COMMERCIAL activé.')) setConfirm(null) }
    else if (confirm === 'cloud') { if (await patch({ browser_use_cloud_authorized: true }, 'Browser Use Cloud autorisé.')) setConfirm(null) }
    else if (confirm === 'living') { if (await patch({ allow_living_data_external: true }, 'Autorisation enregistrée.')) setConfirm(null) }
    else if (confirm === 'budget') { if (await patch(changes)) setConfirm(null) }
  }

  if (error) return <Notice tone="error" title="Réglages indisponibles">{error}</Notice>
  if (!settings) return <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement…</div>

  const mode = String(get('cost_mode') ?? 'free')
  const browserMode = String(get('browser_mode') ?? 'local_worker')
  const cloudOk = bool(get('browser_use_cloud_authorized'))

  return (
    <div className="space-y-5">
      {/* ---------- Coûts et quotas ---------- */}
      <Panel title={<span className="flex items-center gap-2"><Coins size={18} className="text-mist-500" />Coûts et quotas</span>} actions={<Link to="/couts" className="text-[13px] font-medium text-ios-blue">Voir les coûts</Link>}>
        <p className="mb-3 text-xs text-mist-500">Les plafonds sont vérifiés avant chaque appel à l’IA : au-delà, rien n’est envoyé et l’enquête se met en pause en vous expliquant pourquoi.</p>
        <span className="label">Mode de fonctionnement</span>
        <div className="grid gap-2.5 md:grid-cols-3" role="radiogroup">
          {([
            ['free', 'GRATUIT', 'Navigateur sur votre PC, Browser Use open source, Gemini dans les limites gratuites. Aucun service payant ; arrêt dès qu’un quota est atteint.'],
            ['hybrid', 'HYBRIDE', 'Comme GRATUIT, plus un modèle local (Ollama) quand c’est utile. Un service payant seulement si vous l’autorisez, dans la limite du budget.'],
            ['commercial', 'COMMERCIAL', 'Préparation d’un service pour des clients : comptes, quotas et coûts suivis par client. Vos abonnements personnels ne sont jamais utilisés.'],
          ] as const).map(([k, l, d]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={saving}
              onClick={() => { if (k === 'commercial' && settings.cost_mode !== 'commercial') setConfirm('commercial'); else set('cost_mode', k) }}
              className={`rounded-xl border p-3 text-left transition-colors ${mode === k ? 'border-gold-500 bg-gold-500/10' : 'border-ivory-300 bg-white hover:border-gold-400'}`}>
              <span className="block text-[12px] font-bold tracking-[0.08em] text-night-900">{l}</span>
              <span className="mt-0.5 block text-xs leading-snug text-mist-500">{d}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Appels IA par jour (maximum)" value={num(get('ai_daily_call_limit'), 200)} onChange={(v) => set('ai_daily_call_limit', v)} hint="Le quota gratuit réel dépend de votre compte Google." />
          <NumberField label="Appels IA par minute" value={num(get('ai_minute_call_limit'), 8)} min={1} onChange={(v) => set('ai_minute_call_limit', v)} hint="Évite les refus « trop de requêtes »." />
          <NumberField label="Appels IA par enquête" value={num(get('investigation_ai_call_ceiling'), 60)} onChange={(v) => set('investigation_ai_call_ceiling', v)} hint="Valeur proposée à chaque nouvelle enquête." />
          <NumberField label="Appels simultanés" value={num(get('ai_max_concurrency'), 1)} min={1} max={8} onChange={(v) => set('ai_max_concurrency', v)} />
          <NumberField label="Budget payant par mois" value={num(get('ai_monthly_budget_usd'), 0)} step={0.5} suffix="$ US" onChange={(v) => set('ai_monthly_budget_usd', v)} hint="0 = aucune dépense autorisée (recommandé)." />
          <NumberField label="Durée de conservation du cache" value={num(get('ai_cache_ttl_days'), 30)} min={1} suffix="jours" onChange={(v) => set('ai_cache_ttl_days', v)} />
        </div>
        <div className="mt-4"><Toggle checked={bool(get('ai_cache_enabled'))} onChange={(v) => set('ai_cache_enabled', v)} label="Réutiliser les réponses déjà obtenues (cache)" hint="Un même document ou une même question n’est jamais renvoyé deux fois à l’IA : économise votre quota." /></div>

        <div className="mt-5">
          <span className="label">Tarifs des modèles (facultatif)</span>
          <p className="mb-2 text-xs text-mist-500">Les prix changent souvent : l’application ne les invente pas. Recopiez-les depuis la page officielle de Google (ai.google.dev/gemini-api/docs/pricing), en dollars par million de jetons. Sans tarif, le coût affiché est « tarif non renseigné ».</p>
          <div className="space-y-2">
            {prices.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_auto] items-center gap-2">
                <input className="input" placeholder="Modèle (ex. gemini-…-flash)" value={r.model} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} />
                <input className="input" inputMode="decimal" placeholder="Entrée $/M" value={r.input} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} />
                <input className="input" inputMode="decimal" placeholder="Sortie $/M" value={r.output} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} />
                <button className="btn-ghost !p-2" title="Supprimer ce tarif" onClick={() => setPrices(prices.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-ghost !py-1.5 !text-[13px]" onClick={() => setPrices([...prices, { model: String(settings.gemini_model ?? ''), input: '', output: '' }])}><Plus size={14} />Ajouter un tarif</button>
          </div>
        </div>
      </Panel>

      {/* ---------- Enquêtes ---------- */}
      <Panel title={<span className="flex items-center gap-2"><Radar size={18} className="text-mist-500" />Enquêtes autonomes</span>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Générations à remonter (par défaut)" value={num(get('investigation_max_generations'), 3)} min={1} max={12} onChange={(v) => set('investigation_max_generations', v)} />
          <div className="sm:pt-5"><Toggle checked={bool(get('investigation_auto_continue'))} onChange={(v) => set('investigation_auto_continue', v)} label="Passer seule à la génération suivante" hint="Sinon, l’enquête s’arrête à chaque génération pour que vous vérifiiez." /></div>
        </div>
      </Panel>

      {/* ---------- Navigateur autonome ---------- */}
      <Panel title={<span className="flex items-center gap-2"><Globe size={18} className="text-mist-500" />Navigateur autonome</span>}>
        <div className="mb-4">{worker ? <WorkerCard worker={worker.data} unavailable={worker.missing} /> : <Spinner />}</div>
        <span className="label">Où naviguer</span>
        <div className="grid gap-2.5 md:grid-cols-3" role="radiogroup">
          {([
            ['local_worker', 'Sur mon ordinateur', 'Recommandé et gratuit : Playwright et Browser Use (open source) ouvrent les sites sur votre PC.'],
            ['off', 'Désactivé', 'Aucune navigation : seulement les recherches sur Internet et vos documents.'],
            ['cloud', 'Browser Use Cloud', cloudOk ? 'Service en ligne payant : autorisé par vous.' : 'Service en ligne payant : désactivé tant que vous ne l’avez pas autorisé.'],
          ] as const).map(([k, l, d]) => {
            const locked = k === 'cloud' && !cloudOk
            return (
              <button key={k} type="button" role="radio" aria-checked={browserMode === k} disabled={locked}
                onClick={() => set('browser_mode', k)}
                className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${browserMode === k ? 'border-gold-500 bg-gold-500/10' : 'border-ivory-300 bg-white hover:border-gold-400'}`}>
                <span className="block text-sm font-medium text-night-900">{l}</span>
                <span className="mt-0.5 block text-xs leading-snug text-mist-500">{d}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3">
          <Toggle checked={cloudOk} disabled={saving || mode === 'free'} label="Autoriser Browser Use Cloud (payant)"
            hint={mode === 'free' ? 'Impossible en mode GRATUIT : choisissez d’abord HYBRIDE ou COMMERCIAL.' : 'Désactivé par défaut. Une confirmation vous est demandée avant toute activation.'}
            onChange={(v) => { if (v) setConfirm('cloud'); else patch({ browser_use_cloud_authorized: false, ...(browserMode === 'cloud' ? { browser_mode: 'local_worker' } : {}) }, 'Browser Use Cloud désactivé.') }} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Étapes maximum par mission" value={num(get('browser_max_steps'), 25)} min={1} max={200} onChange={(v) => set('browser_max_steps', v)} />
          <NumberField label="Délai par page" value={num(get('browser_page_timeout_s'), 30)} min={5} suffix="s" onChange={(v) => set('browser_page_timeout_s', v)} />
          <NumberField label="Délai par mission" value={num(get('browser_task_timeout_s'), 300)} min={30} suffix="s" onChange={(v) => set('browser_task_timeout_s', v)} />
          <NumberField label="Nouvelles tentatives" value={num(get('browser_max_retries'), 2)} max={10} onChange={(v) => set('browser_max_retries', v)} />
        </div>
        <div className="mt-4"><Toggle checked={bool(get('browser_headless'))} onChange={(v) => set('browser_headless', v)} label="Navigateur invisible" hint="Désactivez pour voir les fenêtres s’ouvrir sur votre ordinateur pendant l’enquête." /></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Sites supplémentaires autorisés">
            <textarea className="input min-h-[88px] font-mono !text-[13px]" value={allowText} onChange={(e) => setAllowText(e.target.value)} placeholder={'archives.exemple.fr\nautre-site.org'} />
            <span className="mt-1 block text-xs text-mist-500">Un domaine par ligne. Les sites d’archives connus sont déjà autorisés.</span>
          </Field>
          <Field label="Sites interdits">
            <textarea className="input min-h-[88px] font-mono !text-[13px]" value={blockText} onChange={(e) => setBlockText(e.target.value)} placeholder="site-a-eviter.com" />
            <span className="mt-1 block text-xs text-mist-500">Geneanet, FamilySearch, Ancestry, MyHeritage et Filae ne sont jamais parcourus automatiquement (leurs conditions l’interdisent) : ils vous sont ouverts pour une consultation à la main.</span>
          </Field>
        </div>
      </Panel>

      {/* ---------- Confidentialité ---------- */}
      <Panel title={<span className="flex items-center gap-2"><ShieldCheck size={18} className="text-mist-500" />Confidentialité des personnes vivantes</span>}>
        <Toggle checked={bool(get('allow_living_data_external'))} disabled={saving}
          label="Autoriser l’envoi de données de personnes vivantes à une IA externe"
          hint={bool(get('allow_living_data_external')) ? 'Activé : les documents des personnes vivantes peuvent être transmis à l’IA choisie. Chaque transmission est journalisée.' : 'Désactivé (recommandé) : un document lié à une personne peut-être vivante n’est jamais envoyé hors de l’application. Le navigateur ne recherche jamais de personne vivante.'}
          onChange={(v) => { if (v) setConfirm('living'); else patch({ allow_living_data_external: false }, 'Envoi des données de personnes vivantes désactivé.') }} />
        <p className="mt-3 text-xs text-mist-500">Journal complet des envois : <Link to="/parametres?tab=confidentialite" className="text-ios-blue">onglet Confidentialité</Link>.</p>
      </Panel>

      {/* ---------- Audit Gemini ---------- */}
      <GeminiAudit />

      {/* Barre d'enregistrement */}
      <div className={`sticky bottom-[calc(var(--dock-h)+8px)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-lg lg:bottom-0 ${dirty ? 'border-gold-500/60 bg-night-900 text-ivory-50' : 'border-ivory-300 bg-ivory-50 text-mist-500'}`}>
        <span className="text-sm">{dirty ? `${Object.keys(changes).length} modification(s) non enregistrée(s)` : 'Aucune modification en attente'}</span>
        <div className="flex gap-2">
          {dirty && <button className="btn-ghost !border-night-600 !text-ivory-50 hover:!bg-night-800" disabled={saving} onClick={() => reset(settings)}>Annuler</button>}
          <button className="btn-gold" disabled={!dirty || saving} onClick={save}>{saving ? <Spinner /> : <Save size={15} />}Enregistrer</button>
        </div>
      </div>

      {confirm === 'commercial' && (
        <ConfirmDialog title="Passer en mode COMMERCIAL ?" confirmLabel="Activer le mode COMMERCIAL" busy={saving} onClose={() => setConfirm(null)} onConfirm={confirmSensitive}>
          <p>Ce mode prépare une utilisation <strong>professionnelle</strong> (un service proposé à des clients) : comptes, quotas et coûts sont suivis par client.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Des services payants (IA facturée à l’usage, Browser Use Cloud) peuvent être utilisés si vous les autorisez : <strong>des coûts sont possibles</strong>, dans la limite du budget mensuel.</li>
            <li>Les abonnements personnels (claude.ai, chatgpt.com) ne sont jamais utilisés pour des clients, et la saisie manuelle est désactivée.</li>
          </ul>
          <p className="text-mist-500">Pour votre généalogie personnelle, le mode GRATUIT suffit.</p>
        </ConfirmDialog>
      )}
      {confirm === 'cloud' && (
        <ConfirmDialog title="Autoriser Browser Use Cloud ?" confirmLabel="Autoriser" busy={saving} onClose={() => setConfirm(null)} onConfirm={confirmSensitive}>
          <p>Browser Use Cloud est un <strong>service en ligne payant</strong> : la navigation se ferait sur leurs serveurs plutôt que sur votre ordinateur.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Chaque mission peut être <strong>facturée</strong> par ce service (selon votre abonnement chez lui).</li>
            <li>Les adresses visitées et ce qui est recherché (noms, dates, lieux de vos ancêtres décédés) sont <strong>transmis</strong> à ce service.</li>
            <li>Aucune personne vivante n’est jamais recherchée.</li>
          </ul>
          <p className="text-mist-500">Le navigateur sur votre ordinateur fait le même travail gratuitement.</p>
        </ConfirmDialog>
      )}
      {confirm === 'living' && (
        <ConfirmDialog title="Envoyer des données de personnes vivantes ?" confirmLabel="Autoriser l’envoi" danger busy={saving} onClose={() => setConfirm(null)} onConfirm={confirmSensitive}>
          <p>Les documents et informations concernant des <strong>personnes vivantes</strong> (noms, dates, actes, photos) pourront être <strong>transmis à l’IA externe</strong> choisie (par exemple Google Gemini) pour être lus.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Ces personnes n’ont pas forcément donné leur accord : vérifiez que vous en avez le droit.</li>
            <li>Une fois envoyées, ces données sont soumises aux conditions du fournisseur d’IA.</li>
            <li>Chaque envoi reste journalisé dans l’onglet Confidentialité, et vous pouvez retirer cette autorisation à tout moment.</li>
          </ul>
        </ConfirmDialog>
      )}
      {confirm === 'budget' && (
        <ConfirmDialog title="Autoriser des dépenses ?" confirmLabel="Autoriser et enregistrer" busy={saving} onClose={() => setConfirm(null)} onConfirm={confirmSensitive}>
          <p>Avec un budget de <strong>{num(changes.ai_monthly_budget_usd).toFixed(2).replace('.', ',')} $ par mois</strong>, des services payants pourront être utilisés (en mode HYBRIDE ou COMMERCIAL) jusqu’à ce montant.</p>
          <p>L’estimation dépend des tarifs que vous avez saisis : vérifiez-les sur la page officielle du fournisseur. Au-delà du budget, plus aucun appel payant n’est envoyé.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/** Audit Gemini : vérifie la clé et le modèle (sans appel de génération), ou teste réellement (2 appels). */
export function GeminiAudit({ onUseModel, compact = false }: { onUseModel?: (model: string) => void; compact?: boolean }) {
  const { notify, refreshSettings } = useApp()
  const [report, setReport] = useState<GeminiAuditReport | null>(null)
  const [busy, setBusy] = useState<'get' | 'probe' | 'use' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmProbe, setConfirmProbe] = useState(false)
  const run = async (probe: boolean) => {
    setBusy(probe ? 'probe' : 'get'); setError(null)
    try { setReport(probe ? await costsApi.geminiProbe() : await costsApi.geminiAudit()); if (probe) { setConfirmProbe(false); refreshSettings() } }
    catch (e) { setError(isUnavailable(e) ? 'L’audit n’est pas disponible sur ce moteur.' : errMsg(e, 'Audit impossible.')) } finally { setBusy(null) }
  }
  const useModel = async (m: string) => {
    if (onUseModel) { onUseModel(m); notify('info', `Modèle ${m} sélectionné : cliquez sur « Enregistrer » pour l’appliquer.`); return }
    setBusy('use')
    try { await api.patchSettings({ gemini_model: m }); await refreshSettings(); notify('success', `Modèle ${m} enregistré.`); setReport(await costsApi.geminiAudit()) } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const body = (
    <>
      <p className="mb-3 text-xs text-mist-500">« Vérifier » interroge seulement la liste officielle des modèles de Google avec votre clé : aucun appel de génération, aucun quota consommé.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={busy !== null} onClick={() => run(false)}>{busy === 'get' ? <Spinner /> : <Stethoscope size={15} />}Vérifier mon modèle Gemini</button>
        <button className="btn-ghost" disabled={busy !== null} onClick={() => setConfirmProbe(true)}>{busy === 'probe' ? <Spinner /> : <CircleHelp size={15} />}Tester réellement (2 appels)</button>
      </div>
      {error && <p className="mt-3 text-sm text-conf-red">{error}</p>}
      {report && (
        <div className="mt-3 space-y-2">
          <div className="text-[13px] text-night-900/80">Modèle configuré : <code className="rounded bg-ivory-200 px-1.5 py-0.5 text-[12px]">{report.configured_model}</code>{report.available_models ? ` · ${report.available_models.length} modèles disponibles sur votre compte` : ''}</div>
          <ul className="space-y-1.5">
            {report.checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                {c.ok === true ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-conf-green" /> : c.ok === false ? <XCircle size={16} className="mt-0.5 shrink-0 text-conf-red" /> : <CircleHelp size={16} className="mt-0.5 shrink-0 text-conf-orange" />}
                <span className="min-w-0 [overflow-wrap:anywhere]"><strong className="font-medium text-night-900">{c.name}</strong> — <span className="text-night-900/75">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          {report.recommended_model && report.recommended_model !== report.configured_model && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sage-300/20 px-3 py-2 text-[13px]">
              <span>Modèle recommandé : <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">{report.recommended_model}</code></span>
              <button className="btn-sage !px-2.5 !py-1 !text-[12px]" disabled={busy !== null} onClick={() => useModel(report.recommended_model!)}>{busy === 'use' ? <Spinner /> : null}Utiliser ce modèle</button>
            </div>
          )}
        </div>
      )}
      {confirmProbe && (
        <ConfirmDialog title="Tester réellement Gemini ?" confirmLabel="Lancer les 2 appels de test" busy={busy === 'probe'} onClose={() => setConfirmProbe(false)} onConfirm={() => run(true)}>
          <p>Le test envoie <strong>2 vrais appels</strong> à Google : la lecture d’une petite image noire et une recherche Google (« site des Archives nationales »). Aucune donnée personnelle n’est envoyée.</p>
          <p>Ces 2 appels comptent dans votre quota (gratuit dans le niveau gratuit de Google, en général). Si le modèle configuré n’existe plus, le modèle recommandé est enregistré automatiquement avant le test.</p>
        </ConfirmDialog>
      )}
    </>
  )
  if (compact) return <div className="mt-4 rounded-xl border border-[var(--hairline)] bg-white/60 p-3.5"><div className="mb-1 text-sm font-semibold text-night-900">Audit de la connexion Gemini</div>{body}</div>
  return <Panel title={<span className="flex items-center gap-2"><Stethoscope size={18} className="text-mist-500" />Audit Gemini</span>}>{body}</Panel>
}
