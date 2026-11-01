import { memo, useMemo, useState } from 'react'
import type { PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { AddRelativeMenu } from '../../components/relatives/AddRelative'
import { Avatar } from '../../components/charts/Avatar'
import PanZoomCanvas from '../../components/charts/PanZoomCanvas'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { usePersonDetail } from '../../components/charts/usePersonDetail'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { CardStylePanel } from '../../components/charts/CardOptionsPanel'
import { elbowPath, rankedParents } from '../../components/charts/family'
import { birthText, deathText, fullName, GRAPH_COLOR } from '../../components/charts/format'
import { cardBackground, DEFAULT_CARD_OPTIONS, type CardOptions } from '../../components/charts/PersonCard'
import { Spinner } from '../../components/ui'

const W = 156, H = 178, GAP = 26, ROW = H + 90
interface Opts extends CardOptions { siblings: boolean }
interface Item { key: string; p: PersonSummary; x: number; y: number; role: string; center?: boolean }

const SocioCard = memo(function SocioCard({ it, opts, onPick }: { it: Item; opts: Opts; onPick: (p: PersonSummary) => void }) {
  const p = it.p, b = birthText(p), d = deathText(p)
  return (
    <button onClick={() => onPick(p)} className={`absolute flex flex-col items-center rounded-2xl px-2 pb-2 pt-3 text-center shadow-[0_8px_22px_-12px_rgba(25,35,70,0.45)] transition-transform hover:-translate-y-0.5 ${it.center ? 'ring-[3px] ring-[#7d828f]' : 'ring-1 ring-black/10'}`}
      style={{ left: it.x - W / 2, top: it.y, width: W, height: H, background: cardBackground(p, opts.colorMode) }} title={`${fullName(p)} — ${it.role}`}>
      {opts.showPhotos ? <Avatar person={p} size={62} shape="square" /> : <span className="h-2" />}
      <span className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-tight text-night-900">{fullName(p)}</span>
      <span className="mt-1 text-[10.5px] leading-snug text-night-900/70">
        {b && <span className="block">☆ Naissance {b}</span>}
        {d && <span className="block">† Décès {d}</span>}
        {!b && !d && <span className="block text-mist-400">Dates inconnues</span>}
      </span>
      <span className="mt-auto rounded-full bg-white/70 px-2 py-px text-[9.5px] font-semibold uppercase tracking-wide text-mist-500">{it.role}</span>
    </button>
  )
})

export default function SociogramPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref<Opts>('sociogramme', { ...DEFAULT_CARD_OPTIONS, siblings: true })
  const { detail, loading, error, reload } = usePersonDetail(focusId)
  const [adding, setAdding] = useState(false)

  const { items, paths, w, h, tx, ty } = useMemo(() => {
    if (!detail) return { items: [] as Item[], paths: [] as string[], w: 0, h: 0, tx: 0, ty: 0 }
    const role = (p: PersonSummary, m: string, f: string, n: string) => (p.sex === 'M' ? m : p.sex === 'F' ? f : n)
    const byBirth = (a: PersonSummary, b: PersonSummary) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999)
    const sibs = opts.siblings ? [...detail.siblings].sort(byBirth) : []
    const older = sibs.filter((s) => (s.birth_year ?? 9999) <= (detail.birth_year ?? 9999))
    const younger = sibs.filter((s) => !older.includes(s))
    const spouses = detail.spouses
    const row: Item[] = []
    const mid = [...older.map((p) => ({ p, role: role(p, 'Frère', 'Sœur', 'Fratrie') })), { p: detail as PersonSummary, role: 'Personne centrale', center: true }, ...spouses.map((p) => ({ p, role: role(p, 'Conjoint', 'Conjointe', 'Conjoint(e)') })), ...younger.map((p) => ({ p, role: role(p, 'Frère', 'Sœur', 'Fratrie') }))]
    const ci = older.length
    mid.forEach((m, i) => row.push({ key: `m${m.p.id}`, p: m.p, x: (i - ci) * (W + GAP), y: ROW, role: m.role, center: 'center' in m }))
    const rp = rankedParents(detail)
    const parents = [...rp.main, ...rp.others.map((o) => o.p)]
    const parentRole = (p: PersonSummary) => {
      const r = rp.relationOf(p.id)
      if (r === 'step') return role(p, 'Beau-père', 'Belle-mère', 'Beau-parent')
      if (r === 'adoptive') return role(p, 'Père adoptif', 'Mère adoptive', 'Parent adoptif')
      if (r === 'foster') return role(p, 'Père nourricier', 'Mère nourricière', 'Parent nourricier')
      return role(p, 'Père', 'Mère', 'Parent')
    }
    const sibXs = row.filter((r) => r.role !== 'Conjoint' && r.role !== 'Conjointe' && r.role !== 'Conjoint(e)').map((r) => r.x)
    const sibCenter = (Math.min(...sibXs) + Math.max(...sibXs)) / 2
    const top: Item[] = parents.map((p, i) => ({ key: `p${p.id}`, p, x: sibCenter + (i - (rp.main.length - 1) / 2) * (W + GAP), y: 0, role: parentRole(p) }))
    const kids = [...detail.children].sort(byBirth)
    const spouseX = row.find((r) => spouses[0] && r.p.id === spouses[0].id)?.x
    const kidCenter = spouseX !== undefined ? spouseX / 2 : 0
    const bottom: Item[] = kids.map((p, i) => ({ key: `c${p.id}`, p, x: kidCenter + (i - (kids.length - 1) / 2) * (W + GAP), y: 2 * ROW, role: role(p, 'Fils', 'Fille', 'Enfant') }))
    const all = [...top, ...row, ...bottom]
    const ps: string[] = []
    if (top.length) {
      const cy = H / 2
      const main = top.slice(0, rp.main.length)
      if (main.length > 1) ps.push(`M${main[0].x},${cy} H${main[main.length - 1].x}`)
      for (const o of top.slice(rp.main.length)) ps.push(`M${main[main.length - 1]?.x ?? o.x},${cy + 14} H${o.x}`)
      const sx = (main[0].x + main[main.length - 1].x) / 2, sy = main.length > 1 ? cy : H
      for (const r of row) if (!r.role.startsWith('Conjoint')) ps.push(elbowPath(sx, sy, r.x, ROW, 10, true, ROW - 40))
    }
    for (const s of row.filter((r) => r.role.startsWith('Conjoint'))) ps.push(`M0,${ROW + H / 2} H${s.x}`)
    for (const k of bottom) ps.push(elbowPath(kidCenter, spouseX !== undefined ? ROW + H / 2 : ROW + H, k.x, 2 * ROW, 10, true, 2 * ROW - 40))
    const xs = all.map((i) => i.x)
    const minX = Math.min(...xs) - W / 2 - 30, maxX = Math.max(...xs) + W / 2 + 30
    const ys = all.map((i) => i.y)
    const minY = Math.min(...ys) - 30, maxY = Math.max(...ys) + H + 30
    for (const it of all) { it.x -= minX; it.y -= minY }
    return { items: all, paths: ps, w: maxX - minX, h: maxY - minY, tx: -minX, ty: -minY }
  }, [detail, opts.siblings])
  const pz = usePanZoom({ maxScale: 2.5 })
  const name = focus ? fullName(focus) : ''
  const empty = detail && !detail.parents.length && !detail.spouses.length && !detail.children.length && !detail.siblings.length

  return (
    <ChartFrame title={`Sociogramme${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Sociogramme"><p>Le cercle familial proche de la personne centrale : ses parents au-dessus, ses frères et sœurs et ses conjoints sur sa ligne, ses enfants en dessous.</p><p>Touchez une carte pour recentrer le sociogramme sur cette personne.</p></HelpText>}
      actions={<ChartActions exportTarget={() => pz.contentRef.current} filename={`Sociogramme ${name}`} />}
      styleOptions={<CardStylePanel opts={opts} onChange={setOpts} />}
      options={<OptionGroup title="Contenu">
        <ToggleRow label="Frères et sœurs" checked={opts.siblings} onChange={(v) => setOpts({ siblings: v })} />
        <ToggleRow label="Photos" checked={opts.showPhotos} onChange={(v) => setOpts({ showPhotos: v })} />
      </OptionGroup>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <PanZoomCanvas pz={pz} width={w} height={h} fitKey={detail ? `${detail.id}:${opts.siblings}:${items.length}` : undefined} background="grid"
          overlay={<>
            {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
            {empty && (
              <div className="absolute inset-x-3 bottom-24 z-10 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-sm shadow-lg ring-1 ring-black/5" data-nopan>
                <span className="flex-1">Aucun proche n’est encore relié à {detail?.display_name}.</span>
                <button className="shrink-0 rounded-full bg-[#13918c] px-3 py-1.5 text-xs font-medium text-white" onClick={() => setAdding(true)}>Ajouter des proches</button>
              </div>
            )}
          </>}>
          <svg className="pointer-events-none absolute left-0 top-0" width={w} height={h}>
            <g transform={`translate(${tx},${ty})`}>{paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#6a5fb5" strokeWidth={1.8} strokeDasharray="6 5" strokeLinecap="round" />)}</g>
          </svg>
          {items.map((it) => <SocioCard key={it.key} it={it} opts={opts} onPick={(p) => setFocusId(p.id)} />)}
        </PanZoomCanvas>
      )}
      {adding && detail && <AddRelativeMenu anchor={{ id: detail.id, display_name: detail.display_name, sex: detail.sex, surname: detail.surname }} onClose={() => setAdding(false)} onAdded={() => reload()} />}
    </ChartFrame>
  )
}
