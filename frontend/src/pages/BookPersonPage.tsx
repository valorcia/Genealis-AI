import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Eye, EyeOff, Sparkles, Trash2, UserRound } from 'lucide-react'
import { ApiError } from '../api'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import { useFocusPerson } from '../components/shell/useFocusPerson'
import { BookDesk, BookLoading, BookPage, BookToolbar, NavButton, TocDrawer } from '../components/book/BookKit'
import { ChapterView } from '../components/book/ChapterView'
import { bookApi, type BookChapter, type BookOutline } from '../lib/bookApi'

/** « Ma vie, racontée » : le chapitre du livre consacré à une personne (/livre/personne/:id). */
export default function BookPersonPage() {
  const { id: paramId } = useParams()
  const { focusId, loading: focusLoading } = useFocusPerson()
  const id = paramId ?? focusId ?? null
  const nav = useNavigate()
  const { notify } = useApp()
  const [ch, setCh] = useState<BookChapter | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<BookOutline | null>(null)
  const [toc, setToc] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)

  const load = useCallback(async (pid: string) => {
    setError(null)
    try { setCh(await bookApi.chapter(pid)) } catch (e) { setError(e instanceof ApiError && e.status === 404 ? 'Cette personne n’existe pas (ou plus) dans l’arbre.' : e instanceof Error ? e.message : 'Chapitre indisponible') }
  }, [])
  useEffect(() => { if (id) { setCh(null); setShowAi(false); load(id); document.querySelector('main')?.scrollTo({ top: 0 }) } }, [id, load])
  useEffect(() => { bookApi.outline().then(setOutline).catch(() => setOutline(null)) }, [])

  const { prev, next, number } = useMemo(() => {
    const list = outline?.chapters ?? []
    const i = list.findIndex((c) => c.person_id === id)
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null, number: i >= 0 ? list[i].number : null }
  }, [outline, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return
      if (e.key === 'ArrowLeft' && prev) nav(`/livre/personne/${prev.person_id}`)
      if (e.key === 'ArrowRight' && next) nav(`/livre/personne/${next.person_id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, nav])

  const rewrite = async () => {
    if (!ch) return
    setAiBusy(true)
    try {
      const story = await bookApi.rewrite(ch.person_id)
      setCh({ ...ch, ai_story: story })
      setShowAi(true)
      notify('success', 'Version reformulée par l’IA ajoutée (le texte factuel reste la référence).')
    } catch (e) { notify('error', e instanceof Error ? e.message : 'Reformulation impossible') } finally { setAiBusy(false) }
  }
  const removeAi = async () => {
    if (!ch) return
    try { await bookApi.deleteRewrite(ch.person_id); setCh({ ...ch, ai_story: null }); setShowAi(false) } catch (e) { notify('error', e instanceof Error ? e.message : 'Suppression impossible') }
  }

  if (!id) {
    return (
      <BookDesk>
        <BookPage>
          {focusLoading ? <p className="flex items-center justify-center gap-2 py-8 italic"><Spinner /> Recherche de la personne…</p> : (
            <div className="py-8 text-center">
              <p className="book-h1 !text-[26px]">Aucune personne dans l’arbre</p>
              <p className="mt-2 italic text-[#85785f]">Ajoutez d’abord une personne pour écrire son chapitre.</p>
              <Link to="/demarrer" className="btn-primary mt-4 font-sans">Commencer l’arbre</Link>
            </div>
          )}
        </BookPage>
      </BookDesk>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] pb-6">
      <BookToolbar onToc={() => setToc(true)} onPrint={() => window.print()}>
        <NavButton dir="prev" to={prev ? `/livre/personne/${prev.person_id}` : null} label={prev?.name} />
        <NavButton dir="next" to={next ? `/livre/personne/${next.person_id}` : null} label={next?.name} />
        {ch?.ai_story && (
          <button onClick={() => setShowAi((v) => !v)} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-[#4630a8] hover:bg-[#efeafc]" title={showAi ? 'Masquer la version reformulée' : 'Afficher la version reformulée par l’IA'}>
            {showAi ? <EyeOff size={15} /> : <Eye size={15} />}<span className="hidden lg:inline">Version IA</span>
          </button>
        )}
        <button onClick={rewrite} disabled={!ch || aiBusy} className="btn-gold !h-9 !px-3" title="Reformuler le récit avec l’IA, à partir des seuls faits du chapitre">
          {aiBusy ? <Spinner /> : <Sparkles size={15} />}<span className="hidden sm:inline">Réécrire avec l’IA</span>
        </button>
      </BookToolbar>

      {error && (
        <BookDesk><BookPage><p className="py-6 text-center">{error}</p><p className="text-center"><Link className="book-link font-sans" to="/livre">Retour au livre</Link></p></BookPage></BookDesk>
      )}
      {!error && !ch && <BookLoading />}
      {ch && (
        <BookDesk>
          <ChapterView ch={ch} number={number} showAi={showAi} />
          <div className="book-noprint mx-auto flex max-w-[800px] flex-wrap items-center justify-between gap-2 px-1 font-sans">
            <NavButton dir="prev" to={prev ? `/livre/personne/${prev.person_id}` : null} label={prev ? `${prev.sosa[0] ? `Sosa ${prev.sosa[0]} · ` : ''}${prev.name}` : undefined} />
            <div className="flex items-center gap-2">
              <Link to={`/personnes/${ch.person_id}`} className="btn-ghost !h-9 !text-[13px]"><UserRound size={14} />Fiche</Link>
              {ch.ai_story && <button onClick={removeAi} className="btn-ghost !h-9 !text-[13px]" title="Supprimer la version reformulée par l’IA"><Trash2 size={14} />Version IA</button>}
            </div>
            <NavButton dir="next" to={next ? `/livre/personne/${next.person_id}` : null} label={next ? `${next.sosa[0] ? `Sosa ${next.sosa[0]} · ` : ''}${next.name}` : undefined} />
          </div>
        </BookDesk>
      )}
      {toc && <TocDrawer outline={outline} currentId={id} onClose={() => setToc(false)} />}
    </div>
  )
}
