import { useState, type ComponentType } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileDown, FileText, Printer } from 'lucide-react'
import { api, openExternal } from '../api'
import ChartFrame from '../components/shell/ChartFrame'
import { useFocusPerson } from '../components/shell/useFocusPerson'
import { NamedIcon } from '../navigation/icons'
import { SECTION_BY_ID } from '../navigation/sections'
import { Card, EmptyState, LoadingState, Segmented } from '../components/views/common'
import { PrintStyles, RC } from '../components/reports/ReportKit'
import { Biographie, Chronologie, EvenementsPersonnels, SynthesePersonnelle, type ReportProps } from '../components/reports/PersonReports'
import { Ascendance, Descendance, LiensDeParente, SyntheseFamiliale, SyntheseGenerationnelle } from '../components/reports/FamilyReports'
import { Cartes, Chronique, EtatDeLaBase } from '../components/reports/BaseReports'

interface ReportDef { title: string; component: ComponentType<ReportProps>; person: boolean; gens?: number; help: string }
const REPORTS: Record<string, ReportDef> = {
  'synthese-personnelle': { title: 'Synthèse personnelle', component: SynthesePersonnelle, person: true, help: 'Identité, âge, événements, famille, sources, notes et photo de la personne centrale.' },
  'evenements-personnels': { title: 'Événements personnels', component: EvenementsPersonnels, person: true, help: 'Tous les événements de la personne avec leur lieu et l’âge qu’elle avait à chacun d’eux.' },
  'liens-de-parente': { title: 'Liens de parenté', component: LiensDeParente, person: true, help: 'Toutes les personnes apparentées à la personne centrale, avec le lien exact et le degré civil.' },
  ascendance: { title: 'Ascendance', component: Ascendance, person: true, gens: 6, help: 'Liste numérotée (Sosa-Stradonitz) des ancêtres, génération par génération.' },
  chronologie: { title: 'Chronologie', component: Chronologie, person: true, help: 'Les événements de la personne et de sa famille proche, replacés dans leur contexte historique.' },
  'synthese-familiale': { title: 'Synthèse familiale', component: SyntheseFamiliale, person: true, help: 'Le couple (ou les unions) de la personne centrale : conjoints, union et tableau des enfants.' },
  descendance: { title: 'Descendance', component: Descendance, person: true, gens: 4, help: 'Liste des descendants numérotée selon le système d’Aboville (1, 1.1, 1.2…).' },
  'synthese-generationnelle': { title: 'Synthèse générationnelle', component: SyntheseGenerationnelle, person: true, gens: 8, help: 'Pour chaque génération d’ancêtres : effectif, complétude, années de naissance, durée de vie moyenne et lieux.' },
  cartes: { title: 'Cartes', component: Cartes, person: true, help: 'Les lieux de la famille, chacun avec une carte de situation dessinée hors ligne et ses événements.' },
  biographie: { title: 'Biographie', component: Biographie, person: true, gens: 3, help: 'Récit rédigé à partir des seuls faits enregistrés, avec les sources en notes.' },
  chronique: { title: 'Chronique', component: Chronique, person: false, help: 'Tous les événements de l’arbre, année par année.' },
  'etat-de-la-base': { title: 'État de la base', component: EtatDeLaBase, person: false, help: 'Bilan de votre base : effectifs, faits manquants, personnes sans source, contradictions et questions ouvertes.' },
}

function ReportIndex() {
  const tiles = SECTION_BY_ID.rapports.tiles
  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-3 px-1 text-sm text-mist-500">Choisissez un rapport :</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.id} to={t.route}>
            <Card className="flex h-full flex-col items-center gap-2 p-4 text-center transition hover:-translate-y-0.5">
              <span style={{ color: RC }}><NamedIcon name={t.icon} size={34} strokeWidth={1.6} /></span>
              <span className="text-sm font-medium" style={{ color: RC }}>{t.label}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function ReportPage() {
  const { type = '' } = useParams()
  const def = REPORTS[type]
  const { persons, focusId, focus, setFocusId, loading } = useFocusPerson()
  const [gensByType, setGens] = useState<Record<string, number>>({})
  const gens = gensByType[type] ?? def?.gens ?? 4

  if (!def) {
    return (
      <ChartFrame title="Rapports" color={RC}>
        <ReportIndex />
      </ChartFrame>
    )
  }
  const Comp = def.component
  const actions = (
    <div className="flex flex-col gap-2">
      <button className="btn-ghost justify-center" onClick={() => window.print()}><Printer size={15} /> Imprimer / PDF</button>
      {def.person && focusId && <button className="btn-ghost justify-center" onClick={() => openExternal(api.personPdfUrl(focusId))}><FileDown size={15} /> Fiche PDF de {focus?.display_name ?? 'la personne'}</button>}
      <button className="btn-ghost justify-center" onClick={() => openExternal(api.exportUrl('report.pdf', { root_id: focusId ?? undefined, generations: 6 }))}><FileText size={15} /> Livre familial PDF</button>
      <p className="text-xs text-mist-500">« Imprimer / PDF » ouvre la fenêtre d’impression : choisissez « Enregistrer au format PDF » pour obtenir un fichier A4.</p>
    </div>
  )
  const options = def.gens ? (
    <div>
      <span className="label">{type === 'descendance' ? 'Générations de descendants' : type === 'biographie' ? 'Générations d’ancêtres (récit de la lignée)' : 'Générations d’ancêtres'}</span>
      <Segmented value={String(gens)} onChange={(v) => setGens((g) => ({ ...g, [type]: Number(v) }))} color={RC}
        options={(type === 'descendance' ? [2, 3, 4, 5, 6] : type === 'biographie' ? [1, 2, 3, 4, 5] : [3, 4, 5, 6, 8, 10]).map((n) => ({ id: String(n), label: n }))} />
    </div>
  ) : undefined

  return (
    <ChartFrame title={def.title} subtitle={def.person ? focus?.display_name : undefined} color={RC}
      help={<div className="space-y-2"><p className="font-semibold" style={{ color: RC }}>{def.title}</p><p>{def.help}</p><p className="text-mist-500">Touchez 👤 pour changer de personne, « Actions » pour imprimer ou enregistrer en PDF.</p></div>}
      persons={def.person ? persons : undefined} focusId={focusId} onFocus={def.person ? setFocusId : undefined} actions={actions} options={options}>
      <PrintStyles />
      {def.person && loading && <LoadingState color={RC} />}
      {def.person && !loading && !focusId && <EmptyState icon={<FileText size={28} />} color={RC} title="Aucune personne dans l’arbre">Ajoutez une première personne pour produire ce rapport.</EmptyState>}
      {(!def.person || focusId) && !(def.person && loading) && <Comp key={`${type}-${focusId}`} focusId={focusId ?? ''} persons={persons} gens={gens} />}
    </ChartFrame>
  )
}
