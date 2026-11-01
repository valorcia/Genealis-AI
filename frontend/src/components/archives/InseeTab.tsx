import { useCallback, useEffect, useState } from 'react'
import { Database, Download, FolderOpen, Search } from 'lucide-react'
import { api, openExternal } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, Spinner, formatDate } from '../ui'
import { errMsg } from '../person/helpers'

type Status = { files: { name: string; lines: number; imported_at: string }[]; records: number; db_path: string }
type Resource = { title: string; url: string; year: number; month: number | null; size: number | null; format: string }
const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function InseeTab() {
  const { notify } = useApp()
  const [status, setStatus] = useState<Status | null>(null)
  const [resources, setResources] = useState<Resource[] | null>(null)
  const [resErr, setResErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [q, setQ] = useState({ surname: '', given_names: '', birth_date: '' })
  const [results, setResults] = useState<{ ok: boolean; error?: string; results: Record<string, unknown>[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const refresh = useCallback(() => api.inseeStatus().then(setStatus).catch((e: unknown) => notify('error', errMsg(e))), [notify])
  useEffect(() => { refresh(); api.inseeResources().then(setResources).catch((e: unknown) => { setResErr(errMsg(e)); setResources([]) }) }, [refresh])
  const importRes = async (r: Resource) => {
    setBusy(r.url)
    try { const res = await api.inseeImport(r.url, r.title); notify(res.started ? 'info' : 'error', res.started ? `Téléchargement de « ${res.name }» lancé : suivez l’avancement dans le journal des Enquêtes IA.` : 'L’import n’a pas pu démarrer.') } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const importLocal = async () => {
    if (!localPath.trim()) return
    setBusy('local')
    try { const r = await api.inseeImportLocal(localPath.trim()); notify('success', `${r.imported} enregistrement(s) importé(s).`); setLocalPath(''); refresh() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const search = async () => {
    setSearching(true); setResults(null)
    try { setResults(await api.connectorSearch('insee_deces_local', { surname: q.surname || null, given_names: q.given_names || null, birth_date: q.birth_date || null })) } catch (e) { setResults({ ok: false, error: errMsg(e), results: [] }) } finally { setSearching(false) }
  }
  const imported = new Set((status?.files ?? []).map((f) => f.name))
  return (
    <div className="space-y-4">
      <section className="panel fade-up p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1">
            <h2 className="font-display text-xl text-night-900">Fichier des décès INSEE (gratuit, hors ligne)</h2>
            <p className="mt-1 text-sm text-mist-500">L’INSEE publie chaque mois, en licence ouverte, la liste des personnes décédées en France depuis 1970 (nom, prénoms, sexe, date et lieu de naissance, date et lieu de décès). GENEALIS télécharge ces fichiers une fois, les indexe sur votre ordinateur et les interroge ensuite <strong>sans aucun service tiers</strong> : vos recherches restent locales.</p>
          </div>
          <div className="rounded-xl bg-ivory-100 p-3 text-center"><div className="font-display text-3xl text-night-900">{status ? status.records.toLocaleString('fr-FR') : <Spinner />}</div><div className="text-[11px] uppercase tracking-wide text-mist-500">enregistrements indexés</div></div>
        </div>
        {status && status.files.length > 0 && (
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-mist-500">{status.files.length} fichier(s) importé(s) · base : {status.db_path}</summary>
            <ul className="mt-1 list-disc pl-4 text-mist-500">{status.files.map((f) => <li key={f.name}>{f.name} — {f.lines.toLocaleString('fr-FR')} lignes, le {formatDate(f.imported_at)}</li>)}</ul></details>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel fade-up p-5">
          <h2 className="mb-2 font-display text-xl text-night-900"><Search size={16} className="mr-1 inline text-gold-600" />Recherche rapide</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Nom"><input className="input" value={q.surname} onChange={(e) => setQ({ ...q, surname: e.target.value })} /></Field>
            <Field label="Prénom"><input className="input" value={q.given_names} onChange={(e) => setQ({ ...q, given_names: e.target.value })} /></Field>
            <Field label="Date de naissance"><input className="input" type="date" value={q.birth_date} onChange={(e) => setQ({ ...q, birth_date: e.target.value })} /></Field>
          </div>
          <button className="btn-primary mt-2" disabled={searching || (!q.surname && !q.given_names && !q.birth_date)} onClick={search}>{searching ? <Spinner /> : <Search size={15} />}Rechercher</button>
          {results && (
            <div className="mt-3 text-sm">
              {!results.ok && <p className="text-conf-red">{results.error ?? 'Recherche impossible.'}</p>}
              {results.ok && results.results.length === 0 && <Empty>Aucune correspondance dans l’index local{status && status.records === 0 ? ' (aucun fichier importé pour l’instant)' : ''}.</Empty>}
              {results.results.length > 0 && <ul className="divide-y divide-ivory-200">{results.results.map((r, i) => (
                <li key={i} className="py-2"><div className="font-medium text-night-900">{String(r.title ?? '')}</div>{typeof r.snippet === 'string' && <div className="text-xs text-mist-500">{r.snippet}</div>}</li>
              ))}</ul>}
            </div>
          )}
        </section>
        <section className="panel fade-up p-5">
          <h2 className="mb-2 font-display text-xl text-night-900"><FolderOpen size={16} className="mr-1 inline text-gold-600" />Importer un fichier déjà téléchargé</h2>
          <p className="mb-2 text-xs text-mist-500">Chemin complet d’un fichier INSEE (.txt ou .zip) présent sur votre disque.</p>
          <div className="flex gap-2"><input className="input" value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="ex. /home/moi/Téléchargements/deces-2024-m01.txt" /><button className="btn-primary" disabled={busy === 'local' || !localPath.trim()} onClick={importLocal}>{busy === 'local' ? <Spinner /> : <Database size={15} />}Importer</button></div>
        </section>
      </div>
      <section className="panel fade-up p-5">
        <h2 className="mb-2 font-display text-xl text-night-900"><Download size={16} className="mr-1 inline text-gold-600" />Fichiers disponibles en ligne</h2>
        {resources === null && <Spinner />}
        {resErr && <Empty>Liste indisponible : {resErr}. Vous pouvez télécharger les fichiers manuellement sur <button className="underline cursor-pointer" onClick={() => openExternal('https://www.data.gouv.fr/fr/datasets/fichier-des-personnes-decedees/')}>data.gouv.fr</button> puis les importer ci-dessus.</Empty>}
        {resources && resources.length > 0 && (
          <div className="max-h-96 overflow-auto scrollbar-thin"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-mist-500"><th className="py-2 pr-3">Période</th><th className="py-2 pr-3">Fichier</th><th className="py-2 pr-3">Taille</th><th className="py-2"></th></tr></thead>
            <tbody>{resources.map((r) => (
              <tr key={r.url} className="border-t border-ivory-200">
                <td className="py-2 pr-3 font-medium">{r.month ? `${MONTHS[r.month]} ${r.year}` : String(r.year)}</td>
                <td className="py-2 pr-3 text-xs text-mist-500">{r.title} · {r.format}</td>
                <td className="py-2 pr-3">{r.size ? `${(r.size / 1_000_000).toFixed(1)} Mo` : '—'}</td>
                <td className="py-2 text-right">{imported.has(r.title) ? <span className="chip conf-green">Importé</span> : <button className="btn-ghost !py-1" disabled={busy !== null} onClick={() => importRes(r)}>{busy === r.url ? <Spinner /> : <Download size={14} />}Télécharger et importer</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  )
}
