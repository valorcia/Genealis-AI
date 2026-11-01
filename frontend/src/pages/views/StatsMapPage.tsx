import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapPinned, Pause, Play, WifiOff } from 'lucide-react'
import { api, type EventRow } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { COLORS, Card, EmptyState, ErrorState, LoadingState, shortPlace, useLoader } from '../../components/views/common'
import { EVENT_CATS, catOf } from '../../components/views/eventCats'

const C = COLORS.vues
type Metric = 'naissances' | 'deces' | 'mariages' | 'tous' | 'personnes'
const METRICS: { id: Metric; label: string; short: string; color: string; unit: [string, string] }[] = [
  { id: 'naissances', label: 'Naissances', short: 'Naiss.', color: EVENT_CATS[0].color, unit: ['naissance', 'naissances'] },
  { id: 'deces', label: 'Décès', short: 'Décès', color: '#47506a', unit: ['décès', 'décès'] },
  { id: 'mariages', label: 'Mariages', short: 'Mariages', color: '#d4930f', unit: ['mariage', 'mariages'] },
  { id: 'tous', label: 'Tous les événements', short: 'Tous', color: '#0f8a7e', unit: ['événement', 'événements'] },
  { id: 'personnes', label: 'Nombre de personnes', short: 'Personnes', color: '#2f6fd1', unit: ['personne', 'personnes'] },
]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

interface PlaceStat { key: string; name: string; lat: number; lon: number; count: number }

function aggregate(events: EventRow[], metric: Metric, from: number, to: number, fullRange: boolean): PlaceStat[] {
  const map = new Map<string, PlaceStat & { ids: Set<string> }>()
  for (const e of events) {
    if (e.lat === null || e.lon === null || !e.place) continue
    if (e.sort_year === null ? !fullRange : e.sort_year < from || e.sort_year > to + 9) continue
    const cat = catOf(e.event_type)
    if (metric === 'naissances' && cat !== 'naissances') continue
    if (metric === 'deces' && cat !== 'deces') continue
    if (metric === 'mariages' && cat !== 'mariages') continue
    const key = `${e.lat.toFixed(4)},${e.lon.toFixed(4)}`
    if (!map.has(key)) map.set(key, { key, name: e.place, lat: e.lat, lon: e.lon, count: 0, ids: new Set() })
    const s = map.get(key)!
    if (metric === 'personnes') e.persons.forEach((p) => s.ids.add(p.id))
    else s.count++
  }
  return [...map.values()].map((s) => ({ ...s, count: metric === 'personnes' ? s.ids.size : s.count })).filter((s) => s.count > 0).sort((a, b) => b.count - a.count)
}

export default function StatsMapPage() {
  const { persons, focusId, setFocusId } = useFocusPerson()
  const { data, loading, error, reload } = useLoader<EventRow[]>(() => api.events(), [])
  const [metric, setMetric] = useState<Metric>('naissances')
  const decades = useMemo(() => {
    const ys = (data ?? []).filter((e) => e.lat !== null && e.sort_year !== null).map((e) => e.sort_year as number)
    if (!ys.length) return { min: 1900, max: 2020 }
    return { min: Math.floor(Math.min(...ys) / 10) * 10, max: Math.floor(Math.max(...ys) / 10) * 10 }
  }, [data])
  const [range, setRange] = useState<[number, number] | null>(null)
  const [from, to] = range ?? [decades.min, decades.max]
  const fullRange = from <= decades.min && to >= decades.max
  const [playing, setPlaying] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)
  const m = METRICS.find((x) => x.id === metric)!

  const stats = useMemo(() => aggregate(data ?? [], metric, from, to, fullRange), [data, metric, from, to, fullRange])
  const max = Math.max(1, ...stats.map((s) => s.count))
  const total = stats.reduce((s, x) => s + x.count, 0)
  const radius = (n: number) => 6 + Math.sqrt(n / max) * 26

  // Lecture animée décennie par décennie (cumul depuis le début de la période).
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setRange((r) => {
        const [f, cur] = r ?? [decades.min, decades.min]
        if (cur >= decades.max) { setPlaying(false); return [f, decades.max] }
        return [f, cur + 10]
      })
    }, 700)
    return () => clearInterval(t)
  }, [playing, decades])

  // --- Carte Leaflet ---
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const fitted = useRef(false)
  useEffect(() => {
    if (!box.current || map.current || !data) return
    const mp = L.map(box.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([46.6, 2.4], 5)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' })
    let fails = 0
    tiles.on('tileerror', () => { fails++; if (fails > 3) setTilesFailed(true) })
    tiles.on('tileload', () => setTilesFailed(false))
    tiles.addTo(mp)
    layer.current = L.layerGroup().addTo(mp)
    map.current = mp
    const ro = new ResizeObserver(() => mp.invalidateSize())
    ro.observe(box.current)
    return () => { ro.disconnect(); mp.remove(); map.current = null; layer.current = null; fitted.current = false }
  }, [data])

  useEffect(() => {
    const mp = map.current, lg = layer.current
    if (!mp || !lg) return
    lg.clearLayers(); markers.current.clear()
    for (const s of stats.slice().reverse()) {
      const mk = L.circleMarker([s.lat, s.lon], { radius: radius(s.count), color: '#ffffff', weight: 1.5, fillColor: m.color, fillOpacity: 0.62 })
        .bindTooltip(`<b>${esc(s.name)}</b><br>${s.count} ${s.count > 1 ? m.unit[1] : m.unit[0]}`, { direction: 'top', offset: [0, -4] })
      mk.addTo(lg)
      markers.current.set(s.key, mk)
    }
    if (!fitted.current && stats.length) {
      fitted.current = true
      const b = L.latLngBounds(stats.map((s) => [s.lat, s.lon] as [number, number]))
      mp.fitBounds(b.pad(0.25), { maxZoom: 8 })
    }
  }, [stats, m])

  const flyTo = (s: PlaceStat) => {
    map.current?.flyTo([s.lat, s.lon], Math.max(map.current.getZoom(), 8), { duration: 0.8 })
    markers.current.get(s.key)?.openTooltip()
  }

  const legendValues = [...new Set([max, Math.max(1, Math.round(max / 4)), 1])].sort((a, b) => b - a)
  const help = (
    <div className="space-y-2">
      <p className="font-semibold" style={{ color: C }}>Cartes statistiques</p>
      <p>Chaque bulle est proportionnelle au nombre d’événements (ou de personnes) enregistrés dans ce lieu pour la période choisie.</p>
      <p>Utilisez le curseur des décennies ou le bouton lecture pour voir la famille se déplacer au fil du temps.</p>
      <p className="text-mist-500">Le fond de carte OpenStreetMap nécessite une connexion Internet ; les bulles restent exactes hors ligne.</p>
    </div>
  )

  return (
    <ChartFrame title="Cartes statistiques" subtitle={`${m.label} · ${fullRange ? 'toutes périodes' : `${from} – ${to + 9}`}`} color={C} help={help} persons={persons} focusId={focusId} onFocus={setFocusId}>
      {loading && <LoadingState label="Chargement des événements…" color={C} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3 lg:order-2">
            <Card className="space-y-3 p-4">
              <div>
                <span className="label">Mesure</span>
                <div className="flex flex-wrap gap-1.5">
                  {METRICS.map((x) => (
                    <button key={x.id} onClick={() => setMetric(x.id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${metric === x.id ? 'text-white ring-transparent' : 'bg-white text-night-900 ring-black/10'}`} style={metric === x.id ? { background: x.color } : undefined}>
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="label !mb-0">Période</span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: C }}>{fullRange ? 'Toutes périodes' : `${from} – ${to + 9}`}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => { if (!playing && to >= decades.max) setRange([from, from]); setPlaying((p) => !p) }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow" style={{ background: C }} aria-label={playing ? 'Pause' : 'Lecture'}>
                    {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
                  </button>
                  <div className="flex-1 space-y-1">
                    <label className="flex items-center gap-2 text-[11px] text-mist-500"><span className="w-5">De</span>
                      <input type="range" min={decades.min} max={decades.max} step={10} value={from} onChange={(e) => { const v = Number(e.target.value); setRange([v, Math.max(v, to)]) }} className="w-full" style={{ accentColor: C }} /></label>
                    <label className="flex items-center gap-2 text-[11px] text-mist-500"><span className="w-5">À</span>
                      <input type="range" min={decades.min} max={decades.max} step={10} value={to} onChange={(e) => { const v = Number(e.target.value); setRange([Math.min(from, v), v]) }} className="w-full" style={{ accentColor: C }} /></label>
                  </div>
                </div>
                {!fullRange && <button className="mt-1 text-xs font-medium" style={{ color: C }} onClick={() => { setRange(null); setPlaying(false) }}>Toutes les périodes</button>}
              </div>
            </Card>
            <Card className="hidden p-4 lg:block"><TopPlaces stats={stats} max={max} color={m.color} onPick={flyTo} unit={m.unit} total={total} /></Card>
          </div>

          <div className="space-y-2 lg:order-1">
            <div className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-[26px] shadow-[0_8px_30px_-14px_rgba(20,40,80,0.35)] ring-1 ring-black/5 lg:h-[calc(100dvh-262px)]">
              <div ref={box} className="absolute inset-0 z-0 bg-[#e8eef3]" />
              <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-2xl bg-white/90 p-2.5 shadow-md backdrop-blur">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-mist-500">{m.label}</p>
                <div className="flex items-end gap-2.5">
                  {legendValues.map((v) => (
                    <div key={v} className="flex flex-col items-center gap-0.5">
                      <span className="rounded-full border border-white" style={{ width: radius(v) * 2, height: radius(v) * 2, background: m.color, opacity: 0.65 }} />
                      <span className="text-[10px] tabular-nums text-night-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              {tilesFailed && (
                <div className="absolute inset-x-3 top-3 z-[500] mx-auto flex w-fit items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs text-mist-500 shadow">
                  <WifiOff size={13} /> Fond de carte indisponible hors ligne — les bulles restent exactes
                </div>
              )}
              {stats.length === 0 && (
                <div className="absolute inset-x-3 top-1/2 z-[500] -translate-y-1/2"><EmptyState icon={<MapPinned size={26} />} color={C} title="Aucun lieu pour ces critères">Changez la mesure ou la période, ou ajoutez des lieux à vos événements.</EmptyState></div>
              )}
            </div>
            <p className="flex items-center gap-1.5 px-2 text-[11px] text-mist-500"><WifiOff size={12} /> Le fond de carte (OpenStreetMap) nécessite une connexion Internet.</p>
            <Card className="p-4 lg:hidden"><TopPlaces stats={stats} max={max} color={m.color} onPick={flyTo} unit={m.unit} total={total} /></Card>
          </div>
        </div>
      )}
    </ChartFrame>
  )
}

function TopPlaces({ stats, max, color, onPick, unit, total }: { stats: PlaceStat[]; max: number; color: string; onPick: (s: PlaceStat) => void; unit: [string, string]; total: number }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-night-900">Lieux principaux</h3>
        <span className="text-xs text-mist-500">{total} {total > 1 ? unit[1] : unit[0]} · {stats.length} lieux</span>
      </div>
      {stats.length === 0 && <p className="text-sm text-mist-500">Aucun lieu.</p>}
      <ol className="space-y-1.5">
        {stats.slice(0, 10).map((s, i) => (
          <li key={s.key}>
            <button onClick={() => onPick(s)} className="w-full text-left">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-4 text-right text-xs tabular-nums text-mist-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-night-900" title={s.name}>{shortPlace(s.name)}</span>
                <span className="text-xs font-semibold tabular-nums" style={{ color }}>{s.count}</span>
              </div>
              <div className="ml-6 mt-0.5 h-1.5 overflow-hidden rounded-full bg-black/[0.05]"><div className="h-full rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: color }} /></div>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

