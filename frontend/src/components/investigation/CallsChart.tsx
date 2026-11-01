/** Histogramme simple (SVG) des appels IA envoyés sur les 14 derniers jours, avec info-bulle au survol. */
import { useMemo, useState } from 'react'

function lastDays(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
const dayLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

export function CallsChart({ byDay, dailyLimit }: { byDay: { day: string; calls: number }[]; dailyLimit?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => {
    const m = new Map(byDay.map((d) => [d.day, d.calls]))
    return lastDays(14).map((day) => ({ day, calls: m.get(day) ?? 0 }))
  }, [byDay])
  const total = data.reduce((a, d) => a + d.calls, 0)
  const max = Math.max(1, ...data.map((d) => d.calls))
  const niceMax = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10
  const W = 640, H = 200, L = 34, R = 8, T = 12, B = 26
  const iw = W - L - R, ih = H - T - B
  const bw = iw / data.length
  const y = (v: number) => T + ih - (v / niceMax) * ih
  const ticks = [0, niceMax / 2, niceMax]
  const limitVisible = dailyLimit && dailyLimit <= niceMax * 1.0

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Appels IA envoyés par jour sur 14 jours : ${total} au total`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="rgb(120 96 52 / 0.14)" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6b665c" style={{ fontVariantNumeric: 'tabular-nums' }}>{Number.isInteger(t) ? t : t.toFixed(1)}</text>
          </g>
        ))}
        {limitVisible && (
          <g>
            <line x1={L} x2={W - R} y1={y(dailyLimit!)} y2={y(dailyLimit!)} stroke="#c47a1e" strokeWidth={1} strokeDasharray="4 4" />
            <text x={W - R} y={y(dailyLimit!) - 4} textAnchor="end" fontSize={10} fill="#87510f">plafond quotidien {dailyLimit}</text>
          </g>
        )}
        {data.map((d, i) => {
          const x = L + i * bw + 2
          const w = Math.max(2, bw - 4)
          const h = d.calls ? Math.max(3, T + ih - y(d.calls)) : 0
          const r = Math.min(4, w / 2, h)
          const top = T + ih - h
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={T} width={bw} height={ih} fill="transparent" />
              {h > 0 && <path d={`M${x},${T + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${T + ih} Z`} fill={hover === i ? '#22314b' : '#2c4f86'} />}
              {(i % 2 === 0 || i === data.length - 1) && <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#6b665c">{dayLabel(d.day)}</text>}
            </g>
          )
        })}
        <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} stroke="rgb(120 96 52 / 0.35)" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-night-900 px-2.5 py-1.5 text-[12px] text-ivory-50 shadow-lg"
          style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover > 10 ? '-100%' : hover < 3 ? '0' : '-50%'})` }}>
          {dayLabel(data[hover].day)} : <strong>{data[hover].calls}</strong> appel{data[hover].calls > 1 ? 's' : ''}
        </div>
      )}
      <figcaption className="sr-only">
        <table><tbody>{data.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.calls}</td></tr>)}</tbody></table>
      </figcaption>
    </figure>
  )
}
