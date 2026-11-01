/** Coûts et quotas des appels IA : appels du jour et du mois, cache, plafonds, coût estimé, historique, modes. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CalendarDays, Coins, Database, Gauge, Hourglass, RefreshCw, Settings2, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import { errMsg } from '../components/person/helpers'
import { ConfirmDialog, Loading, Notice, clockTime, parseTs } from '../components/investigation/common'
import { CallsChart } from '../components/investigation/CallsChart'
import { CALL_STATUS_CLASS, CALL_STATUS_LABEL, PURPOSE_LABEL, costsApi, formatInt, formatUsd, type CostCall, type CostSummary } from '../lib/costsApi'

export default function CostsPage() {
  const { notify } = useApp()
  const [sum, setSum] = useState<CostSummary | null>(null)
  const [calls, setCalls] = useState<CostCall[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'unblock' | 'cache' | null>(null)

  const load = useCallback(() => {
    costsApi.summary().then((s) => { setSum(s); setError(null) }).catch((e: unknown) => setError(errMsg(e, 'Impossible de charger les coûts.')))
    costsApi.calls(40).then(setCalls).catch(() => setCalls([]))
  }, [])
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000); return () => clearInterval(t) }, [load])

  const unblock = async () => {
    setBusy('unblock')
    try { setSum(await costsApi.unblock()); notify('success', 'Suspension levée. Les appels IA peuvent reprendre.'); setConfirm(null) } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const clearCache = async () => {
    setBusy('cache')
    try { const r = await costsApi.clearCache(); notify('success', `Cache vidé (${r.deleted} réponse${r.deleted > 1 ? 's' : ''} supprimée${r.deleted > 1 ? 's' : ''}).`); setConfirm(null); load() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <header className="fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow text-gold-600">Recherche IA</div>
          <h1 className="font-display text-3xl text-night-900">Coûts et quotas</h1>
          <p className="mt-1 max-w-2xl text-sm text-night-900/75">Chaque appel à l’IA est compté. Les plafonds sont vérifiés <strong>avant</strong> chaque envoi : rien n’est dépensé au-delà de ce que vous avez fixé.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load}><RefreshCw size={15} />Actualiser</button>
          <Link to="/parametres?tab=enquetes" className="btn-ghost"><Settings2 size={15} />Réglages</Link>
        </div>
      </header>

      {error && <Notice tone="error" title="Coûts indisponibles">{error}</Notice>}
      {!sum && !error && <Loading />}
      {sum && (
        <>
          {sum.quota_blocked_until && (
            <Notice tone="warn" title="Appels IA suspendus pour l’instant"
              action={<button className="btn-ghost" onClick={() => setConfirm('unblock')}>Lever la suspension</button>}>
              Google a signalé que le quota gratuit est atteint. Les appels reprendront automatiquement vers {clockTime(sum.quota_blocked_until).slice(0, 5)} ({new Date(parseTs(sum.quota_blocked_until)).toLocaleDateString('fr-FR')}).
              Les enquêtes concernées sont en pause, sans rien perdre.
            </Notice>
          )}

          <ModeCard sum={sum} />

          <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Tile icon={<Zap size={14} />} label="Appels aujourd’hui" value={formatInt(sum.today.calls)} hint={`plafond ${sum.limits.daily} / jour`} meter={sum.limits.daily ? sum.today.calls / sum.limits.daily : 0} />
            <Tile icon={<CalendarDays size={14} />} label="Appels ce mois" value={formatInt(sum.month.calls)} />
            <Tile icon={<Database size={14} />} label="Évités par le cache" value={formatInt(sum.today.cache_hits)} hint={`${formatInt(sum.month.cache_hits)} ce mois`} />
            <Tile icon={<Ban size={14} />} label="Refusés (plafond)" value={formatInt(sum.today.refused)} hint="aujourd’hui, sans rien envoyer" />
            <Tile icon={<Hourglass size={14} />} label="Erreurs" value={formatInt(sum.today.errors)} hint="aujourd’hui" />
            <Tile icon={<Coins size={14} />} label="Coût estimé (mois)" value={sum.prices_configured ? formatUsd(sum.month.estimated_cost_usd) : '—'} hint={sum.prices_configured ? (sum.limits.monthly_budget_usd ? `budget ${formatUsd(sum.limits.monthly_budget_usd)}` : 'aucun budget payant') : 'tarif non renseigné'} />
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="panel min-w-0 p-4 sm:p-5">
              <h2 className="font-display text-xl text-night-900">Appels envoyés, 14 derniers jours</h2>
              <p className="mb-2 text-xs text-mist-500">Les réponses reprises du cache et les appels refusés ne sont pas comptés ici.</p>
              <CallsChart byDay={sum.by_day} dailyLimit={sum.limits.daily} />
            </section>
            <section className="panel min-w-0 p-4 sm:p-5">
              <h2 className="mb-2 font-display text-xl text-night-900">Répartition par usage (mois)</h2>
              {sum.by_purpose.length === 0 ? <p className="text-sm text-mist-500">Aucun appel ce mois-ci.</p> : (
                <ul className="space-y-2">
                  {sum.by_purpose.map((p) => {
                    const max = Math.max(...sum.by_purpose.map((x) => x.calls), 1)
                    return (
                      <li key={p.purpose} className="text-[13px]">
                        <div className="flex justify-between gap-2"><span className="min-w-0 truncate text-night-900">{PURPOSE_LABEL[p.purpose] ?? p.purpose}</span><span className="shrink-0 tabular-nums text-mist-500">{p.calls}{sum.prices_configured && p.cost_usd ? ` · ${formatUsd(p.cost_usd)}` : ''}</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-mist-200"><div className="h-full rounded-full bg-ios-blue" style={{ width: `${(p.calls / max) * 100}%` }} /></div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="panel p-4 sm:p-5">
              <h2 className="mb-2 flex items-center gap-2 font-display text-xl text-night-900"><Gauge size={18} className="text-mist-500" />Plafonds en vigueur</h2>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-night-900/75">Appels par jour</dt><dd className="text-right tabular-nums font-medium">{sum.limits.daily}</dd>
                <dt className="text-night-900/75">Appels par minute</dt><dd className="text-right tabular-nums font-medium">{sum.limits.per_minute}</dd>
                <dt className="text-night-900/75">Appels par enquête</dt><dd className="text-right tabular-nums font-medium">{sum.limits.investigation}</dd>
                <dt className="text-night-900/75">Appels simultanés</dt><dd className="text-right tabular-nums font-medium">{sum.limits.concurrency}</dd>
                <dt className="text-night-900/75">Budget payant mensuel</dt><dd className="text-right tabular-nums font-medium">{sum.limits.monthly_budget_usd ? formatUsd(sum.limits.monthly_budget_usd) : 'aucun (0 $)'}</dd>
              </dl>
              <p className="mt-3 text-xs text-mist-500">Le quota réel du niveau gratuit dépend de votre compte Google ; ces plafonds évitent de l’atteindre.</p>
            </section>
            <section className="panel p-4 sm:p-5">
              <h2 className="mb-2 flex items-center gap-2 font-display text-xl text-night-900"><Database size={18} className="text-mist-500" />Cache des réponses</h2>
              <p className="text-[13px] text-night-900/80">{sum.cache.enabled ? 'Activé : un même document ou une même question n’est jamais renvoyé deux fois à l’IA.' : 'Désactivé : chaque question est renvoyée à l’IA.'}</p>
              <div className="mt-2 flex gap-6 text-[13px]"><span><strong className="tabular-nums">{formatInt(sum.cache.entries)}</strong> réponses gardées</span><span><strong className="tabular-nums">{formatInt(sum.cache.hits_total)}</strong> appels évités au total</span></div>
              <div className="mt-2 text-[12px] text-mist-500">Jetons ce mois : {formatInt(sum.month.input_tokens)} envoyés · {formatInt(sum.month.output_tokens)} reçus{sum.month.thinking_tokens ? ` · ${formatInt(sum.month.thinking_tokens)} de réflexion` : ''}</div>
              <button className="btn-ghost mt-3 !text-[13px]" disabled={!sum.cache.entries} onClick={() => setConfirm('cache')}><Trash2 size={14} />Vider le cache</button>
            </section>
          </div>

          {!sum.prices_configured && (
            <Notice title="Tarif non renseigné">
              Les prix des modèles changent souvent : l’application ne les invente pas. Tant que vous n’avez pas saisi un tarif (page officielle de Google), le coût estimé reste inconnu.
              Dans le mode GRATUIT, aucun service payant n’est utilisé de toute façon. <Link className="font-medium text-ios-blue" to="/parametres?tab=enquetes">Saisir un tarif</Link>
            </Notice>
          )}

          <section className="panel min-w-0 p-4 sm:p-5">
            <h2 className="mb-2 font-display text-xl text-night-900">Derniers appels</h2>
            {calls === null ? <Spinner /> : calls.length === 0 ? <p className="text-sm text-mist-500">Aucun appel enregistré pour l’instant.</p> : (
              <div className="-mx-1 overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-[0.08em] text-mist-500">
                    <tr><th className="px-1 py-1.5 font-semibold">Heure</th><th className="px-1 font-semibold">Usage</th><th className="px-1 font-semibold">Modèle</th><th className="px-1 font-semibold">Résultat</th><th className="px-1 text-right font-semibold">Jetons</th><th className="px-1 text-right font-semibold">Coût</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--hairline)]">
                    {calls.map((c) => (
                      <tr key={c.id} title={c.error ?? undefined}>
                        <td className="whitespace-nowrap px-1 py-1.5 tabular-nums text-mist-500">{new Date(parseTs(c.ts)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {clockTime(c.ts).slice(0, 5)}</td>
                        <td className="px-1 text-night-900">{PURPOSE_LABEL[c.purpose] ?? c.purpose}{c.web_search ? ' · recherche Google' : ''}{c.attachments ? ` · ${c.attachments} image${c.attachments > 1 ? 's' : ''}` : ''}{c.investigation_id && <Link to={`/investigation/${c.investigation_id}`} className="ml-1 text-ios-blue">enquête</Link>}</td>
                        <td className="max-w-[160px] truncate px-1 text-mist-500">{c.model ?? c.provider}</td>
                        <td className="px-1"><span className={`chip ${CALL_STATUS_CLASS[c.status] ?? 'conf-grey'}`}>{CALL_STATUS_LABEL[c.status] ?? c.status}</span></td>
                        <td className="px-1 text-right tabular-nums text-mist-500">{c.input_tokens + c.output_tokens + c.thinking_tokens ? formatInt(c.input_tokens + c.output_tokens + c.thinking_tokens) : '—'}</td>
                        <td className="px-1 text-right tabular-nums text-mist-500">{sum.prices_configured ? formatUsd(c.estimated_cost_usd) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {confirm === 'unblock' && (
        <ConfirmDialog title="Lever la suspension ?" confirmLabel="Lever la suspension" busy={busy === 'unblock'} onClose={() => setConfirm(null)} onConfirm={unblock}>
          <p>Google a demandé une pause parce que le quota était atteint. Ne levez la suspension que si vous savez que le quota est rétabli (par exemple le lendemain).</p>
          <p className="text-mist-500">Sinon, les appels échoueront de nouveau. Aucune dépense n’est engagée par cette action.</p>
        </ConfirmDialog>
      )}
      {confirm === 'cache' && (
        <ConfirmDialog title="Vider le cache ?" confirmLabel="Vider le cache" busy={busy === 'cache'} onClose={() => setConfirm(null)} onConfirm={clearCache}>
          <p>Les réponses déjà obtenues seront oubliées : si l’IA doit relire les mêmes documents, cela consommera de nouveaux appels.</p>
          <p className="text-mist-500">Vos documents, transcriptions et découvertes ne sont pas supprimés.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function Tile({ icon, label, value, hint, meter }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; meter?: number }) {
  return (
    <div className="paper min-w-0 p-3.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-mist-500">{icon}<span className="truncate">{label}</span></div>
      <div className="mt-1 font-display text-[26px] leading-none tabular-nums text-night-900">{value}</div>
      {meter !== undefined && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist-200"><div className="h-full rounded-full" style={{ width: `${Math.min(100, meter * 100)}%`, background: meter >= 0.9 ? 'var(--color-conf-orange)' : 'var(--color-ios-blue)' }} /></div>}
      {hint && <div className="mt-1 text-[11px] leading-snug text-mist-500">{hint}</div>}
    </div>
  )
}

function ModeCard({ sum }: { sum: CostSummary }) {
  const order = ['free', 'hybrid', 'commercial'].filter((k) => sum.modes[k])
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl text-night-900"><ShieldCheck size={18} className="text-sage-500" />Mode actuel : {sum.mode_label}</h2>
        <Link to="/parametres?tab=enquetes" className="text-[13px] font-medium text-ios-blue">Changer de mode</Link>
      </div>
      <div className="mt-3 grid gap-2.5 md:grid-cols-3">
        {order.map((k) => (
          <div key={k} className={`rounded-xl border p-3 ${k === sum.mode ? 'border-sage-500/50 bg-sage-300/20' : 'border-[var(--hairline)] bg-white/70'}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-bold tracking-[0.08em] text-night-900">{sum.modes[k].label}</span>{k === sum.mode && <span className="chip conf-green">actif</span>}</div>
            <p className="mt-1 text-[12px] leading-snug text-night-900/75">{sum.modes[k].description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
