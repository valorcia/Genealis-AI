import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound } from 'lucide-react'
import { api, ApiError } from '../api'

/** Écran de connexion (mode hébergé) : un mot de passe unique défini dans les réglages du site. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onAuth = () => setLocked(true)
    window.addEventListener('genealis:auth', onAuth)
    api.health().then((h) => { if (h.auth_required) api.settings().catch(() => setLocked(true)) }).catch(() => {})
    return () => window.removeEventListener('genealis:auth', onAuth)
  }, [])
  if (!locked) return <>{children}</>
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null)
    try { await api.login(password); setLocked(false); setPassword(''); window.location.reload() }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? 'Mot de passe incorrect.' : 'Connexion impossible au moteur.') }
    finally { setBusy(false) }
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-night-900 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-ivory-50 p-8 shadow-2xl fade-up">
        <div>
          <div className="font-display text-3xl text-night-900">GENEALIS <span className="text-gold-500">AI</span></div>
          <p className="mt-1 text-sm text-mist-500">Cet espace est privé. Saisissez votre mot de passe d'accès.</p>
        </div>
        <label className="block">
          <span className="label">Mot de passe</span>
          <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-conf-red">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy || !password}><KeyRound size={15} /> Entrer</button>
        <p className="text-xs text-mist-500">Le mot de passe est celui défini dans la variable ACCESS_TOKEN de votre hébergement. Vos données restent dans votre propre base.</p>
      </form>
    </div>
  )
}
