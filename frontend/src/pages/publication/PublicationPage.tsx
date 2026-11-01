import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AlertTriangle, BookOpen, CheckCircle2, DatabaseBackup, Download, ExternalLink, FileDown, FileSpreadsheet, GitBranchMinus, GitBranchPlus, Globe, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api, openExternal, type PersonSummary } from '../../api'
import { useApp } from '../../store'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { PageFrame } from '../../components/lists/ListKit'
import { Spinner } from '../../components/ui'
import { COLORS, Card, PersonAvatar, PersonPickerSheet, Segmented, Toggle, errorText, lifeYears, useLoader } from '../../components/views/common'

const PC = COLORS.publication
const isTauri = () => !!(window as unknown as { __TAURI__?: unknown }).__TAURI__

/** Bouton de téléchargement : lien direct (navigateur, iPhone) ou ouverture externe (application de bureau). */
function DownloadButton({ href, children, tone = 'primary', disabled = false }: { href: string; children: ReactNode; tone?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  const cls = tone === 'primary' ? 'text-white shadow-[0_8px_20px_-10px_rgba(138,53,184,0.9)]' : tone === 'danger' ? 'bg-[#ff3b30] text-white' : 'bg-black/[0.05] text-night-900'
  return (
    <a href={disabled ? undefined : href} download onClick={(e) => { if (disabled) { e.preventDefault(); return } if (isTauri()) { e.preventDefault(); openExternal(href) } }}
      aria-disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[15px] font-semibold transition active:scale-[0.98] ${cls} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      style={tone === 'primary' ? { background: `linear-gradient(160deg, #a24fd3, ${PC})` } : undefined}>
      {children}
    </a>
  )
}

function Hero({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="mb-3 flex items-start gap-4 p-5">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] text-white shadow-md" style={{ background: `linear-gradient(160deg, #b066dd, ${PC})` }}>{icon}</span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-night-900">{title}</h2>
        <div className="mt-0.5 text-sm leading-relaxed text-mist-500">{children}</div>
      </div>
    </Card>
  )
}

function PersonChooser({ focus, persons, onPick, label = 'Personne de départ' }: { focus: PersonSummary | null; persons: PersonSummary[]; onPick: (id: string) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <span className="label">{label}</span>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-2xl bg-black/[0.04] px-3 py-2.5 text-left transition hover:bg-black/[0.06]">
        {focus ? <PersonAvatar p={focus} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10"><UserRound size={20} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-night-900">{focus?.display_name ?? 'Choisir une personne'}</span>
          {focus && <span className="block text-xs text-mist-500">{lifeYears(focus) || 'dates inconnues'}</span>}
        </span>
        <span className="text-sm font-semibold" style={{ color: PC }}>Changer</span>
      </button>
      {open && <PersonPickerSheet persons={persons} currentId={focus?.id} onPick={onPick} onClose={() => setOpen(false)} color={PC} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
function SiteExport() {
  const hosts = [
    { name: 'Netlify Drop', url: 'https://app.netlify.com/drop', steps: ['Décompressez le fichier zip téléchargé.', 'Ouvrez Netlify Drop et glissez-déposez le dossier.', 'Votre site est en ligne immédiatement, avec une adresse publique (compte gratuit pour la conserver).'] },
    { name: 'GitHub Pages', url: 'https://pages.github.com/', steps: ['Créez un dépôt public sur GitHub.', 'Téléversez le contenu du dossier décompressé (bouton « Add file › Upload files »).', 'Dans « Settings › Pages », choisissez la branche principale : le site est publié en quelques minutes.'] },
    { name: 'Vercel', url: 'https://vercel.com/new', steps: ['Créez un compte gratuit sur Vercel.', 'Importez le dossier décompressé (ou lancez « npx vercel » dans ce dossier).', 'Vercel vous donne une adresse en .vercel.app, personnalisable.'] },
  ]
  return (
    <>
      <Hero icon={<Globe size={28} />} title="Votre arbre en site internet">
        GENEALIS génère un site statique complet : une page par personne, un index alphabétique, l’ascendance et les sources. Il fonctionne sans serveur ni base de données et peut être hébergé gratuitement.
      </Hero>
      <Card className="mb-3 p-5">
        <ul className="mb-4 space-y-2 text-sm text-night-900">
          {['Fichier zip de pages HTML, prêtes à publier', 'Personnes vivantes masquées automatiquement (nom remplacé, aucune date)', 'Lisible sur ordinateur et sur téléphone', 'Aucune donnée envoyée tant que vous ne publiez pas le dossier vous-même'].map((t) => (
            <li key={t} className="flex gap-2"><CheckCircle2 size={18} className="shrink-0" style={{ color: PC }} />{t}</li>
          ))}
        </ul>
        <DownloadButton href={api.siteExportUrl()}><Download size={18} /> Télécharger le site (.zip)</DownloadButton>
      </Card>
      <h3 className="mb-2 mt-5 px-2 text-[13px] font-semibold uppercase tracking-wide text-mist-500">Publier gratuitement</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {hosts.map((h) => (
          <Card key={h.name} className="flex flex-col p-4">
            <h4 className="font-semibold" style={{ color: PC }}>{h.name}</h4>
            <ol className="mt-2 flex-1 list-decimal space-y-1 pl-4 text-[13px] leading-snug text-night-900">{h.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <button onClick={() => openExternal(h.url)} className="mt-3 inline-flex items-center gap-1 self-start rounded-full bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium" style={{ color: PC }}>Ouvrir {h.name} <ExternalLink size={13} /></button>
          </Card>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
function GedcomExport() {
  const [hide, setHide] = useState(true)
  return (
    <>
      <Hero icon={<FileDown size={28} />} title="Exportation GEDCOM">
        Le format universel de la généalogie : ouvrez votre arbre dans MacFamilyTree, Heredis, Geneanet, Ancestry, Gramps… Le fichier contient personnes, familles, événements, lieux et sources.
      </Hero>
      <Card className="mb-3 space-y-3 p-5">
        <Toggle checked={hide} onChange={setHide} label={<span><b>Masquer les personnes vivantes</b><span className="block text-xs text-mist-500">Recommandé avant de partager le fichier ou de le publier en ligne.</span></span>} color={PC} />
        <DownloadButton href={api.exportUrl('gedcom', { hide_living: hide })}><Download size={18} /> Télécharger le GEDCOM</DownloadButton>
      </Card>
      <h3 className="mb-2 mt-5 px-2 text-[13px] font-semibold uppercase tracking-wide text-mist-500">Autres formats</h3>
      <Card className="grid gap-2 p-4 sm:grid-cols-3">
        <DownloadButton href={api.exportUrl('persons.csv')} tone="ghost"><FileSpreadsheet size={17} /> Personnes (CSV)</DownloadButton>
        <DownloadButton href={api.exportUrl('sources.csv')} tone="ghost"><FileSpreadsheet size={17} /> Sources (CSV)</DownloadButton>
        <DownloadButton href={api.exportJsonUrl()} tone="ghost"><DatabaseBackup size={17} /> Sauvegarde complète (JSON)</DownloadButton>
      </Card>
      <p className="mt-2 px-2 text-xs text-mist-500">Les fichiers CSV s’ouvrent dans Excel, Numbers ou LibreOffice. La sauvegarde JSON permet de tout restaurer dans GENEALIS.</p>
    </>
  )
}

/* ------------------------------------------------------------------ */
type Scope = 'ancestors' | 'descendants' | 'both'
function SubtreeExport() {
  const { persons, focus, focusId, setFocusId, loading } = useFocusPerson()
  const [scope, setScope] = useState<Scope>('ancestors')
  const [hide, setHide] = useState(true)
  const count = useLoader(async () => {
    const ids = new Set<string>([focusId!])
    if (scope !== 'descendants') (await api.ancestors(focusId!, 30)).nodes.forEach((n) => ids.add(n.id))
    if (scope !== 'ancestors') (await api.descendants(focusId!, 30)).nodes.forEach((n) => ids.add(n.id))
    return ids.size
  }, [focusId, scope], !!focusId)
  return (
    <>
      <Hero icon={<GitBranchPlus size={28} />} title="Exporter un sous-arbre">
        Partagez seulement une branche : les ancêtres d’une personne, ses descendants, ou les deux. Idéal pour envoyer sa lignée à un cousin.
      </Hero>
      <Card className="space-y-4 p-5">
        {loading ? <Spinner /> : <PersonChooser focus={focus} persons={persons} onPick={setFocusId} />}
        <div><span className="label">Branche à exporter</span><Segmented value={scope} onChange={setScope} color={PC} options={[{ id: 'ancestors', label: 'Ancêtres' }, { id: 'descendants', label: 'Descendants' }, { id: 'both', label: 'Les deux' }]} /></div>
        <Toggle checked={hide} onChange={setHide} label="Masquer les personnes vivantes" color={PC} />
        <div className="rounded-2xl bg-[#f6effa] px-4 py-3 text-sm">
          {count.loading ? <span className="text-mist-500">Calcul…</span> : count.error ? <span className="text-conf-red">{count.error}</span> : <><b className="text-lg" style={{ color: PC }}>{count.data ?? 0}</b> personne{(count.data ?? 0) > 1 ? 's' : ''} dans cette branche{focus ? ` (${focus.display_name} incluse)` : ''}.</>}
        </div>
        <DownloadButton href={focusId ? api.gedcomSubtreeUrl(focusId, scope, hide) : '#'} disabled={!focusId}><Download size={18} /> Télécharger la branche (GEDCOM)</DownloadButton>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */
function SubtreeDelete() {
  const { persons, focus, focusId, setFocusId, loading, reload } = useFocusPerson()
  const notify = useApp((s) => s.notify)
  const refreshDashboard = useApp((s) => s.refreshDashboard)
  const [scope, setScope] = useState<'descendants' | 'ancestors'>('descendants')
  const [includeSelf, setIncludeSelf] = useState(false)
  const [preview, setPreview] = useState<{ would_delete: number; names: string[] } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'delete' | null>(null)
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setPreview(null); setConfirm(''); setErr(null) }, [focusId, scope, includeSelf])

  const doPreview = async () => {
    if (!focusId) return
    setBusy('preview'); setErr(null); setDone(null)
    try { setPreview(await api.previewSubtreeDelete(focusId, scope, includeSelf)) } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }
  const doDelete = async () => {
    if (!focusId || confirm !== 'SUPPRIMER') return
    setBusy('delete'); setErr(null)
    try {
      const r = await api.deleteSubtree(focusId, scope, includeSelf)
      setDone(r.deleted); setPreview(null); setConfirm('')
      notify('success', `${r.deleted} fiche${r.deleted > 1 ? 's' : ''} supprimée${r.deleted > 1 ? 's' : ''}.`)
      reload(); refreshDashboard()
    } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <Hero icon={<GitBranchMinus size={28} />} title="Supprimer un sous-arbre">
        Retire de votre base toute une branche : les ancêtres ou les descendants d’une personne. Utile pour nettoyer une branche importée par erreur.
      </Hero>
      <div className="mb-3 flex gap-3 rounded-[22px] border border-[#ff3b30]/25 bg-[#fff1f0] p-4 text-sm text-[#8a1f17]">
        <AlertTriangle size={22} className="shrink-0 text-[#ff3b30]" />
        <div>
          <p className="font-bold">Action définitive et irréversible.</p>
          <p className="mt-0.5">Les fiches, leurs événements, liens familiaux et citations seront effacés. <b>Téléchargez d’abord une sauvegarde</b> : vous pourrez la réimporter en cas d’erreur.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <DownloadButton href={api.exportUrl('gedcom', { hide_living: false })} tone="ghost"><Download size={15} /> Sauvegarde GEDCOM complète</DownloadButton>
            <Link to="/parametres?tab=sauvegardes" className="inline-flex items-center gap-2 rounded-2xl bg-black/[0.05] px-4 py-3 text-[15px] font-semibold text-night-900"><ShieldCheck size={16} /> Sauvegardes automatiques</Link>
          </div>
        </div>
      </div>
      <Card className="space-y-4 p-5">
        {loading ? <Spinner /> : <PersonChooser focus={focus} persons={persons} onPick={setFocusId} label="À partir de" />}
        <div><span className="label">Branche à supprimer</span><Segmented value={scope} onChange={setScope} color="#d6332a" options={[{ id: 'descendants', label: 'Ses descendants' }, { id: 'ancestors', label: 'Ses ancêtres' }]} /></div>
        <Toggle checked={includeSelf} onChange={setIncludeSelf} label={`Supprimer aussi ${focus?.display_name ?? 'cette personne'}`} color="#ff3b30" />
        {!preview && <button onClick={doPreview} disabled={!focusId || busy !== null} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-black/[0.06] px-4 py-3 text-[15px] font-semibold text-night-900 disabled:opacity-50">{busy === 'preview' ? <Spinner /> : null} Voir les fiches concernées</button>}
        {preview && (
          <div className="fade-up space-y-3">
            {preview.would_delete === 0 ? (
              <p className="rounded-2xl bg-black/[0.04] p-3 text-sm text-mist-500">Aucune fiche à supprimer pour cette branche.</p>
            ) : (
              <>
                <div className="rounded-2xl bg-[#fff1f0] p-3">
                  <p className="text-[15px] font-bold text-[#c4302b]">{preview.would_delete} fiche{preview.would_delete > 1 ? 's' : ''} {preview.would_delete > 1 ? 'seront supprimées' : 'sera supprimée'} définitivement</p>
                  <ul className="mt-2 max-h-48 overflow-auto rounded-xl bg-white p-2 text-[13px] ring-1 ring-black/5">
                    {preview.names.map((n, i) => <li key={i} className="border-b border-black/5 py-1 last:border-0">{n}</li>)}
                  </ul>
                </div>
                <label className="block">
                  <span className="label">Pour confirmer, tapez SUPPRIMER</span>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SUPPRIMER" className="input text-center font-mono tracking-[0.2em]" />
                </label>
                <button onClick={doDelete} disabled={confirm !== 'SUPPRIMER' || busy !== null} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff3b30] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(255,59,48,0.9)] disabled:opacity-40">
                  {busy === 'delete' ? <Spinner /> : <Trash2 size={17} />} Supprimer définitivement {preview.would_delete} fiche{preview.would_delete > 1 ? 's' : ''}
                </button>
                <button onClick={() => setPreview(null)} className="w-full text-center text-sm font-medium text-mist-500">Annuler</button>
              </>
            )}
          </div>
        )}
        {err && <p className="rounded-2xl bg-[#fff1f0] p-3 text-sm text-[#c4302b]">{err}</p>}
        {done !== null && <p className="flex items-center gap-2 rounded-2xl bg-[#e9f8ee] p-3 text-sm text-[#1f7a3d]"><CheckCircle2 size={17} /> {done} fiche{done > 1 ? 's' : ''} supprimée{done > 1 ? 's' : ''}.</p>}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */
function PdfBook() {
  const { persons, focus, focusId, setFocusId, loading } = useFocusPerson()
  const [gens, setGens] = useState('6')
  return (
    <>
      <Hero icon={<BookOpen size={28} />} title="Livre familial PDF">
        Un document à imprimer ou à offrir : ascendance numérotée, fiches des ancêtres génération par génération, récits et sources.
      </Hero>
      <Card className="space-y-4 p-5">
        {loading ? <Spinner /> : <PersonChooser focus={focus} persons={persons} onPick={setFocusId} label="Personne principale du livre" />}
        <div><span className="label">Générations d’ancêtres</span><Segmented value={gens} onChange={setGens} color={PC} options={['3', '4', '5', '6', '8', '10'].map((n) => ({ id: n, label: n }))} /></div>
        <DownloadButton href={focusId ? api.exportUrl('report.pdf', { root_id: focusId, generations: Number(gens) }) : '#'} disabled={!focusId}><Download size={18} /> Télécharger le livre PDF</DownloadButton>
        {focusId && <DownloadButton href={api.personPdfUrl(focusId)} tone="ghost"><FileDown size={17} /> Fiche individuelle de {focus?.display_name ?? 'la personne'} (PDF)</DownloadButton>}
      </Card>
      <p className="mt-2 px-2 text-xs text-mist-500">Astuce : chaque rapport (Rapports › …) peut aussi être imprimé ou enregistré en PDF depuis son menu « Actions ».</p>
    </>
  )
}

const PAGES: Record<string, { title: string; component: () => ReactNode }> = {
  site: { title: 'Site internet', component: SiteExport },
  gedcom: { title: 'Exportation GEDCOM', component: GedcomExport },
  'exporter-sous-arbre': { title: 'Exporter un sous-arbre', component: SubtreeExport },
  'supprimer-sous-arbre': { title: 'Supprimer un sous-arbre', component: SubtreeDelete },
  pdf: { title: 'Livre PDF', component: PdfBook },
}

export default function PublicationPage() {
  const { type = '' } = useParams()
  const page = PAGES[type]
  if (!page) return <Navigate to="/section/publication" replace />
  const Comp = page.component
  return (
    <PageFrame title={page.title} color={PC} wide={type === 'site'}>
      <div className="fade-up"><Comp key={type} /></div>
    </PageFrame>
  )
}
