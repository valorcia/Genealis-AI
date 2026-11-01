import { useMemo, useState } from 'react'
import { ExternalLink, FlaskConical, Search } from 'lucide-react'
import { api, openExternal, type ConnectorInfo } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, Spinner, formatDate } from '../ui'
import { JsonView, errMsg } from '../person/helpers'
import { ACCESS_MODE_LABEL, CONNECTOR_STATUS_CLASS, CONNECTOR_STATUS_LABEL, COUNTRY_LABEL } from './labels'

interface SearchState { busy: boolean; result: { ok: boolean; error?: string; browse_url: string | null; results: Record<string, unknown>[] } | null }

function ConnectorCard({ c, onChange }: { c: ConnectorInfo; onChange: () => void }) {
  const { notify } = useApp()
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; status: string; details: Record<string, unknown> } | null>(null)
  const [q, setQ] = useState({ surname: '', given_names: '', commune: '', year_from: '', year_to: '' })
  const [s, setS] = useState<SearchState>({ busy: false, result: null })
  const [showSearch, setShowSearch] = useState(false)
  const searchable = c.access_mode === 'api' || c.access_mode === 'html'
  const runTest = async () => {
    setTesting(true)
    try { const r = await api.testConnector(c.id); setTest(r); notify(r.ok ? 'success' : 'info', `${c.name} : ${CONNECTOR_STATUS_LABEL[r.status] ?? r.status}`); onChange() } catch (e) { notify('error', errMsg(e)) } finally { setTesting(false) }
  }
  const runSearch = async () => {
    setS({ busy: true, result: null })
    try {
      const query: Record<string, unknown> = { surname: q.surname || null, given_names: q.given_names || null, commune: q.commune || null, year_from: q.year_from ? Number(q.year_from) : null, year_to: q.year_to ? Number(q.year_to) : null }
      setS({ busy: false, result: await api.connectorSearch(c.id, query) })
    } catch (e) { setS({ busy: false, result: { ok: false, error: errMsg(e), browse_url: null, results: [] } }) }
  }
  const period = c.period_start || c.period_end ? `${c.period_start ?? '…'} – ${c.period_end ?? 'aujourd’hui'}` : null
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ivory-200 bg-white/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-night-900">{c.name}</div>
          <div className="text-xs text-mist-500">{c.organization}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="chip bg-night-900/10 text-night-900">{ACCESS_MODE_LABEL[c.access_mode] ?? c.access_mode}</span>
          <span className={`chip ${CONNECTOR_STATUS_CLASS[c.status] ?? 'conf-grey'}`}>{CONNECTOR_STATUS_LABEL[c.status] ?? c.status}</span>
          {c.requires_credentials && <span className="chip conf-orange">Compte requis</span>}
          {!c.enabled && <span className="chip conf-grey">Désactivé</span>}
        </div>
      </div>
      <div className="text-xs text-mist-500">
        {c.collections.length > 0 && <div><span className="font-semibold">Collections :</span> {c.collections.join(', ')}</div>}
        {c.areas.length > 0 && <div><span className="font-semibold">Zones :</span> {c.areas.includes('*') ? 'tout le territoire' : c.areas.join(', ')}</div>}
        {period && <div><span className="font-semibold">Période :</span> {period}</div>}
        {c.limitations.length > 0 && <div><span className="font-semibold">Limites :</span> {c.limitations.join(' · ')}</div>}
        {c.reuse_terms && <div><span className="font-semibold">Réutilisation :</span> {c.reuse_terms}{c.terms_url && <> (<button className="underline cursor-pointer" onClick={() => openExternal(c.terms_url ?? '')}>conditions</button>)</>}</div>}
        {c.notes && <div className="italic">{c.notes}</div>}
        <div>Dernier test : {c.last_test_at ? formatDate(c.last_test_at) : 'jamais'}</div>
      </div>
      {(test || Object.keys(c.test_details ?? {}).length > 0) && <JsonView value={test ? test.details : c.test_details} label="Détails du test" />}
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        <button className="btn-ghost !py-1" disabled={testing} onClick={runTest}>{testing ? <Spinner /> : <FlaskConical size={14} />}Tester</button>
        <button className="btn-ghost !py-1" onClick={() => openExternal(c.homepage)}><ExternalLink size={14} />Ouvrir le site</button>
        {searchable && <button className="btn-ghost !py-1" onClick={() => setShowSearch((v) => !v)}><Search size={14} />Rechercher</button>}
      </div>
      {searchable && showSearch && (
        <div className="rounded-lg bg-ivory-100 p-3">
          <div className="grid gap-2 sm:grid-cols-5">
            <Field label="Nom"><input className="input !py-1" value={q.surname} onChange={(e) => setQ({ ...q, surname: e.target.value })} /></Field>
            <Field label="Prénoms"><input className="input !py-1" value={q.given_names} onChange={(e) => setQ({ ...q, given_names: e.target.value })} /></Field>
            <Field label="Commune"><input className="input !py-1" value={q.commune} onChange={(e) => setQ({ ...q, commune: e.target.value })} /></Field>
            <Field label="De (année)"><input className="input !py-1" type="number" value={q.year_from} onChange={(e) => setQ({ ...q, year_from: e.target.value })} /></Field>
            <Field label="À (année)"><input className="input !py-1" type="number" value={q.year_to} onChange={(e) => setQ({ ...q, year_to: e.target.value })} /></Field>
          </div>
          <button className="btn-primary mt-2 !py-1" disabled={s.busy} onClick={runSearch}>{s.busy ? <Spinner /> : <Search size={14} />}Lancer la recherche</button>
          {s.result && (
            <div className="mt-2 text-xs">
              {!s.result.ok && <p className="text-conf-red">{s.result.error ?? 'La recherche a échoué.'}{s.result.browse_url && <> — <button className="underline cursor-pointer" onClick={() => openExternal(s.result?.browse_url ?? '')}>ouvrir le site pour chercher manuellement</button></>}</p>}
              {s.result.ok && s.result.results.length === 0 && <p className="text-mist-500">Aucun résultat.{s.result.browse_url && <> <button className="underline cursor-pointer" onClick={() => openExternal(s.result?.browse_url ?? '')}>Vérifier sur le site</button></>}</p>}
              {s.result.results.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {s.result.results.map((r, i) => (
                    <li key={i} className="rounded bg-white p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-night-900">{String(r.title ?? '')}</span>
                        {r.year !== undefined && r.year !== null && <span className="text-mist-500">({String(r.year)})</span>}
                        {typeof r.url === 'string' && <button className="underline cursor-pointer" onClick={() => openExternal(String(r.url))}>ouvrir</button>}
                      </div>
                      {typeof r.snippet === 'string' && r.snippet && <p className="text-mist-500">{r.snippet}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Connectors({ connectors, loading, onChange }: { connectors: ConnectorInfo[] | null; loading: boolean; onChange: () => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, ConnectorInfo[]>()
    ;(connectors ?? []).forEach((c) => m.set(c.country, [...(m.get(c.country) ?? []), c]))
    return [...m.entries()].sort((a, b) => (a[0] === 'FR' ? -1 : b[0] === 'FR' ? 1 : a[0].localeCompare(b[0])))
  }, [connectors])
  const all = connectors ?? []
  const stats = { total: all.length, ok: all.filter((c) => c.operational).length, browser: all.filter((c) => c.access_mode === 'browser' || c.access_mode === 'manual').length, untested: all.filter((c) => c.status === 'untested').length }
  if (connectors === null && loading) return <div className="p-4"><Spinner /></div>
  return (
    <div className="space-y-4">
      <section className="panel fade-up p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[['Connecteurs', stats.total], ['Opérationnels', stats.ok], ['Navigateur / manuel', stats.browser], ['Non testés', stats.untested]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl bg-ivory-100 p-3"><div className="font-display text-3xl text-night-900">{v}</div><div className="text-xs uppercase tracking-wide text-mist-500">{l}</div></div>
          ))}
        </div>
        <p className="mt-3 rounded-xl border border-gold-500/40 bg-gold-500/10 p-3 text-sm text-night-900">Un connecteur n’est affiché comme opérationnel qu’après un test réel réussi. Aucun contournement de CAPTCHA, d’authentification ou de protection anti-robot n’est tenté : lorsqu’un site l’exige, GENEALIS vous propose de l’ouvrir dans votre navigateur.</p>
      </section>
      {all.length === 0 && <Empty>Aucun connecteur déclaré.</Empty>}
      {groups.map(([country, items]) => (
        <section key={country} className="panel fade-up p-5">
          <h2 className="mb-3 font-display text-xl text-night-900">{COUNTRY_LABEL[country] ?? country} <span className="text-sm text-mist-500">({items.length})</span></h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((c) => <ConnectorCard key={c.id} c={c} onChange={onChange} />)}</div>
        </section>
      ))}
    </div>
  )
}
