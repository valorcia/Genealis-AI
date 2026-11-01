import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, HelpCircle, Play, Sparkles, Pause } from 'lucide-react'
import { api, type Dashboard, type QuestionOut } from '../../api'
import { useApp, pulseEngine } from '../../store'
import { Spinner } from '../ui'

/** Bandeau « Que se passe-t-il ? » : une phrase d'état et l'action la plus utile, pour un utilisateur novice. */
export default function GuidedHome({ data }: { data: Dashboard }) {
  const { notify, refreshDashboard, settings } = useApp()
  const [question, setQuestion] = useState<QuestionOut | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.questions('pending').then((q) => setQuestion(q[0] ?? null)).catch(() => {}) }, [data.questions_pending])
  const active = data.tasks_running + data.tasks_queued
  const paused = Boolean(settings?.research_pause)
  const launch = async () => {
    setBusy(true)
    try {
      const pr = await api.priorities()
      let n = 0
      for (const p of pr.slice(0, 3)) { n += (await api.explore(p.person_id, 2)).length }
      pulseEngine()
      await refreshDashboard()
      notify('success', n ? `${n} recherche(s) planifiée(s). Le moteur travaille ; vous serez consulté seulement si nécessaire.` : 'Rien de nouveau à chercher pour l’instant : ajoutez une personne ou un document.')
    } catch { notify('error', 'Impossible de lancer les recherches.') } finally { setBusy(false) }
  }
  const status = paused ? 'Les recherches sont en pause.'
    : active > 0 ? `GENEALIS enquête : ${active} recherche(s) en cours ou en attente.`
    : data.questions_pending > 0 ? `GENEALIS a besoin de vous : ${data.questions_pending} question(s) attendent votre réponse.`
    : data.tasks_waiting > 0 ? `${data.tasks_waiting} recherche(s) attendent votre accord (mode assisté).`
    : data.persons === 0 ? 'Commencez par vous présenter : l’assistant créera vos premières fiches.'
    : 'Tout est à jour. Lancez une nouvelle vague de recherches quand vous voulez.'
  return (
    <section className="panel fade-up flex flex-col gap-4 border-gold-500/40 bg-gradient-to-br from-ivory-50 to-ivory-100 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-night-900 p-2 text-gold-400"><Compass size={20} /></div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-mist-500">Que se passe-t-il ?</div>
          <p className="font-display text-xl leading-snug text-night-900">{status}</p>
          {question && data.questions_pending > 0 && <p className="mt-1 text-sm text-mist-500">Prochaine question : « {question.title} »</p>}
          <p className="mt-1 text-xs text-mist-500">Le moteur n’invente jamais rien : il enregistre seulement ce qui est prouvé par des sources, et vous demande votre avis pour le reste.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
        {data.questions_pending > 0 && <Link to="/questions" className="btn-gold justify-center"><HelpCircle size={15} /> Répondre ({data.questions_pending})</Link>}
        {data.tasks_waiting > 0 && <Link to="/enquetes" className="btn-primary justify-center"><Play size={15} /> Approuver les recherches ({data.tasks_waiting})</Link>}
        {data.persons === 0 ? <Link to="/bienvenue" className="btn-primary justify-center"><Sparkles size={15} /> Commencer</Link>
          : <button onClick={launch} disabled={busy || paused} className={`${data.questions_pending > 0 ? 'btn-ghost' : 'btn-primary'} justify-center`}>{busy ? <Spinner /> : paused ? <Pause size={15} /> : <Sparkles size={15} />} Lancer les recherches</button>}
      </div>
    </section>
  )
}
