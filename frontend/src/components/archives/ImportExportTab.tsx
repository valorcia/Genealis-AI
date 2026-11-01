import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileUp, Shield } from 'lucide-react'
import { api, openExternal, type PersonSummary } from '../../api'
import { useApp } from '../../store'
import { Field, Spinner } from '../ui'
import { errMsg } from '../person/helpers'

type GedStats = { persons: number; families: number; sources: number; relations: number; events: number; warnings: string[] }

export function ImportExportTab({ persons }: { persons: PersonSummary[] }) {
  const { notify, refreshDashboard } = useApp()
  const [ged, setGed] = useState<GedStats | null>(null)
  const [csv, setCsv] = useState<{ created: number; skipped: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [hideLiving, setHideLiving] = useState(true)
  const [root, setRoot] = useState('')
  const importGed = async (f: File | undefined) => { if (!f) return; setBusy('ged'); try { const r = await api.importGedcom(f); setGed(r); notify('success', `GEDCOM importé : ${r.persons} personne(s).`); refreshDashboard() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) } }
  const importCsv = async (f: File | undefined) => { if (!f) return; setBusy('csv'); try { const r = await api.importCsv(f); setCsv(r); notify('success', `CSV importé : ${r.created} créée(s), ${r.skipped} ignorée(s).`); refreshDashboard() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) } }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel fade-up p-5">
        <h2 className="mb-1 font-display text-xl text-night-900">Importer un GEDCOM</h2>
        <p className="mb-3 text-xs text-mist-500">Format d’échange généalogique standard (.ged). Les personnes importées sont marquées « à vérifier » tant qu’aucune source n’est rattachée.</p>
        <label className="btn-primary">{busy === 'ged' ? <Spinner /> : <FileUp size={15} />}Choisir un fichier .ged<input type="file" hidden accept=".ged,.gedcom,text/plain" onChange={(e) => { importGed(e.target.files?.[0]); e.target.value = '' }} /></label>
        {ged && (
          <div className="mt-3 rounded-xl bg-ivory-100 p-3 text-sm">
            <div className="grid grid-cols-5 gap-2 text-center">{([['Personnes', ged.persons], ['Familles', ged.families], ['Sources', ged.sources], ['Liens', ged.relations], ['Événements', ged.events]] as [string, number][]).map(([l, v]) => <div key={l}><div className="font-display text-2xl text-night-900">{v}</div><div className="text-[11px] uppercase tracking-wide text-mist-500">{l}</div></div>)}</div>
            {ged.warnings.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-conf-orange">{ged.warnings.length} avertissement(s)</summary><ul className="mt-1 list-disc pl-4 text-mist-500">{ged.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          </div>
        )}
      </section>
      <section className="panel fade-up p-5">
        <h2 className="mb-1 font-display text-xl text-night-900">Importer un CSV</h2>
        <p className="mb-2 text-xs text-mist-500">Une ligne par personne, séparateur virgule ou point-virgule, en-tête obligatoire. Colonnes acceptées :</p>
        <div className="mb-3 flex flex-wrap gap-1">{['prenoms', 'nom', 'sexe', 'naissance', 'lieu_naissance', 'deces', 'lieu_deces', 'profession'].map((c) => <code key={c} className="rounded bg-ivory-200 px-1.5 py-0.5 text-xs">{c}</code>)}</div>
        <label className="btn-primary">{busy === 'csv' ? <Spinner /> : <FileUp size={15} />}Choisir un fichier .csv<input type="file" hidden accept=".csv,text/csv" onChange={(e) => { importCsv(e.target.files?.[0]); e.target.value = '' }} /></label>
        {csv && <p className="mt-3 text-sm">{csv.created} personne(s) créée(s), {csv.skipped} ligne(s) ignorée(s).</p>}
      </section>
      <section className="panel fade-up p-5 lg:col-span-2">
        <h2 className="mb-3 font-display text-xl text-night-900">Exporter</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
            <div className="font-medium">GEDCOM</div>
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={hideLiving} onChange={(e) => setHideLiving(e.target.checked)} />Masquer les personnes vivantes</label>
            <button className="btn-ghost mt-2" onClick={() => openExternal(api.exportUrl('gedcom', { hide_living: hideLiving }))}><Download size={15} />Télécharger arbre.ged</button>
          </div>
          <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
            <div className="font-medium">Tableurs</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => openExternal(api.exportUrl('persons.csv'))}><Download size={15} />personnes.csv</button>
              <button className="btn-ghost" onClick={() => openExternal(api.exportUrl('sources.csv'))}><Download size={15} />sources.csv</button>
            </div>
          </div>
          <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
            <div className="font-medium">Rapport PDF</div>
            <Field label="Personne de départ (facultatif)"><select className="input" value={root} onChange={(e) => setRoot(e.target.value)}><option value="">Racine de l’arbre</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></Field>
            <button className="btn-ghost mt-2" onClick={() => openExternal(api.exportUrl('report.pdf', { root_id: root || undefined }))}><Download size={15} />Générer le rapport</button>
          </div>
          <div className="rounded-xl border border-ivory-200 bg-white/60 p-4">
            <div className="font-medium">Sauvegarde complète</div>
            <p className="mt-1 text-xs text-mist-500">Base de données, documents et paramètres, avec chiffrement optionnel.</p>
            <Link className="btn-ghost mt-2" to="/parametres?tab=sauvegardes"><Shield size={15} />Gérer les sauvegardes</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
