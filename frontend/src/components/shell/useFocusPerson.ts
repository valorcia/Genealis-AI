import { useCallback, useEffect, useState } from 'react'
import { api, type PersonSummary } from '../../api'

const KEY = 'genealis.focusPerson'

/**
 * Personne « centrale » partagée par tous les graphiques, vues et rapports (comme le bouton 👤 de MacFamilyTree).
 * Ordre de priorité : paramètre d'URL ?personne=, dernière personne choisie, personne de départ, première personne.
 */
export function useFocusPerson() {
  const [persons, setPersons] = useState<PersonSummary[]>([])
  const [focusId, setFocusIdState] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('personne')
    if (fromUrl) return fromUrl
    try { return localStorage.getItem(KEY) } catch { return null }
  })
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.persons(undefined, 2000)
      setPersons(list)
      setFocusIdState((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list.find((p) => p.is_root) ?? list[0])?.id ?? null))
    } catch { setPersons([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload])
  const setFocusId = useCallback((id: string) => { setFocusIdState(id); try { localStorage.setItem(KEY, id) } catch { /* stockage indisponible */ } }, [])
  const focus = persons.find((p) => p.id === focusId) ?? null
  return { persons, focus, focusId, setFocusId, loading, reload }
}
