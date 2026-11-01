/** Aides géométriques SVG (coordonnées polaires, secteurs, arcs). Angles en degrés, sens horaire à l'écran, 0° = droite. */
export const rad = (d: number) => (d * Math.PI) / 180
export const polar = (r: number, deg: number) => ({ x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)) })

/** Secteur d'anneau entre r1 et r2, de a1 à a2 (a2 > a1). */
export function sector(r1: number, r2: number, a1: number, a2: number) {
  if (a2 - a1 >= 359.99) {
    // Anneau complet : deux demi-cercles (un seul arc de 360° ne se dessine pas).
    return `M${r2},0 A${r2},${r2} 0 1 1 ${-r2},0 A${r2},${r2} 0 1 1 ${r2},0 Z M${r1},0 A${r1},${r1} 0 1 0 ${-r1},0 A${r1},${r1} 0 1 0 ${r1},0 Z`
  }
  const large = a2 - a1 > 180 ? 1 : 0
  const p1 = polar(r2, a1), p2 = polar(r2, a2), p3 = polar(r1, a2), p4 = polar(r1, a1)
  if (r1 <= 0) return `M0,0 L${p1.x},${p1.y} A${r2},${r2} 0 ${large} 1 ${p2.x},${p2.y} Z`
  return `M${p1.x},${p1.y} A${r2},${r2} 0 ${large} 1 ${p2.x},${p2.y} L${p3.x},${p3.y} A${r1},${r1} 0 ${large} 0 ${p4.x},${p4.y} Z`
}

/** Arc à rayon r, parcouru dans le sens horaire (reverse = sens antihoraire, pour un texte lisible en bas). */
export function arc(r: number, a1: number, a2: number, reverse = false) {
  const large = a2 - a1 > 180 ? 1 : 0
  if (!reverse) { const p = polar(r, a1), q = polar(r, a2); return `M${p.x},${p.y} A${r},${r} 0 ${large} 1 ${q.x},${q.y}` }
  const p = polar(r, a2), q = polar(r, a1)
  return `M${p.x},${p.y} A${r},${r} 0 ${large} 0 ${q.x},${q.y}`
}

/** Le milieu de l'arc est-il dans la moitié haute de l'écran (texte posé « à l'endroit » dans le sens horaire) ? */
export const upperHalf = (deg: number) => { const a = ((deg % 360) + 360) % 360; return a >= 180 || a === 0 }

/** Coupe un texte en lignes d'au plus `max` caractères (aux espaces / virgules). */
export function wrap(text: string, max: number, maxLines = 2) {
  const words = text.split(/(?<=,)\s+|\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = kept[maxLines - 1].replace(/.?$/, '…'); return kept }
  return lines
}

/** Mélange une couleur hexadécimale vers le blanc (t = 0 → couleur, 1 → blanc). */
export function lighten(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * Math.max(0, Math.min(1, t))))
  return `rgb(${c.join(',')})`
}
