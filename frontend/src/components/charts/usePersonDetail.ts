import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type PersonDetail } from '../../api'

/** Fiche détaillée d'une personne (parents, conjoints, enfants, frères et sœurs), rechargeable. */
export function usePersonDetail(id: string | null) {
  const [detail, setDetail] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!id) { setDetail(null); return }
    const my = ++seq.current
    setLoading(true); setError(null)
    try { const d = await api.person(id); if (my === seq.current) setDetail(d) }
    catch (e) { if (my === seq.current) setError(e instanceof ApiError ? e.message : 'Impossible de charger la fiche.') }
    finally { if (my === seq.current) setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])
  return { detail, loading, error, reload: load }
}
