import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type PersonSummary } from '../api'
import { Tabs } from '../components/person/helpers'
import { SourcesTab } from '../components/archives/SourcesTab'
import { DocumentsTab } from '../components/archives/DocumentsTab'
import { ImportExportTab } from '../components/archives/ImportExportTab'
import { InseeTab } from '../components/archives/InseeTab'

const TABS = [{ id: 'sources', label: 'Sources' }, { id: 'documents', label: 'Documents' }, { id: 'import', label: 'Import / Export' }, { id: 'insee', label: 'Décès INSEE' }]

export default function ArchivesPage() {
  const [params, setParams] = useSearchParams()
  const sourceId = params.get('source')
  const mediaId = params.get('media')
  const tab = params.get('tab') ?? (mediaId ? 'documents' : 'sources')
  const [persons, setPersons] = useState<PersonSummary[]>([])
  useEffect(() => { api.persons().then(setPersons).catch(() => setPersons([])) }, [])
  const setTab = (t: string) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', t); n.delete('source'); n.delete('media'); return n }, { replace: true })
  const selectSource = useCallback((id: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', 'sources'); if (id) n.set('source', id); else n.delete('source'); return n }, { replace: true }), [setParams])
  const selectMedia = useCallback((id: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', 'documents'); if (id) n.set('media', id); else n.delete('media'); return n }, { replace: true }), [setParams])
  return (
    <div className="space-y-4">
      <header className="fade-up">
        <h1 className="font-display text-3xl text-night-900">Archives et documents</h1>
        <p className="text-xs text-mist-500">Sources citées, documents originaux, imports et exports, index local des décès.</p>
      </header>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'sources' && <SourcesTab selectedId={sourceId} onSelect={selectSource} />}
      {tab === 'documents' && <DocumentsTab selectedId={mediaId} onSelect={selectMedia} />}
      {tab === 'import' && <ImportExportTab persons={persons} />}
      {tab === 'insee' && <InseeTab />}
    </div>
  )
}
