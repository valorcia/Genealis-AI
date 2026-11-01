import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Globe, LocateFixed, MapPin, WifiOff } from 'lucide-react'
import { api, ApiError, EVENT_LABEL, type MapData } from '../api'
import { useApp } from '../store'
import { Empty, Spinner } from '../components/ui'

type Filter = 'naissances' | 'mariages' | 'deces' | 'residences' | 'migrations' | 'autres'
const FILTERS: { id: Filter; label: string; types: string[]; color: string }[] = [
  { id: 'naissances', label: 'Naissances', types: ['birth', 'baptism'], color: '#5f9a6a' },
  { id: 'mariages', label: 'Mariages', types: ['marriage', 'marriage_banns', 'marriage_contract', 'divorce'], color: '#c9a227' },
  { id: 'deces', label: 'Décès', types: ['death', 'burial', 'will', 'probate'], color: '#0f1e3a' },
  { id: 'residences', label: 'Résidences', types: ['residence', 'census', 'occupation'], color: '#4a6fa5' },
  { id: 'migrations', label: 'Migrations', types: ['immigration', 'emigration', 'naturalization', 'military'], color: '#7a9a7e' },
  { id: 'autres', label: 'Autres', types: [], color: '#9aa1ad' },
]
const TYPE_TO_FILTER = new Map<string, Filter>(FILTERS.flatMap((f) => f.types.map((t) => [t, f.id] as [string, Filter])))
const filterOf = (t: string): Filter => TYPE_TO_FILTER.get(t) ?? 'autres'

/** Tracés INDICATIFS (approximations grossières, non officielles) de quelques frontières historiques utiles en généalogie. */
const HISTORICAL_BORDERS: GeoJSON.FeatureCollection<GeoJSON.Polygon, { name: string; period: string; color: string }> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Alsace-Moselle annexée (Reichsland)', period: '1871–1918', color: '#b4473c' }, geometry: { type: 'Polygon', coordinates: [[[7.95, 49.04], [8.2, 48.97], [8.05, 48.6], [7.8, 48.2], [7.6, 47.9], [7.58, 47.58], [7.2, 47.55], [6.95, 47.68], [6.9, 47.95], [7.0, 48.2], [7.05, 48.42], [7.15, 48.52], [6.95, 48.62], [6.65, 48.75], [6.45, 48.85], [6.2, 48.95], [6.05, 49.1], [5.95, 49.3], [5.9, 49.45], [6.1, 49.5], [6.4, 49.47], [6.7, 49.3], [7.05, 49.15], [7.4, 49.17], [7.7, 49.05], [7.95, 49.04]]] } },
    { type: 'Feature', properties: { name: 'Duché de Lorraine et de Bar', period: 'vers 1766 (hors enclaves et Trois-Évêchés)', color: '#c9a227' }, geometry: { type: 'Polygon', coordinates: [[[5.0, 48.6], [5.15, 48.35], [5.5, 48.15], [5.9, 48.0], [6.3, 47.95], [6.7, 47.95], [7.0, 48.3], [7.1, 48.6], [6.9, 48.85], [6.7, 49.15], [6.6, 49.3], [6.3, 49.4], [5.9, 49.35], [5.6, 49.2], [5.4, 49.0], [5.1, 48.9], [5.0, 48.6]]] } },
    { type: 'Feature', properties: { name: 'Pologne partagée : Royaume du Congrès (Empire russe)', period: '1815', color: '#4a6fa5' }, geometry: { type: 'Polygon', coordinates: [[[19.0, 52.9], [20.5, 53.1], [21.8, 53.0], [23.4, 52.4], [23.8, 51.7], [23.1, 50.4], [22.0, 50.2], [20.0, 50.3], [19.2, 50.6], [18.6, 51.5], [18.0, 52.3], [18.6, 52.8], [19.0, 52.9]]] } },
    { type: 'Feature', properties: { name: 'Pologne partagée : Grand-duché de Posen (Prusse)', period: '1815', color: '#4a6fa5' }, geometry: { type: 'Polygon', coordinates: [[[15.8, 52.9], [16.5, 53.3], [17.3, 53.5], [18.6, 53.3], [18.6, 52.8], [18.0, 52.3], [17.5, 51.7], [16.6, 51.8], [15.8, 52.1], [15.6, 52.5], [15.8, 52.9]]] } },
    { type: 'Feature', properties: { name: 'Pologne partagée : Galicie (Empire d’Autriche)', period: '1815', color: '#4a6fa5' }, geometry: { type: 'Polygon', coordinates: [[[19.2, 50.6], [20.0, 50.3], [22.0, 50.2], [23.1, 50.4], [24.0, 50.5], [25.2, 50.3], [26.0, 49.8], [26.2, 48.6], [25.0, 48.2], [24.0, 48.4], [22.6, 49.0], [21.0, 49.2], [20.0, 49.3], [19.2, 49.6], [19.2, 50.6]]] } },
  ],
}

function yearColor(year: number | null, lo: number, hi: number) {
  if (year === null || hi <= lo) return '#9aa1ad'
  const t = Math.max(0, Math.min(1, (year - lo) / (hi - lo)))
  const a = [15, 30, 58], b = [201, 162, 39]
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export default function MapPage() {
  const notify = useApp((s) => s.notify)
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ markers: L.LayerGroup; moves: L.LayerGroup; borders: L.LayerGroup } | null>(null)
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<Set<Filter>>(new Set(FILTERS.map((f) => f.id)))
  const [borders, setBorders] = useState(false)
  const [tilesOk, setTilesOk] = useState<boolean | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [editing, setEditing] = useState<{ id: string; lat: string; lon: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const fitted = useRef(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.map()) } catch (e) { setError(e instanceof ApiError ? e.message : 'Impossible de charger la carte.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Création / destruction de la carte
  useEffect(() => {
    if (!mapRef.current || map.current) return
    const m = L.map(mapRef.current, { center: [48.8, 6.2], zoom: 6, zoomControl: true, attributionControl: true, preferCanvas: true })
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a>' })
    tiles.on('tileload', () => setTilesOk(true)); tiles.on('tileerror', () => setTilesOk((v) => (v === true ? v : false)))
    tiles.addTo(m)
    const markers = L.layerGroup().addTo(m); const moves = L.layerGroup().addTo(m); const bordersLayer = L.layerGroup()
    map.current = m; layers.current = { markers, moves, borders: bordersLayer }
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(mapRef.current)
    return () => { ro.disconnect(); m.remove(); map.current = null; layers.current = null }
  }, [])

  const filtered = useMemo(() => {
    if (!data) return { points: [], moves: [] }
    const points = data.points.map((p) => ({ ...p, events: p.events.filter((e) => active.has(filterOf(e.type))) })).filter((p) => p.events.length > 0)
    const moves = active.has('migrations') ? data.moves : []
    return { points, moves }
  }, [data, active])

  // Marqueurs et déplacements
  useEffect(() => {
    const m = map.current, ly = layers.current; if (!m || !ly || !data) return
    ly.markers.clearLayers(); ly.moves.clearLayers()
    const years = data.moves.map((mv) => mv.year).filter((y): y is number => y !== null)
    const lo = years.length ? Math.min(...years) : 0, hi = years.length ? Math.max(...years) : 0
    const bounds: L.LatLngExpression[] = []
    for (const mv of filtered.moves) {
      const line = L.polyline([[mv.from_lat, mv.from_lon], [mv.to_lat, mv.to_lon]], { color: yearColor(mv.year, lo, hi), weight: 2, opacity: 0.8, dashArray: '6 6' })
      line.bindTooltip(`${esc(mv.person)} : ${esc(mv.from)} → ${esc(mv.to)}${mv.year ? ` (${mv.year})` : ''}`, { sticky: true })
      line.addTo(ly.moves)
    }
    for (const p of filtered.points) {
      const n = p.events.length
      const size = Math.round(24 + Math.min(n, 40) * 0.9)
      const dominant = FILTERS.find((f) => f.id === filterOf(p.events[0].type))?.color ?? '#0f1e3a'
      const icon = L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${dominant};border:2px solid #c9a227;box-shadow:0 2px 8px rgba(15,30,58,.35);display:flex;align-items:center;justify-content:center;color:#fdfcf8;font:600 ${n > 99 ? 10 : 11}px Inter,system-ui,sans-serif">${n}</div>` })
      const items = [...p.events].sort((a, b) => (a.year ?? 0) - (b.year ?? 0)).slice(0, 40)
      const html = `<div style="font-family:Inter,system-ui,sans-serif;min-width:200px"><div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;color:#0f1e3a;margin-bottom:4px">${esc(p.name)}</div><div style="font-size:11px;color:#6b7280;margin-bottom:6px">${n} événement${n > 1 ? 's' : ''}</div><ul style="margin:0;padding:0;list-style:none;max-height:220px;overflow:auto;font-size:12px">${items.map((e) => `<li style="padding:2px 0;border-top:1px solid #ece7d6"><span style="color:#6b7280">${e.year ?? '—'}</span> · ${esc(EVENT_LABEL[e.type] ?? e.type)} · <a href="#/personnes/${e.person_id}" style="color:#0f1e3a;font-weight:500">${esc(e.person)}</a></li>`).join('')}${n > 40 ? `<li style="color:#6b7280;padding-top:4px">… et ${n - 40} autre(s)</li>` : ''}</ul></div>`
      L.marker([p.lat, p.lon], { icon, title: p.name }).bindPopup(html, { maxWidth: 320 }).addTo(ly.markers)
      bounds.push([p.lat, p.lon])
    }
    if (bounds.length && (!fitted.current || !m.getBounds().contains(L.latLngBounds(bounds)))) { fitted.current = true; m.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 9 }) }
  }, [data, filtered])

  // Frontières historiques
  useEffect(() => {
    const m = map.current, ly = layers.current; if (!m || !ly) return
    ly.borders.clearLayers()
    if (!borders) { m.removeLayer(ly.borders); return }
    L.geoJSON(HISTORICAL_BORDERS, {
      style: (f) => ({ color: f?.properties.color ?? '#9aa1ad', weight: 1.5, dashArray: '8 5', fillOpacity: 0.06, fillColor: f?.properties.color ?? '#9aa1ad' }),
      onEachFeature: (f, layer) => { layer.bindTooltip(`${esc(f.properties.name)} — ${esc(f.properties.period)}<br><em style="color:#6b7280">Tracé indicatif, non exact</em>`, { sticky: true }) },
    }).addTo(ly.borders)
    ly.borders.addTo(m)
  }, [borders])

  const toggle = (id: Filter) => setActive((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const flyTo = (lat: number, lon: number) => map.current?.flyTo([lat, lon], Math.max(map.current.getZoom(), 10), { duration: 0.8 })

  const geocode = async () => {
    setGeocoding(true)
    try {
      const r = await api.geocodePlaces()
      notify(r.geocoded > 0 ? 'success' : 'info', `${r.geocoded} lieu(x) localisé(s) sur ${r.total}${r.errors.length ? ` · ${r.errors.length} erreur(s)` : ''}.`)
      await load()
    } catch (e) { notify('error', e instanceof ApiError ? e.message : 'Géocodage impossible (connexion Internet requise).') }
    finally { setGeocoding(false) }
  }
  const savePlace = async () => {
    if (!editing) return
    const lat = Number(editing.lat.replace(',', '.')), lon = Number(editing.lon.replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { notify('error', 'Coordonnées invalides (latitude -90…90, longitude -180…180).'); return }
    setSaving(true)
    try { await api.updatePlace(editing.id, { latitude: lat, longitude: lon }); notify('success', 'Lieu localisé.'); setEditing(null); await load() }
    catch (e) { notify('error', e instanceof ApiError ? e.message : "Impossible d'enregistrer le lieu.") }
    finally { setSaving(false) }
  }

  const placeCounts = useMemo(() => (data?.points ?? []).map((p) => ({ ...p, count: p.events.length })).sort((a, b) => b.count - a.count), [data])
  const totalEvents = useMemo(() => (data?.points ?? []).reduce((n, p) => n + p.events.length, 0), [data])

  return (
    <div className="flex h-[calc(100vh-110px)] min-h-[520px] flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-night-900">Carte familiale</h1>
          <p className="text-sm text-mist-500">{data ? `${data.points.length} lieu${data.points.length > 1 ? 'x' : ''} · ${totalEvents} événement${totalEvents > 1 ? 's' : ''} · ${data.moves.length} déplacement${data.moves.length > 1 ? 's' : ''}` : 'Lieux de vie et déplacements de la famille'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => toggle(f.id)} className={`chip cursor-pointer border transition-colors ${active.has(f.id) ? 'border-transparent text-ivory-50' : 'border-ivory-300 bg-white text-mist-500'}`} style={active.has(f.id) ? { background: f.color } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: active.has(f.id) ? '#fdfcf8' : f.color }} />{f.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-night-900"><input type="checkbox" className="accent-gold-500" checked={borders} onChange={(e) => setBorders(e.target.checked)} /> Frontières historiques <span className="text-mist-400">(tracés indicatifs)</span></label>
        </div>
      </header>
      {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/8 px-4 py-2 text-sm text-conf-red">{error}</div>}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="panel relative min-h-[400px] overflow-hidden">
          <div ref={mapRef} className="absolute inset-0 z-0" />
          {loading && <div className="absolute inset-0 z-[500] flex items-center justify-center bg-ivory-50/50"><span className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm shadow"><Spinner /> Chargement des lieux…</span></div>}
          <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-sm rounded-xl border border-ivory-300/70 bg-ivory-50/90 px-3 py-2 text-[11px] text-mist-500 shadow backdrop-blur">
            <span className="inline-flex items-center gap-1.5"><Globe size={12} className="text-sage-600" /> Fond de carte OpenStreetMap : nécessite Internet. Vos données restent locales et l'application fonctionne hors ligne (sans fond de carte).</span>
            {tilesOk === false && <div className="mt-1 inline-flex items-center gap-1.5 text-conf-orange"><WifiOff size={12} /> Fond de carte inaccessible pour le moment : les lieux et trajets restent affichés.</div>}
          </div>
          {borders && <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-xl border border-ivory-300/70 bg-ivory-50/90 px-3 py-2 text-[11px] shadow backdrop-blur">
            <div className="font-semibold text-night-900">Tracés indicatifs</div>
            {HISTORICAL_BORDERS.features.map((f) => <div key={f.properties.name} className="flex items-center gap-1.5 text-mist-500"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: f.properties.color }} />{f.properties.name} · {f.properties.period}</div>)}
            <div className="mt-1 italic text-mist-400">Approximations à but pédagogique, sans valeur cartographique.</div>
          </div>}
          {!loading && data && data.points.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[500] flex -translate-y-1/2 justify-center px-8"><div className="pointer-events-auto max-w-md"><Empty>Aucun lieu géolocalisé pour l'instant. {data.unlocated_places.length > 0 ? 'Utilisez « Géocoder » dans le panneau latéral pour localiser vos lieux.' : 'Ajoutez des événements avec un lieu pour les voir apparaître.'}</Empty></div></div>
          )}
          <div className="pointer-events-none absolute bottom-3 right-3 z-[500] rounded-xl border border-ivory-300/70 bg-ivory-50/90 px-3 py-2 text-[11px] text-mist-500 shadow backdrop-blur">
            <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-night-900" /> déplacement ancien</span>
            <span className="ml-3 inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-gold-500" /> déplacement récent</span>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto scrollbar-thin">
          <section className="panel fade-up p-4">
            <h2 className="mb-2 font-display text-lg text-night-900">Lieux ({placeCounts.length})</h2>
            {placeCounts.length === 0 ? <p className="text-xs text-mist-500">Aucun lieu localisé.</p> : (
              <ul className="max-h-[38vh] space-y-0.5 overflow-auto scrollbar-thin text-sm">
                {placeCounts.map((p) => (
                  <li key={p.place_id}>
                    <button onClick={() => flyTo(p.lat, p.lon)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ivory-200">
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-night-900"><MapPin size={13} className="shrink-0 text-gold-600" /><span className="truncate">{p.name}</span></span>
                      <span className="shrink-0 rounded-full bg-night-900/8 px-2 text-[11px] tabular-nums text-night-900">{p.count}</span>
                    </button>
                  </li>))}
              </ul>)}
          </section>
          <section className="panel fade-up p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg text-night-900">Lieux non localisés ({data?.unlocated_places.length ?? 0})</h2>
              {(data?.unlocated_places.length ?? 0) > 0 && <button className="btn-sage !px-2.5 !py-1 text-xs" disabled={geocoding} onClick={geocode}>{geocoding ? <Spinner /> : <LocateFixed size={13} />} Géocoder (services gratuits)</button>}
            </div>
            <p className="mb-2 text-[11px] text-mist-500">Le géocodage interroge geo.api.gouv.fr puis Nominatim (OpenStreetMap), sans clé ni compte. Vous pouvez aussi saisir les coordonnées à la main.</p>
            {!data || data.unlocated_places.length === 0 ? <p className="text-xs text-mist-500">Tous les lieux connus sont localisés.</p> : (
              <ul className="max-h-[32vh] space-y-1 overflow-auto scrollbar-thin text-sm">
                {data.unlocated_places.map((p) => (
                  <li key={p.id} className="rounded-lg border border-ivory-200 bg-white/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-night-900">{p.name}</span>
                      <button className="shrink-0 text-xs text-gold-600 hover:underline" onClick={() => setEditing(editing?.id === p.id ? null : { id: p.id, lat: '', lon: '' })}>{editing?.id === p.id ? 'Annuler' : 'Saisir lat/lon'}</button>
                    </div>
                    {editing?.id === p.id && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <input className="input !py-1 text-xs" placeholder="Latitude (48.69)" value={editing.lat} onChange={(e) => setEditing({ ...editing, lat: e.target.value })} />
                        <input className="input !py-1 text-xs" placeholder="Longitude (6.18)" value={editing.lon} onChange={(e) => setEditing({ ...editing, lon: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') savePlace() }} />
                        <button className="btn-primary !px-2.5 !py-1 text-xs" disabled={saving} onClick={savePlace}>{saving ? <Spinner /> : 'OK'}</button>
                      </div>)}
                  </li>))}
              </ul>)}
          </section>
        </aside>
      </div>
    </div>
  )
}
