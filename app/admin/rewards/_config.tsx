'use client'

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { checkRewardConfig, type RewardConfig, type RewardConfigSection } from '@/lib/rewardConfig'

/**
 * Shared editor state + UI pieces for the Collector Pass settings pages
 * (/admin/rewards/challenges, /admin/rewards/earning). Each page edits its own
 * sections of the one reward_config document and saves only those; the API
 * re-validates the merged whole and refuses a save made on a stale copy.
 */

export interface RuleStat {
    rule_key: string
    events_today: number
    events_7d: number
    events_30d: number
    users_30d: number
    xp_30d: number
    coins_30d: number
    events_all: number
    users_all: number
    xp_all: number
    coins_all: number
    last_at: string | null
}

export interface DailyStat {
    day: string
    checkins: number
    quests: number
    quest_bonus: number
    earners: number
    xp: number
    coins: number
}

export interface RewardStats {
    today: string
    profiles_total: number
    rules: RuleStat[]
    daily: DailyStat[]
    quest_slots_today: Record<string, number>
    badges: Record<string, number>
}

export interface HistoryEntry {
    id: number
    sections: string[]
    note: string | null
    changedByName: string | null
    createdAt: string
    config: RewardConfig
}

interface ConfigPayload {
    config: RewardConfig
    defaults: RewardConfig
    stored: boolean
    updatedAt: string | null
    updatedByName: string | null
    migrationApplied: boolean
    history: HistoryEntry[]
    stats: RewardStats | null
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function pick(config: RewardConfig, sections: readonly RewardConfigSection[]): Partial<RewardConfig> {
    const out: Record<string, unknown> = {}
    for (const s of sections) out[s] = clone(config[s])
    return out as Partial<RewardConfig>
}

export function useRewardConfigEditor(sections: readonly RewardConfigSection[]) {
    const [data, setData] = useState<ConfigPayload | null>(null)
    const [draft, setDraft] = useState<RewardConfig | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoadError(null)
        try {
            const res = await fetch('/api/admin/rewards/config', { cache: 'no-store' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load')
            setData(json as ConfigPayload)
            setDraft(clone((json as ConfigPayload).config))
        } catch (e) {
            setLoadError((e as Error).message)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const sectionsKey = sections.join(',')
    const dirty = useMemo(() => {
        if (!data || !draft) return false
        return sectionsKey.split(',').some((s) =>
            JSON.stringify(draft[s as RewardConfigSection]) !== JSON.stringify(data.config[s as RewardConfigSection]))
    }, [data, draft, sectionsKey])

    // Same validator the API runs, so a problem shows while typing, not on save.
    const problems = useMemo(() => (draft ? checkRewardConfig(draft).errors : []), [draft])

    const update = useCallback((fn: (next: RewardConfig) => void) => {
        setNotice(null)
        setDraft((prev) => {
            if (!prev) return prev
            const next = clone(prev)
            fn(next)
            return next
        })
    }, [])

    const discard = useCallback(() => {
        if (data) setDraft(clone(data.config))
        setSaveError(null)
    }, [data])

    /** Put a set of values into the draft (defaults, or a past version); nothing saves until Save. */
    const loadValues = useCallback((source: RewardConfig) => {
        setNotice(null)
        setDraft((prev) => (prev ? { ...prev, ...pick(source, sections) } : prev))
    }, [sections])

    const save = useCallback(async (note: string) => {
        if (!draft || !data) return
        setSaving(true)
        setSaveError(null)
        setNotice(null)
        try {
            const res = await fetch('/api/admin/rewards/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sections: pick(draft, sections), note, baseUpdatedAt: data.updatedAt }),
            })
            const json = await res.json()
            if (!res.ok) {
                const list = Array.isArray(json.errors) && json.errors.length ? ` ${json.errors.join(' ')}` : ''
                throw new Error(`${json.error || 'Save failed'}${list}`)
            }
            setNotice('Saved. Live for everyone now (the app picks it up within a minute).')
            await load()
        } catch (e) {
            setSaveError((e as Error).message)
        } finally {
            setSaving(false)
        }
    }, [data, draft, load, sections])

    return { data, draft, dirty, problems, loadError, saveError, notice, saving, update, discard, loadValues, save, reload: load }
}

// ---------------------------------------------------------------------------
// Formatting + UI atoms (admin is EN-only by convention)
// ---------------------------------------------------------------------------

export const fmt = (n: number | null | undefined) => ((n ?? 0) as number).toLocaleString()

export function ruleStat(stats: RewardStats | null, key: string): RuleStat | undefined {
    return stats?.rules.find((r) => r.rule_key === key)
}

export const inputCls = 'h-8 rounded-lg bg-white/5 border border-white/10 px-2 text-sm text-white tabular-nums outline-none focus:border-brand-cyan/60 placeholder:text-slate-600 disabled:opacity-40'
export const btnCls = 'h-9 px-4 rounded-lg bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-wider disabled:opacity-40'
export const ghostBtnCls = 'h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 disabled:opacity-40'

export function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
                    {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
                </div>
                {actions}
            </div>
            {children}
        </section>
    )
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-2xl font-black text-white tabular-nums mt-1">{value}</p>
            {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
    )
}

/**
 * Whole-number input. An empty box is NaN (the validator flags it) unless
 * `emptyIsNull`, where empty means "no limit".
 */
export function NumField({
    value, onChange, max, emptyIsNull, placeholder, disabled, className = 'w-20', label,
}: {
    value: number | null
    onChange: (v: number | null) => void
    max?: number
    emptyIsNull?: boolean
    placeholder?: string
    disabled?: boolean
    className?: string
    label?: string
}) {
    return (
        <input
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            step={1}
            aria-label={label}
            value={value === null || !Number.isFinite(value) ? '' : String(value)}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') onChange(emptyIsNull ? null : NaN)
                else onChange(Number(raw))
            }}
            className={`${inputCls} ${className}`}
        />
    )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={() => onChange(!on)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-brand-cyan' : 'bg-white/15'}`}
        >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
    )
}

/** Page header + the load/migration states every settings page shares. */
export function SettingsHeader({ title, subtitle, editor }: {
    title: string
    subtitle: string
    editor: ReturnType<typeof useRewardConfigEditor>
}) {
    const { data, loadError, notice } = editor
    return (
        <>
            <div>
                <h1 className="text-xl font-black text-white uppercase tracking-wide">{title}</h1>
                <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
                {data && (
                    <p className="text-[11px] text-slate-500 mt-1">
                        {data.stored
                            ? `Last saved ${new Date(data.updatedAt ?? '').toLocaleString()}${data.updatedByName ? ` by ${data.updatedByName}` : ''}.`
                            : 'Nothing saved yet: the built-in defaults are live.'}
                    </p>
                )}
            </div>
            {loadError && <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3">{loadError}</div>}
            {data && !data.migrationApplied && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs p-3">
                    The settings table is not in the database yet (migration 20261010_reward_config.sql), so you can look
                    but not save. The values shown are the ones live today.
                </div>
            )}
            {notice && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs p-3">{notice}</div>}
        </>
    )
}

/**
 * Bar pinned to the bottom of the window while there are unsaved changes:
 * problems, a change note, Discard and Save. Fixed rather than sticky — the
 * admin <main> grows with its content, so it never scrolls itself. Pages add
 * bottom padding (SAVE_BAR_SPACE) so the last panel stays reachable.
 */
export const SAVE_BAR_SPACE = 'pb-40'

export function SaveBar({ editor }: { editor: ReturnType<typeof useRewardConfigEditor> }) {
    const { dirty, problems, saving, saveError, discard, save, data } = editor
    const [note, setNote] = useState('')
    if (!dirty && !saveError) return null
    const blocked = problems.length > 0 || saving || !data?.migrationApplied
    return (
        <div className="fixed bottom-0 right-0 left-0 lg:left-64 z-10 px-6 pt-3 pb-4 bg-brand-darker/95 backdrop-blur border-t border-white/10 space-y-2">
            {problems.length > 0 && (
                <ul className="text-xs text-amber-200 space-y-0.5 list-disc pl-5 max-h-28 overflow-y-auto">
                    {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
            )}
            {saveError && <p className="text-xs text-red-300">{saveError}</p>}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-amber-300">Unsaved changes</span>
                <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What changed and why (optional)"
                    className={`${inputCls} h-9 flex-1 min-w-48`}
                />
                <button onClick={discard} disabled={saving} className={ghostBtnCls}>Discard</button>
                <button
                    onClick={() => void save(note).then(() => setNote(''))}
                    disabled={blocked}
                    className={btnCls}
                >
                    {saving ? 'Saving...' : 'Save and go live'}
                </button>
            </div>
        </div>
    )
}

/** Saved versions, newest first; Load puts a version's values (for this page's sections) into the draft. */
export function HistoryPanel({ editor, sections }: { editor: ReturnType<typeof useRewardConfigEditor>; sections: readonly RewardConfigSection[] }) {
    const { data, loadValues } = editor
    if (!data) return null
    return (
        <Panel
            title="Change history"
            subtitle="Every save, newest first. Load copies that version's values for this page into the editor; nothing changes until you save."
            actions={
                <button onClick={() => loadValues(data.defaults)} className={ghostBtnCls}>
                    Load built-in defaults
                </button>
            }
        >
            {data.history.length === 0 ? (
                <p className="text-xs text-slate-500">No saves yet.</p>
            ) : (
                <div className="divide-y divide-white/5">
                    {data.history.map((h) => (
                        <div key={h.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="text-slate-300 tabular-nums">{new Date(h.createdAt).toLocaleString()}</span>
                            <span className="font-bold text-white">{h.changedByName ?? 'Unknown'}</span>
                            <span className="text-slate-500">{h.sections.join(', ')}</span>
                            {h.note && <span className="text-slate-400 italic flex-1 min-w-40">&ldquo;{h.note}&rdquo;</span>}
                            {h.sections.some((s) => sections.includes(s as RewardConfigSection)) && (
                                <button onClick={() => loadValues(h.config)} className="ml-auto text-brand-cyan font-bold">Load</button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    )
}
