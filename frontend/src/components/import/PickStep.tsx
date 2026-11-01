import { useEffect, useMemo, useRef } from 'react'
import { Camera, FileText, ImagePlus, Info, Sparkles, X } from 'lucide-react'
import type { PersonSummary } from '../../api'
import type { InterpretCapabilities } from '../../lib/interpretApi'
import { Callout, KIND_META, PersonSearch } from './shared'

export function PickStep({ files, setFiles, person, setPerson, kind, setKind, caps, busy, onStart }: {
  files: File[]; setFiles: (f: File[]) => void; person: PersonSummary | null; setPerson: (p: PersonSummary | null) => void
  kind: string; setKind: (k: string) => void; caps: InterpretCapabilities | null; busy: boolean; onStart: () => void
}) {
  const camRef = useRef<HTMLInputElement>(null)
  const libRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => ({ f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })), [files])
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews])
  const add = (list: FileList | null) => { if (list && list.length) setFiles([...files, ...Array.from(list)]) }

  return (
    <div className="space-y-4">
      <section className="panel fade-up p-4 sm:p-5">
        <h2 className="font-display text-[19px] text-night-900">1. Prenez une photo ou choisissez un fichier</h2>
        <p className="mt-1 text-[13.5px] text-mist-500">Acte, recensement, registre matricule, faire-part… Photographiez la page bien à plat, en entier et sans reflet.</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button type="button" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-ios-blue/40 bg-ios-blue/5 p-3 text-center text-[15px] font-medium text-ios-blue hover:bg-ios-blue/10"
            onClick={() => camRef.current?.click()}>
            <Camera size={28} strokeWidth={1.6} />Prendre une photo
          </button>
          <button type="button" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-ivory-300 bg-ivory-100/60 p-3 text-center text-[15px] font-medium text-night-900 hover:bg-ivory-100"
            onClick={() => libRef.current?.click()}>
            <ImagePlus size={28} strokeWidth={1.6} />Choisir un fichier
          </button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={libRef} type="file" accept="image/*,application/pdf" multiple hidden data-testid="file-input" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        {files.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {previews.map(({ f, url }, i) => (
              <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-xl border border-ivory-300 bg-ivory-100">
                {url ? <img src={url} alt="" className="aspect-[3/4] w-full object-cover" /> : <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 p-1 text-mist-500"><FileText size={26} /><span className="line-clamp-2 text-center text-[10px]">{f.name}</span></div>}
                <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-night-900/75 text-white"><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        {files.length > 1 && <p className="mt-2 text-xs text-mist-500">{files.length} fichiers : chacun sera lu puis validé à son tour.</p>}
      </section>

      <section className="panel fade-up p-4 sm:p-5">
        <h2 className="font-display text-[17px] text-night-900">Concernant <span className="text-sm font-normal text-mist-500">(facultatif)</span></h2>
        <p className="mb-2 mt-0.5 text-[13px] text-mist-500">La personne de votre arbre que ce document concerne : cela aide à reconnaître les bonnes personnes.</p>
        <PersonSearch value={person} onChange={setPerson} />
      </section>

      <section className="panel fade-up p-4 sm:p-5">
        <h2 className="font-display text-[17px] text-night-900">Type de document</h2>
        <p className="mb-2.5 mt-0.5 text-[13px] text-mist-500">Laissez « Automatique » si vous ne savez pas.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type de document">
          {KIND_META.map((k) => {
            const Icon = k.icon
            const on = kind === k.id
            return (
              <button key={k.id} type="button" role="radio" aria-checked={on} onClick={() => setKind(k.id)} title={k.hint}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px] transition-colors ${on ? 'border-gold-500 bg-gold-500 text-white shadow-sm' : 'border-ivory-300 bg-white text-night-900 hover:bg-ivory-100'}`}>
                <Icon size={16} />{k.short}
              </button>
            )
          })}
        </div>
      </section>

      {caps && !caps.ai_available && (
        <Callout tone="info" icon={Info}>
          Aucune IA n’est réglée pour lire automatiquement. Après l’envoi, l’application vous guidera pour faire lire le document
          par <b>Claude ou ChatGPT</b> (copier-coller avec votre abonnement). Pour une lecture automatique, ajoutez une clé Gemini gratuite
          dans <b>Paramètres → Intelligence artificielle</b>.
        </Callout>
      )}

      <div className="sticky bottom-2 z-20 rounded-2xl bg-white/85 p-2 shadow-[0_-6px_24px_-12px_rgba(28,35,51,0.35)] backdrop-blur">
        <button type="button" className="btn-gold w-full !min-h-13 !rounded-2xl !text-[17px]" disabled={files.length === 0 || busy} onClick={onStart}>
          <Sparkles size={19} />{files.length > 1 ? `Lire les ${files.length} documents` : 'Lire le document'}
        </button>
      </div>
    </div>
  )
}
