import { Link } from 'react-router-dom'
import { BookMarked, CalendarDays, ChevronRight, CircleCheck, GitBranch, CircleQuestionMark, ImagePlus, Network, SkipForward, UserPlus, UserRound } from 'lucide-react'
import type { ApplySummary } from '../../lib/interpretApi'
import { eventLabel } from '../person/eventMeta'

const MODE_FR: Record<string, string> = { added: 'ajouté', completed: 'complété avec la source' }

export function DoneView({ summary, nextLabel, onNext, onAnother }: { summary: ApplySummary; nextLabel: string | null; onNext: () => void; onAnother: () => void }) {
  const people = [...summary.created_persons.map((p) => ({ ...p, created: true })), ...summary.linked_persons.map((p) => ({ ...p, created: false }))]
  return (
    <div className="space-y-4">
      <section className="panel fade-up p-5 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-conf-green/15 text-conf-green"><CircleCheck size={34} /></div>
        <h2 className="mt-2 font-display text-[22px] text-night-900">C’est ajouté à votre arbre</h2>
        <p className="mt-1 text-[14px] text-mist-500">
          {summary.created_persons.length} nouvelle(s) fiche(s) · {summary.events.length} événement(s) · {summary.relations.length} lien(s)
          {summary.questions.length ? ` · ${summary.questions.length} question(s) à trancher` : ''}
        </p>
      </section>

      {people.length > 0 && (
        <section className="panel p-4">
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-night-900"><UserRound size={16} className="text-ios-blue" />Personnes</h3>
          <ul className="divide-y divide-ivory-200">
            {people.map((p) => (
              <li key={p.id}>
                <Link to={`/personnes/${p.id}`} className="flex min-h-12 items-center gap-2.5 py-2 text-[15px] text-night-900">
                  {p.created ? <UserPlus size={17} className="text-ios-blue" /> : <UserRound size={17} className="text-conf-green" />}
                  <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span> <span className="text-[12.5px] text-mist-500">{p.role}{p.created ? ' · nouvelle fiche' : ''}</span></span>
                  <ChevronRight size={17} className="text-mist-400" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel space-y-2 p-4 text-[14px]">
        {summary.events.length > 0 && (
          <div><div className="mb-1 flex items-center gap-2 font-semibold text-night-900"><CalendarDays size={16} className="text-ios-blue" />Événements</div>
            <ul className="space-y-0.5 pl-6 text-night-800">{summary.events.map((e) => <li key={e.id}><b className="font-medium">{eventLabel(e.event_type)}</b>{e.who ? ` de ${e.who}` : ''}{e.date ? ` (${e.date})` : ''} — {MODE_FR[e.mode] ?? e.mode}{e.changes && e.changes.length ? ` : ${e.changes.join(', ')}` : ''}</li>)}</ul></div>
        )}
        {summary.relations.length > 0 && (
          <div><div className="mb-1 flex items-center gap-2 font-semibold text-night-900"><GitBranch size={16} className="text-ios-blue" />Liens familiaux</div>
            <ul className="space-y-0.5 pl-6 text-night-800">{summary.relations.map((r, i) => <li key={r.id ?? i}>{r.label}</li>)}</ul></div>
        )}
        {summary.sources.length > 0 && (
          <div><div className="mb-1 flex items-center gap-2 font-semibold text-night-900"><BookMarked size={16} className="text-ios-blue" />Source</div>
            <ul className="space-y-0.5 pl-6 text-night-800">{summary.sources.map((s) => <li key={s.id}>{s.title}</li>)}</ul></div>
        )}
        {summary.questions.length > 0 && (
          <div><div className="mb-1 flex items-center gap-2 font-semibold text-night-900"><CircleQuestionMark size={16} className="text-conf-orange" />À trancher plus tard</div>
            <ul className="space-y-0.5 pl-6 text-night-800">{summary.questions.map((q) => <li key={q.id}>{q.title}</li>)}</ul>
            <Link to="/questions" className="ml-6 mt-1 inline-flex items-center gap-1 text-ios-blue">Voir les questions <ChevronRight size={14} /></Link></div>
        )}
        {summary.skipped.length > 0 && <p className="text-[12.5px] text-mist-500">{summary.skipped.length} proposition(s) non appliquée(s) : {summary.skipped.map((s) => s.reason).filter((v, i, a) => a.indexOf(v) === i).join(' ; ')}</p>}
      </section>

      <div className="grid gap-2 sm:grid-cols-3">
        {nextLabel && <button type="button" className="btn-gold !min-h-12 !rounded-2xl" onClick={onNext}><SkipForward size={17} />{nextLabel}</button>}
        <Link to="/arbre" className="btn-primary !min-h-12 !rounded-2xl"><Network size={17} />Voir l’arbre</Link>
        <button type="button" className="btn-ghost !min-h-12 !rounded-2xl" onClick={onAnother}><ImagePlus size={17} />Importer un autre document</button>
      </div>
    </div>
  )
}
