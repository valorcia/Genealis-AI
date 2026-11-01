import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Cpu, Eraser, Info, Send, Sparkles, User } from 'lucide-react'
import { api, ApiError, type ChatOut } from '../api'
import { useApp } from '../store'
import { Markdown, Spinner, formatTs } from '../components/ui'

type AiStatus = { provider: string; available: boolean; ok: boolean; message: string; models?: string[]; model?: string }

const INTENT_LABEL: Record<string, string> = {
  research: 'Recherche', contradictions: 'Contradictions', missing: 'Manques', explain: 'Explication', hypotheses: 'Hypothèses',
  tasks: 'Enquêtes', person: 'Personne', query: 'Interrogation', unknown: 'Non compris',
}
const SUGGESTIONS: { text: string; fillOnly?: boolean }[] = [
  { text: 'Recherche les parents de mon arrière-grand-père' },
  { text: 'Remonte la branche italienne' },
  { text: 'Vérifie les ancêtres polonais' },
  { text: 'Quels sont les documents manquants ?' },
  { text: 'Pourquoi penses-tu que … est mon ancêtre ?', fillOnly: true },
  { text: 'Montre-moi les contradictions' },
  { text: 'Recherche dans les archives de Meurthe-et-Moselle' },
  { text: 'Trouve les ancêtres ayant vécu à Nancy entre 1750 et 1900' },
]

function errMsg(e: unknown, fallback: string) { return e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback }

export default function AssistantPage() {
  const { notify } = useApp()
  const [messages, setMessages] = useState<ChatOut[] | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.chatHistory().then(setMessages).catch((e: unknown) => { setMessages([]); setError(errMsg(e, "Impossible de charger l'historique.")) })
    api.aiStatus().then(setStatus).catch(() => setStatus(null))
  }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, sending])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true); setError(null); setInput('')
    setMessages((m) => [...(m ?? []), { role: 'user', content: message, meta: {}, ts: new Date().toISOString() }])
    try {
      const reply = await api.chat(message)
      setMessages((m) => [...(m ?? []), reply])
    } catch (e) {
      const msg = errMsg(e, "L'assistant n'a pas pu répondre.")
      setError(msg); notify('error', msg)
    } finally { setSending(false); inputRef.current?.focus() }
  }, [sending, notify])

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }

  const clear = async () => {
    try { await api.clearChat(); setMessages([]); setConfirmClear(false); notify('success', 'Historique de conversation effacé.') }
    catch (e) { notify('error', errMsg(e, "Impossible d'effacer l'historique.")) }
  }

  const statusChip = status === null ? null
    : status.provider === 'none' ? <span className="chip conf-grey"><Cpu size={12} /> Mode règles (sans modèle IA)</span>
    : <span className={`chip ${status.ok ? 'conf-green' : 'conf-orange'}`} title={status.message}><Cpu size={12} /> {status.provider}{status.model ? ` · ${status.model}` : ''} — {status.ok ? 'opérationnel' : status.message}</span>

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
      <header className="fade-up flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-600">Dialogue avec le généalogiste numérique</div>
          <h1 className="font-display text-3xl text-night-900">Assistant IA</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">{statusChip}</div>
        </div>
        <div className="flex items-center gap-2">
          {confirmClear ? (
            <div className="flex items-center gap-2 rounded-xl border border-conf-red/30 bg-conf-red/5 px-3 py-1.5 text-xs">
              <span>Effacer toute la conversation ?</span>
              <button className="btn-danger !px-2.5 !py-1 text-xs" onClick={clear}>Confirmer</button>
              <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setConfirmClear(false)}>Annuler</button>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmClear(true)} disabled={!messages || messages.length === 0}><Eraser size={15} /> Effacer l'historique</button>
          )}
        </div>
      </header>

      <div className="fade-up flex items-start gap-2 rounded-xl border border-ivory-300 bg-ivory-50 px-4 py-2.5 text-xs text-mist-500">
        <Info size={14} className="mt-0.5 shrink-0 text-gold-600" />
        <span>L'assistant répond uniquement à partir de votre base locale et des sources enregistrées. Il distingue toujours les <strong className="text-night-900">faits établis</strong>, les <strong className="text-night-900">hypothèses</strong> et les <strong className="text-night-900">informations manquantes</strong>, et n'invente jamais un ancêtre ni un résultat de recherche.</span>
      </div>

      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-5">
          {messages === null && <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement de la conversation…</div>}
          {messages && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-mist-500">
              <Sparkles className="text-gold-500" size={28} strokeWidth={1.5} />
              <div className="font-display text-xl text-night-900">Que souhaitez-vous explorer ?</div>
              <div className="max-w-md text-sm">Demandez une recherche, une vérification, une explication d'une filiation, ou la liste des documents manquants. Les suggestions ci-dessous sont un bon point de départ.</div>
            </div>
          )}
          {messages?.map((m, i) => <Bubble key={`${m.ts}-${i}`} m={m} />)}
          {sending && (
            <div className="flex items-end gap-2">
              <Avatar role="assistant" />
              <div className="rounded-2xl rounded-bl-md bg-ivory-100 px-4 py-3 text-sm text-mist-500"><span className="inline-flex items-center gap-2"><Spinner /> L'assistant consulte la base locale…</span></div>
            </div>
          )}
          {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/10 px-3 py-2 text-xs text-conf-red">{error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-ivory-200 bg-ivory-50 p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s.text} className="chip border border-ivory-300 bg-white text-night-900 transition-colors hover:border-gold-500 hover:bg-gold-500/10" disabled={sending}
                title={s.fillOnly ? 'Complétez le nom avant d\'envoyer' : 'Envoyer cette commande'}
                onClick={() => { if (s.fillOnly) { setInput(s.text); inputRef.current?.focus() } else send(s.text) }}>
                « {s.text} »
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} className="input min-h-11 max-h-40 flex-1 resize-y" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              placeholder="Votre demande… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)" disabled={sending} />
            <button className="btn-gold" onClick={() => send(input)} disabled={sending || !input.trim()}>{sending ? <Spinner /> : <Send size={15} />} Envoyer</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ role }: { role: string }) {
  const user = role === 'user'
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${user ? 'bg-night-900 text-ivory-50' : 'bg-gold-500 text-night-950'}`}>
      {user ? <User size={15} /> : <Bot size={15} />}
    </span>
  )
}

function Bubble({ m }: { m: ChatOut }) {
  const user = m.role === 'user'
  const intent = typeof m.meta.intent === 'string' ? m.meta.intent : null
  const taskIds = Array.isArray(m.meta.task_ids) ? (m.meta.task_ids as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const rephrased = typeof m.meta.rephrased_by === 'string' ? m.meta.rephrased_by : null
  return (
    <div className={`fade-up flex items-end gap-2 ${user ? 'flex-row-reverse' : ''}`}>
      <Avatar role={m.role} />
      <div className={`max-w-[80%] ${user ? 'items-end text-right' : ''}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm ${user ? 'rounded-br-md bg-night-900 text-ivory-50' : 'rounded-bl-md border border-ivory-200 bg-white text-night-900'}`}>
          {user ? <div className="whitespace-pre-wrap">{m.content}</div> : <Markdown text={m.content} />}
        </div>
        <div className={`mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mist-400 ${user ? 'justify-end' : ''}`}>
          <span>{formatTs(m.ts)}</span>
          {!user && intent && <span className="rounded-full border border-ivory-300 px-1.5 py-px text-[10px] uppercase tracking-wide text-mist-500" title={`Intention détectée : ${intent}`}>{INTENT_LABEL[intent] ?? intent}</span>}
          {!user && taskIds.length > 0 && <Link to="/enquetes" className="text-gold-600 hover:underline">Voir les enquêtes ({taskIds.length})</Link>}
          {!user && rephrased && <span className="italic">reformulé par {rephrased}</span>}
        </div>
      </div>
    </div>
  )
}
