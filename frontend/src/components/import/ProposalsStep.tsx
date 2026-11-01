import { useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, BookMarked, CalendarDays, Check, ChevronDown, CircleCheck, GitBranch, Info, Search, ShieldAlert, Sparkles, UserPlus, Users, X } from 'lucide-react'
import type { PersonSummary } from '../../api'
import type { PersonMatch, ProposedAction, ProposedPerson, Proposals } from '../../lib/interpretApi'
import { Spinner } from '../ui'
import { Callout, PersonSearch, lifespan } from './shared'

const LEVEL: Record<string, { cls: string; bar: string; label: string }> = {
  green: { cls: 'conf-green', bar: 'bg-conf-green', label: 'forte' },
  orange: { cls: 'conf-orange', bar: 'bg-conf-orange', label: 'moyenne' },
  red: { cls: 'conf-red', bar: 'bg-conf-red', label: 'faible' },
  grey: { cls: 'conf-grey', bar: 'bg-mist-400', label: 'inconnue' },
}
const GROUPS: { id: ProposedAction['group']; title: string; icon: LucideIcon; hint: string }[] = [
  { id: 'persons', title: 'Personnes', icon: Users, hint: 'Qui est qui dans votre arbre' },
  { id: 'events', title: 'Événements', icon: CalendarDays, hint: 'Dates, lieux, professions, domiciles' },
  { id: 'relations', title: 'Liens familiaux', icon: GitBranch, hint: 'Parents, enfants, couples' },
  { id: 'source', title: 'Source', icon: BookMarked, hint: 'Pour savoir d’où vient chaque information' },
  { id: 'verify', title: 'À vérifier', icon: ShieldAlert, hint: 'Le document ne dit pas la même chose que l’arbre : rien ne sera écrasé, une question sera créée' },
]
const MODE_CHIP: Record<string, { cls: string; label: string }> = {
  add: { cls: 'bg-ios-blue/10 text-ios-blue', label: 'nouveau' }, complete: { cls: 'conf-green', label: 'complète l’existant' },
  exists: { cls: 'conf-grey', label: 'déjà présent' }, conflict: { cls: 'conf-orange', label: 'contradiction' },
}

function MatchExplain({ m }: { m: PersonMatch }) {
  const lv = LEVEL[m.level] ?? LEVEL.grey
  return (
    <div className="space-y-2 rounded-xl bg-ivory-100 p-3 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-night-900">{m.name}</span><span className="text-mist-500">{lifespan(m)}{m.birth_place ? ` · ${m.birth_place}` : ''}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-mist-200"><div className={`h-full rounded-full ${lv.bar}`} style={{ width: `${Math.max(4, m.total)}%` }} /></div>
        <span className={`chip ${lv.cls}`}>{Math.round(m.total)} % · {lv.label}</span>
      </div>
      {m.context && <p className="flex items-start gap-1.5 text-night-900"><GitBranch size={13} className="mt-0.5 shrink-0 text-ios-blue" />{m.context}</p>}
      <ul className="space-y-1">
        {m.criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c.score >= 80 ? 'bg-conf-green' : c.score >= 50 ? 'bg-conf-orange' : 'bg-conf-red'}`} />
            <span className="min-w-0"><b className="font-medium">{c.label}</b> <span className="text-mist-500">— {c.detail}</span></span>
          </li>
        ))}
      </ul>
      {m.blocking.length > 0 && <p className="text-conf-red">Incompatible : {m.blocking.join(', ')}</p>}
      {m.criteria.length <= 3 && <p className="text-mist-500">Peu d’indices en dehors du nom : un nom identique ne suffit pas à prouver que c’est la même personne.</p>}
    </div>
  )
}

function Check2({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-ios-blue bg-ios-blue text-white' : 'border-mist-300 bg-white'}`}>
      {on && <Check size={17} strokeWidth={3} />}
    </button>
  )
}

function PersonProposal({ p, selected, override, overrideName, onToggle, onChoose }: {
  p: ProposedPerson; selected: boolean; override: string | undefined; overrideName: string | null
  onToggle: (v: boolean) => void; onChoose: (choice: string | null, name?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState(false)
  const [search, setSearch] = useState<PersonSummary | null>(null)
  const effective = override ?? (p.resolution === 'match' || p.resolution === 'weak' ? p.person_id : p.resolution === 'new' ? 'new' : null)
  const status = override === 'ignore' ? { cls: 'conf-grey', text: 'Non ajouté(e)' }
    : override === 'new' ? { cls: 'bg-ios-blue/10 text-ios-blue', text: 'Nouvelle personne' }
    : override ? { cls: 'conf-green', text: 'Personne choisie' }
    : p.resolution === 'match' ? { cls: 'conf-green', text: 'Déjà dans l’arbre' }
    : p.resolution === 'weak' ? { cls: 'conf-orange', text: 'À vérifier' }
    : p.resolution === 'new' ? { cls: 'bg-ios-blue/10 text-ios-blue', text: 'Nouvelle personne' }
    : { cls: 'conf-grey', text: 'Seulement mentionné(e)' }
  const target = override && override !== 'new' && override !== 'ignore' ? overrideName
    : !override && (p.resolution === 'match' || p.resolution === 'weak') ? p.person_name : null
  const facts = [p.age !== null && `${p.age} ans`, p.occupation, p.residence && `domicile : ${p.residence}`, p.birth_year && !p.age && `né(e) vers ${p.birth_year}`].filter(Boolean).join(' · ')
  const top = p.matches[0]
  return (
    <div className={`rounded-2xl border bg-white p-3 transition-shadow ${selected ? 'border-ios-blue/50 shadow-[0_4px_14px_-8px_rgba(47,111,209,0.6)]' : 'border-ivory-200'}`}>
      <div className="flex items-start gap-3">
        {p.action_id ? <Check2 on={selected} onChange={onToggle} label={`Retenir ${p.name}`} /> : <span className="h-7 w-7 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gold-600">{p.role_label}</span>
            <span className={`chip ${status.cls}`}>{status.text}</span>
          </div>
          <div className="mt-0.5 text-[16px] font-semibold text-night-900">{p.name}</div>
          {facts && <div className="text-[13px] text-mist-500">{facts}</div>}
          {target && <div className="mt-1 flex items-center gap-1.5 text-[13.5px] text-night-900"><CircleCheck size={14} className={p.resolution === 'weak' && !override ? 'text-conf-orange' : 'text-conf-green'} />{p.resolution === 'weak' && !override ? 'Peut-être ' : '= '}<b>{target}</b></div>}
          {p.reason && !override && <p className="mt-1 text-[12.5px] leading-snug text-mist-500">{p.reason}</p>}
          {p.tree_conflict && !override && <p className="mt-1 flex items-start gap-1 text-[12.5px] text-conf-orange"><AlertTriangle size={13} className="mt-0.5 shrink-0" />L’arbre indique déjà {p.tree_conflict.name} comme {p.tree_conflict.kin} de {p.tree_conflict.anchor}.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {top && <button type="button" className="btn-ghost !min-h-9 !px-2.5 !py-1 text-[13px]" onClick={() => setWhy((v) => !v)}><Info size={14} />Pourquoi ? <ChevronDown size={13} className={why ? 'rotate-180' : ''} /></button>}
            {p.resolution !== 'ignore' && <button type="button" className="btn-ghost !min-h-9 !px-2.5 !py-1 text-[13px]" onClick={() => setOpen((v) => !v)}><Search size={14} />Choisir une autre personne</button>}
            {override && <button type="button" className="btn-ghost !min-h-9 !px-2.5 !py-1 text-[13px]" onClick={() => onChoose(null)}><X size={14} />Revenir à la proposition</button>}
          </div>
          {why && top && <div className="mt-2 space-y-2">{p.matches.map((m) => <MatchExplain key={m.person_id} m={m} />)}</div>}
          {open && (
            <div className="mt-2 space-y-1.5 rounded-xl border border-ivory-300 bg-ivory-50 p-2">
              {p.matches.map((m) => (
                <button key={m.person_id} type="button" onClick={() => { onChoose(m.person_id, m.name); setOpen(false) }}
                  className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] hover:bg-ivory-100 ${effective === m.person_id ? 'bg-ios-blue/10' : ''}`}>
                  <span className="min-w-0 truncate"><b className="font-medium">{m.name}</b> <span className="text-xs text-mist-500">{lifespan(m)}</span></span>
                  <span className={`chip ${LEVEL[m.level]?.cls ?? 'conf-grey'}`}>{Math.round(m.total)} %</span>
                </button>
              ))}
              <button type="button" onClick={() => { onChoose('new'); setOpen(false) }} className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] hover:bg-ivory-100 ${effective === 'new' ? 'bg-ios-blue/10' : ''}`}><UserPlus size={16} className="text-ios-blue" />Nouvelle personne</button>
              <div className="px-1 pt-1 text-[12px] text-mist-500">Ou une autre personne de l’arbre :</div>
              <PersonSearch value={search} onChange={(s) => { setSearch(s); if (s) { onChoose(s.id, s.display_name); setOpen(false) } }} />
              <button type="button" onClick={() => { onChoose('ignore'); setOpen(false) }} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-mist-500 hover:bg-ivory-100"><X size={16} />Ne pas l’ajouter à l’arbre</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionRow({ a, on, blockedBy, onChange }: { a: ProposedAction; on: boolean; blockedBy: string[]; onChange: (v: boolean) => void }) {
  const chip = a.mode ? MODE_CHIP[a.mode] : null
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Check2 on={on} disabled={blockedBy.length > 0} onChange={onChange} label={a.label} />
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] leading-snug text-night-900">{a.label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {chip && <span className={`chip ${chip.cls}`}>{chip.label}</span>}
          {!a.recommended && a.mode !== 'conflict' && <span className="chip conf-grey">non coché par prudence</span>}
        </div>
        {a.detail && <p className="mt-0.5 text-[12.5px] text-mist-500">{a.detail}</p>}
        {blockedBy.length > 0 && <p className="mt-0.5 text-[12.5px] text-conf-orange">Nécessite de retenir : {blockedBy.join(', ')}</p>}
      </div>
    </li>
  )
}

function Group({ icon: Icon, title, hint, count, total, children }: { icon: LucideIcon; title: string; hint: string; count: number; total: number; children: ReactNode }) {
  return (
    <section className="panel fade-up p-4 sm:p-5">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display text-[18px] text-night-900"><Icon size={18} className="text-ios-blue" />{title}</h3>
          <p className="text-[12.5px] text-mist-500">{hint}</p>
        </div>
        <span className="chip shrink-0 bg-ivory-200 text-night-900">{count}/{total}</span>
      </header>
      {children}
    </section>
  )
}

/** Étape 4 : propositions groupées, cochées seulement quand c'est sûr. */
export function ProposalsStep({ props, busy, onApply }: { props: Proposals; busy: boolean; onApply: (actions: string[], overrides: Record<string, string>) => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(props.actions.map((a) => [a.id, a.checked])))
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const people = useMemo(() => new Map(props.people.map((p) => [p.index, p])), [props.people])
  const personSelected = (i: number, c = checked, o = overrides) => {
    const ov = o[String(i)]
    if (ov === 'ignore') return false
    if (ov) return true
    return !!c[`person:${i}`]
  }
  const cascade = (idx: number, c: Record<string, boolean>, o: Record<string, string>) => {
    const next = { ...c }
    for (const a of props.actions) {
      if (a.id.startsWith('person:') || !a.requires.includes(idx)) continue
      next[a.id] = a.requires.every((j) => personSelected(j, next, o)) ? a.recommended : false
    }
    return next
  }
  const togglePerson = (i: number, v: boolean) => {
    const o = { ...overrides }
    if (!v && o[String(i)] && o[String(i)] !== 'ignore') delete o[String(i)]
    if (v && o[String(i)] === 'ignore') delete o[String(i)]
    let c = cascade(i, { ...checked, [`person:${i}`]: v }, o)
    // Les nouvelles fiches rattachées à cette personne (ses parents, les membres de son ménage) suivent son choix
    const follow = (anchor: number, seen: Set<number>) => {
      for (const p of props.people) {
        if (p.anchor !== anchor || seen.has(p.index) || p.resolution !== 'new' || o[String(p.index)] || !p.action_id) continue
        seen.add(p.index)
        const act = props.actions.find((a) => a.id === p.action_id)
        c = cascade(p.index, { ...c, [p.action_id]: v ? !!act?.recommended : false }, o)
        follow(p.index, seen)
      }
    }
    follow(i, new Set([i]))
    setOverrides(o)
    setChecked(c)
  }
  const choose = (i: number, choice: string | null, name?: string) => {
    const o = { ...overrides }
    if (choice === null) delete o[String(i)]
    else o[String(i)] = choice
    const c = { ...checked, [`person:${i}`]: choice === null ? !!props.actions.find((a) => a.id === `person:${i}`)?.checked : choice !== 'ignore' }
    if (name) setNames((n) => ({ ...n, [String(i)]: name }))
    setOverrides(o)
    setChecked(cascade(i, c, o))
  }
  const blockedBy = (a: ProposedAction) => a.requires.filter((j) => !personSelected(j)).map((j) => people.get(j)?.name ?? `#${j}`)
  const selectedIds = props.actions.filter((a) => checked[a.id] && blockedBy(a).length === 0).map((a) => a.id)
  const nbChanges = selectedIds.length
  const nonPersonActions = (g: ProposedAction['group']) => props.actions.filter((a) => a.group === g && !a.id.startsWith('person:'))
  const persons = props.people.filter((p) => p.resolution !== 'ignore' || p.name)

  return (
    <div className="space-y-4">
      <section className="panel fade-up p-4 sm:p-5">
        <h2 className="font-display text-[19px] text-night-900">4. Ce que je propose d’ajouter à votre arbre</h2>
        <p className="mt-1 text-[13.5px] text-mist-500">Tout ce qui est sûr est déjà coché. Ce qui est douteux ne l’est pas : à vous de décider. Rien n’est écrasé.</p>
        <div className="mt-3 space-y-2">
          <Callout tone="ai" icon={Sparkles}>Ces propositions viennent d’une lecture par l’IA : vérifiez les noms et les dates sur l’image avant de valider.</Callout>
          {props.warnings.map((w, i) => <Callout key={i} tone="warn" icon={AlertTriangle}>{w}</Callout>)}
        </div>
      </section>

      <Group icon={Users} title="Personnes" hint={GROUPS[0].hint} count={persons.filter((p) => personSelected(p.index)).length} total={persons.length}>
        <div className="space-y-2.5">
          {persons.map((p) => (
            <PersonProposal key={p.index} p={p} selected={personSelected(p.index)} override={overrides[String(p.index)]} overrideName={names[String(p.index)] ?? null}
              onToggle={(v) => togglePerson(p.index, v)} onChoose={(c, n) => choose(p.index, c, n)} />
          ))}
        </div>
        {nonPersonActions('persons').length > 0 && (
          <ul className="mt-2 divide-y divide-ivory-200">{nonPersonActions('persons').map((a) => <ActionRow key={a.id} a={a} on={!!checked[a.id]} blockedBy={blockedBy(a)} onChange={(v) => setChecked({ ...checked, [a.id]: v })} />)}</ul>
        )}
      </Group>

      {GROUPS.slice(1).map((g) => {
        const acts = nonPersonActions(g.id)
        if (!acts.length) return null
        return (
          <Group key={g.id} icon={g.icon} title={g.title} hint={g.hint} count={acts.filter((a) => checked[a.id] && !blockedBy(a).length).length} total={acts.length}>
            <ul className="divide-y divide-ivory-200">{acts.map((a) => <ActionRow key={a.id} a={a} on={!!checked[a.id] && !blockedBy(a).length} blockedBy={blockedBy(a)} onChange={(v) => setChecked({ ...checked, [a.id]: v })} />)}</ul>
          </Group>
        )
      })}

      <div className="sticky bottom-2 z-20 space-y-1.5 rounded-2xl bg-white/85 p-2 shadow-[0_-6px_24px_-12px_rgba(28,35,51,0.35)] backdrop-blur">
        <button type="button" className="btn-primary w-full !min-h-13 !rounded-2xl !text-[17px]" disabled={busy || nbChanges === 0} onClick={() => onApply(selectedIds, overrides)}>
          {busy ? <Spinner /> : <Check size={19} />}Ajouter à l’arbre ({nbChanges})
        </button>
        <p className="hidden text-center text-[11.5px] text-mist-500 sm:block">Chaque ajout est noté dans le journal et relié à ce document. Vous pourrez tout modifier ensuite.</p>
      </div>
    </div>
  )
}
