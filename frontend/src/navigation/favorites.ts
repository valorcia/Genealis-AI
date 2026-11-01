import { useSyncExternalStore } from 'react'
import { ALL_TILES, DEFAULT_FAVORITES, type SectionId, type Tile } from './sections'

/**
 * Favoris de l'utilisateur (tuiles épinglées dans la catégorie « Favoris »).
 * Stockés dans le navigateur sous forme de clés « <section>:<tuile> ». Toute lecture ou écriture
 * est protégée : en navigation privée ou si le stockage est bloqué, on retombe sur les favoris par défaut.
 */
const STORAGE_KEY = 'genealis.favorites'

let cache: string[] | null = null
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const v: unknown = JSON.parse(raw)
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* stockage indisponible */ }
  return [...DEFAULT_FAVORITES]
}

function emit() { listeners.forEach((l) => l()) }

export function favoriteKey(section: SectionId, tileId: string) { return `${section}:${tileId}` }

export function getFavorites(): string[] {
  if (cache === null) cache = read()
  return cache
}

export function setFavorites(keys: string[]) {
  cache = [...new Set(keys)]
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)) } catch { /* stockage indisponible */ }
  emit()
}

export function isFavorite(key: string) { return getFavorites().includes(key) }

/** Ajoute ou retire une tuile des favoris ; renvoie true si elle est désormais favorite. */
export function toggleFavorite(key: string): boolean {
  const cur = getFavorites()
  const on = !cur.includes(key)
  setFavorites(on ? [...cur, key] : cur.filter((k) => k !== key))
  return on
}

export function resetFavorites() { setFavorites([...DEFAULT_FAVORITES]) }

/** Tuiles favorites résolues (dans l'ordre choisi), avec leur section d'origine. */
export function favoriteTiles(keys: string[]): (Tile & { section: SectionId })[] {
  return keys.map((k) => ALL_TILES.find((t) => favoriteKey(t.section, t.id) === k)).filter((t): t is Tile & { section: SectionId } => !!t)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) { cache = read(); cb() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
}

/** Hook React : liste des favoris, mise à jour à chaque changement (y compris depuis un autre onglet). */
export function useFavorites(): string[] {
  return useSyncExternalStore(subscribe, getFavorites, getFavorites)
}
