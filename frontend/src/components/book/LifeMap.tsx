import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'

export interface MapPoint { n: number; name: string | null; lat: number | null; lon: number | null }

/**
 * Carte au style ancien (tuiles OpenStreetMap passées au sépia, filet de parcours en pointillés, repères numérotés).
 * Le fond de carte nécessite Internet ; sans connexion, le parcours et les repères restent visibles sur le papier.
 */
export function LifeMap({ points, path = true, height }: { points: MapPoint[]; path?: boolean; height?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  const located = points.filter((p): p is MapPoint & { lat: number; lon: number } => p.lat != null && p.lon != null)
  const key = located.map((p) => `${p.n}:${p.lat}:${p.lon}`).join('|')

  useEffect(() => {
    if (!box.current || located.length === 0) return
    const map = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false } as L.MapOptions)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 16, attribution: 'Fond : © contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, teinté façon carte ancienne',
    })
    let errors = 0
    tiles.on('tileerror', () => { errors += 1; if (errors >= 3) setTilesFailed(true) })
    tiles.addTo(map)
    const latlngs = located.map((p) => L.latLng(p.lat, p.lon))
    if (path && latlngs.length > 1) L.polyline(latlngs, { color: '#7a1f12', weight: 2.4, dashArray: '6 7', opacity: 0.9 }).addTo(map)
    // Un repère par lieu (plusieurs numéros si un lieu revient)
    const byPos = new Map<string, { lat: number; lon: number; ns: number[]; name: string | null }>()
    for (const p of located) {
      const k = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`
      const cur = byPos.get(k) ?? { lat: p.lat, lon: p.lon, ns: [], name: p.name }
      cur.ns.push(p.n)
      byPos.set(k, cur)
    }
    for (const v of byPos.values()) {
      const label = v.ns.join('·')
      const icon = L.divIcon({ className: '', html: `<div class="book-pin" style="${label.length > 2 ? 'width:auto;padding:0 6px' : ''}">${label}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] })
      L.marker([v.lat, v.lon], { icon, keyboard: false }).addTo(map)
        .bindTooltip(v.name ?? '', { permanent: true, direction: 'right', offset: [12, 0], className: 'book-pin-label', opacity: 1 })
    }
    if (latlngs.length === 1) map.setView(latlngs[0], 10)
    else map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36], maxZoom: 11 })
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(box.current)
    return () => { ro.disconnect(); map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path])

  if (located.length === 0) {
    return <div className="book-map flex items-center justify-center p-6 text-center text-[14px] italic" style={{ height: 140, color: '#85785f' }}>Aucun de ces lieux n’a encore de coordonnées : la carte s’affichera quand ils seront localisés (liste des lieux).</div>
  }
  return (
    <div>
      <div className="book-map" style={height ? { height } : undefined}><div ref={box} className="h-full w-full" /></div>
      <p className="book-small mt-1 italic">
        {tilesFailed ? 'Fond de carte indisponible (connexion Internet nécessaire) : seuls le parcours et les repères sont dessinés.' : 'Fond de carte : OpenStreetMap, teinté façon carte ancienne (nécessite Internet).'}
      </p>
    </div>
  )
}
