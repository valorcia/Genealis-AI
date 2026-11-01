import { Check } from 'lucide-react'

export const AUTONOMY_MODES: { value: number; name: string; desc: string }[] = [
  { value: 1, name: 'Assisté', desc: "L'IA propose et attend votre accord avant toute action." },
  { value: 2, name: 'Semi-autonome', desc: 'Recherches autorisées, validation demandée avant toute filiation incertaine.' },
  { value: 3, name: 'Autonome contrôlé', desc: "Enregistre automatiquement les informations suffisamment corroborées ; les incertitudes restent dans l'espace de travail." },
]

export function autonomyLabel(mode: number) {
  return AUTONOMY_MODES.find((m) => m.value === mode)?.name ?? `Mode ${mode}`
}

/** Cartes radio du mode d'autonomie, en version claire (paramètres) ou sombre (accueil). */
export function AutonomyCards({ value, onChange, dark = false }: { value: number; onChange: (v: number) => void; dark?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Mode d'autonomie">
      {AUTONOMY_MODES.map((m) => {
        const active = m.value === value
        const base = 'relative cursor-pointer rounded-2xl border p-4 text-left transition-all'
        const light = active ? 'border-gold-500 bg-gold-500/10 shadow-sm' : 'border-ivory-300 bg-white hover:border-gold-400'
        const night = active ? 'border-gold-500 bg-night-800' : 'border-night-600 bg-night-800/50 hover:border-gold-400/70'
        return (
          <button key={m.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(m.value)} className={`${base} ${dark ? night : light}`}>
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${dark ? 'text-gold-400' : 'text-gold-600'}`}>Mode {m.value}</span>
              {active && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-night-950"><Check size={12} strokeWidth={3} /></span>}
            </div>
            <div className={`font-display mt-1 text-lg ${dark ? 'text-ivory-50' : 'text-night-900'}`}>{m.name}</div>
            <p className={`mt-1 text-xs leading-relaxed ${dark ? 'text-ivory-200/70' : 'text-mist-500'}`}>{m.desc}</p>
          </button>
        )
      })}
    </div>
  )
}
