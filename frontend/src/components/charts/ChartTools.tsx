import { useCallback, useState, type ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'

/** Styles d'impression : seule la zone `.chart-print-area` est imprimée (en paysage). */
export function PrintStyle() {
  return (
    <style>{`
@media print {
  @page { size: landscape; margin: 10mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .chart-print-area, .chart-print-area * { visibility: visible !important; }
  .chart-print-area { position: fixed !important; left: 0 !important; top: 0 !important; }
  .chart-viewport { background: #fff !important; }
}`}</style>
  )
}

function collectCss() {
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n' } catch { /* feuille externe non lisible */ }
  }
  return css
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Exporte un graphique en image SVG. Un <svg> est sérialisé tel quel ;
 * un contenu HTML (cartes) est enveloppé dans un <foreignObject> avec ses styles.
 */
export function exportSvg(el: Element | null, filename: string) {
  if (!el) return
  const safe = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .-]+/g, '-').trim().slice(0, 120) + '.svg'
  if (el instanceof SVGSVGElement) {
    const clone = el.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    const vb = el.viewBox.baseVal
    if (vb && vb.width) { clone.setAttribute('width', String(vb.width)); clone.setAttribute('height', String(vb.height)) }
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = 'text{font-family:Inter,"Segoe UI",system-ui,sans-serif}'
    clone.insertBefore(style, clone.firstChild)
    download(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }), safe)
    return
  }
  const h = el as HTMLElement
  const w = h.scrollWidth || h.offsetWidth, ht = h.scrollHeight || h.offsetHeight
  const clone = h.cloneNode(true) as HTMLElement
  clone.style.transform = 'none'; clone.style.position = 'relative'; clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  const html = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}"><foreignObject x="0" y="0" width="${w}" height="${ht}"><div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA[${collectCss().replace(/]]>/g, ']] >')}]]></style>${html}</div></foreignObject></svg>`
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), safe)
}

/** Contenu standard du panneau « Actions » d'un graphique. */
export function ChartActions({ exportTarget, filename, children }: { exportTarget?: () => Element | null; filename?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ActionButton icon={<Printer size={17} />} label="Imprimer / PDF" hint="Seul le graphique est imprimé" onClick={() => window.print()} />
      {exportTarget && <ActionButton icon={<Download size={17} />} label="Exporter en image (SVG)" hint="Image vectorielle, nette à toutes les tailles" onClick={() => exportSvg(exportTarget(), filename ?? 'graphique')} />}
      {children}
    </div>
  )
}

export function ActionButton({ icon, label, hint, onClick, disabled }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-black/5 transition-colors hover:bg-[#f2f6fb] disabled:opacity-50">
      <span className="text-[#13918c]">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium text-night-900">{label}</span>{hint && <span className="block text-xs text-mist-500">{hint}</span>}</span>
    </button>
  )
}

/* ——— Contrôles des panneaux Options / Style ——— */

export function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-mist-500">{title}</div>
      <div className="divide-y divide-black/5 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">{children}</div>
    </div>
  )
}

export function SliderRow({ label, value, min, max, onChange, format }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="flex items-center gap-3 px-3.5 py-3">
      <span className="w-36 shrink-0 text-sm text-night-900">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[#13918c]" />
      <span className="w-12 text-right text-sm font-semibold tabular-nums text-night-900">{format ? format(value) : value}</span>
    </label>
  )
}

export function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3.5 py-3">
      <span className="min-w-0 flex-1"><span className="block text-sm text-night-900">{label}</span>{hint && <span className="block text-xs text-mist-500">{hint}</span>}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#34c759]' : 'bg-black/15'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function SegmentedRow<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="px-3.5 py-2.5">
      {label && <div className="mb-1.5 text-sm text-night-900">{label}</div>}
      <div className="flex gap-1 rounded-xl bg-black/5 p-1">
        {options.map((o) => (
          <button key={String(o.value)} onClick={() => onChange(o.value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${o.value === value ? 'bg-white font-semibold text-night-900 shadow-sm' : 'text-mist-500 hover:text-night-900'}`}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

/** Texte d'aide standard (bouton « ? »). */
export function HelpText({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-night-900">
      <p className="text-base font-semibold text-[#13918c]">{title}</p>
      {children}
      <p className="text-xs text-mist-500">Touchez n’importe où pour fermer cette aide.</p>
    </div>
  )
}

/** État vide ou de chargement centré dans la zone du graphique. */
export function ChartMessage({ children }: { children: ReactNode }) {
  return <div className="mx-auto mt-16 max-w-md rounded-3xl bg-white/80 p-6 text-center text-sm text-mist-500 shadow-sm ring-1 ring-black/5">{children}</div>
}

/** Persistance légère des réglages d'un graphique (par navigateur). */
export function loadPref<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(`genealis.chart.${key}`); return raw ? { ...fallback, ...(JSON.parse(raw) as object) } as T : fallback } catch { return fallback }
}
export function savePref(key: string, value: unknown) {
  try { localStorage.setItem(`genealis.chart.${key}`, JSON.stringify(value)) } catch { /* stockage indisponible */ }
}

/** Réglages d'un graphique mémorisés dans le navigateur. */
export function usePref<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => loadPref(key, fallback))
  const update = useCallback((patch: Partial<T>) => setValue((cur) => { const next = { ...cur, ...patch }; savePref(key, next); return next }), [key])
  return [value, update] as const
}
