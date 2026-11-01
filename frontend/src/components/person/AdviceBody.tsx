import { ExternalLink, Sparkles } from 'lucide-react'
import { openExternal, type Advice } from '../../api'
import { Markdown } from '../ui'

/** Plan de recherche (règles ou IA) + liens vers les archives. */
export function AdviceBody({ a }: { a: Advice }) {
  const ai = a.source.startsWith('ai:')
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {ai ? <span className="chip bg-[#ece6ff] text-[#3f2aa8]"><Sparkles size={12} />Suggestions de l’IA, à vérifier</span> : <span className="chip conf-grey">Conseils de méthode</span>}
        </div>
        <Markdown text={a.markdown} />
        {a.ai_error && <p className="mt-2 text-xs text-mist-500">L’IA n’a pas pu répondre ({a.ai_error}) : conseils de méthode affichés à la place.</p>}
      </div>
      {a.links.length > 0 && (
        <div>
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">Où chercher</div>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
            {a.links.map((l, i) => (
              <button key={l.id} disabled={!l.url} onClick={() => l.url && openExternal(l.url)} className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[14px] text-night-900 hover:bg-black/[0.03] disabled:opacity-50 ${i ? 'border-t border-black/5' : ''}`}>
                <span className="min-w-0 truncate">{l.name}</span><ExternalLink size={14} className="shrink-0 text-mist-400" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
