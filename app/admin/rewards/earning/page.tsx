'use client'

import { REWARD_LIMITS, RULE_META, type RewardConfigSection, type RuleMeta } from '@/lib/rewardConfig'
import {
    HistoryPanel, NumField, Panel, SAVE_BAR_SPACE, SaveBar, SettingsHeader, Tile, Toggle, fmt, ruleStat,
    useRewardConfigEditor, type RewardStats,
} from '../_config'

/**
 * Every way a collector earns XP and coins: the per-action rules and the
 * one-time Collector's Journey (editable), the rank-up bonus (editable), and
 * the formula-paid sources (tracked only). Saves the `rules` and
 * `bandBonusCoins` sections of reward_config.
 */

const SECTIONS: readonly RewardConfigSection[] = ['rules', 'bandBonusCoins']

/** Paid by maths that lives in code or on the Challenges tab — tracked here, edited elsewhere. */
const FORMULA_SOURCES: readonly { key: string; label: string; how: string }[] = [
    { key: 'checkin', label: 'Daily check-in', how: 'Calendar coins + XP, set on the Challenges tab' },
    { key: 'streak_milestone', label: 'Streak milestones', how: 'Set on the Challenges tab' },
    { key: 'quest', label: 'Daily challenges', how: 'Set on the Challenges tab' },
    { key: 'quest_bonus', label: 'All-challenges bonus', how: 'Set on the Challenges tab' },
    { key: 'order_paid_buyer', label: 'Purchase XP', how: '1 XP per ฿10, max 300 an order, ฿100 minimum (code)' },
    { key: 'order_paid_seller', label: 'Sale XP', how: '1 XP per ฿10, max 300 an order, ฿100 minimum (code)' },
    { key: 'order_settled_buyer', label: 'Purchase coin-back', how: '1% of the order, max 500, never over half the platform fee (code)' },
    { key: 'order_settled_seller', label: 'Sale settled', how: '25 XP + 0.5% coin-back, max 300 (code)' },
    { key: 'badge', label: 'Milestone badges', how: 'Granted nightly; badge coins are set in code' },
]

function StatCells({ stats, ruleKey }: { stats: RewardStats | null; ruleKey: string }) {
    const s = ruleStat(stats, ruleKey)
    return (
        <>
            <td className="py-2 pr-3 text-right">{fmt(s?.events_today)}</td>
            <td className="py-2 pr-3 text-right">{fmt(s?.events_7d)}</td>
            <td className="py-2 pr-3 text-right">{fmt(s?.events_30d)}</td>
            <td className="py-2 pr-3 text-right">{fmt(s?.users_30d)}</td>
            <td className="py-2 text-right text-amber-300/90">{fmt(s?.coins_30d)}</td>
        </>
    )
}

const statHeads = (
    <>
        <th className="py-1 pr-3 text-right">Today</th>
        <th className="py-1 pr-3 text-right">7 days</th>
        <th className="py-1 pr-3 text-right">30 days</th>
        <th className="py-1 pr-3 text-right">People 30d</th>
        <th className="py-1 text-right">Coins 30d</th>
    </>
)

export default function AdminRewardEarningPage() {
    const editor = useRewardConfigEditor(SECTIONS)
    const { data, draft, update } = editor
    const stats = data?.stats ?? null

    const actions = RULE_META.filter((m) => m.group === 'action')
    const journey = RULE_META.filter((m) => m.group === 'journey')
    const known = new Set([...RULE_META.map((m) => m.key), ...FORMULA_SOURCES.map((f) => f.key), 'band_bonus'])
    const otherKeys = (stats?.rules ?? []).map((r) => r.rule_key).filter((k) => !known.has(k))

    const totals30 = (stats?.rules ?? []).reduce(
        (acc, r) => ({ xp: acc.xp + r.xp_30d, coins: acc.coins + r.coins_30d, events: acc.events + r.events_30d }),
        { xp: 0, coins: 0, events: 0 },
    )
    const journeyDone = journey.reduce((n, m) => n + (ruleStat(stats, m.key)?.events_all ?? 0), 0)

    const ruleRow = (m: RuleMeta) => {
        const r = draft?.rules[m.key]
        if (!r) return null
        const maxCoins = m.group === 'journey' ? REWARD_LIMITS.journeyCoins : REWARD_LIMITS.actionCoins
        // Journey steps reuse action wording ("Chat in a live stream"), so their controls need their own names.
        const name = m.group === 'journey' ? `Journey: ${m.label}` : m.label
        return (
            <>
                <td className="py-2 pr-3">
                    <p className={`font-bold ${r.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>{m.label}</p>
                    <p className="text-[10px] text-slate-500">{m.detail}</p>
                </td>
                <td className="py-2 pr-3">
                    <Toggle on={r.enabled} label={`${name} on/off`} onChange={(v) => update((d) => { d.rules[m.key].enabled = v })} />
                </td>
                <td className="py-2 pr-3">
                    <NumField value={r.xp} max={REWARD_LIMITS.xp} className="w-16" label={`${name} XP`}
                        onChange={(v) => update((d) => { d.rules[m.key].xp = v as number })} />
                </td>
                <td className="py-2 pr-3">
                    {m.coinsLocked ? (
                        <span className="text-[10px] font-bold uppercase text-slate-500" title="Client-writable or farmable action: XP only, never coins">
                            <i className="fa-solid fa-lock mr-1" />XP only
                        </span>
                    ) : (
                        <NumField value={r.coins} max={maxCoins} className="w-16" label={`${name} coins`}
                            onChange={(v) => update((d) => { d.rules[m.key].coins = v as number })} />
                    )}
                </td>
                {m.group === 'action' && (
                    <td className="py-2 pr-3">
                        {m.noCap ? (
                            <span className="text-slate-600">-</span>
                        ) : (
                            <NumField value={r.dailyCap} max={REWARD_LIMITS.dailyCap} className="w-16" emptyIsNull={!m.capRequired}
                                placeholder={m.capRequired ? '' : 'none'} label={`${name} daily cap`}
                                onChange={(v) => update((d) => { d.rules[m.key].dailyCap = v })} />
                        )}
                    </td>
                )}
            </>
        )
    }

    return (
        <div className={`max-w-6xl space-y-6 ${SAVE_BAR_SPACE}`}>
            <SettingsHeader
                title="Earning rules"
                subtitle="What each action pays in XP and coins. Saved changes apply to every award from that moment, including database-triggered ones (vault, wishlist, listings, reviews)."
                editor={editor}
            />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Rewarded events 30d" value={fmt(totals30.events)} sub="every earn, all sources" />
                <Tile label="XP minted 30d" value={fmt(totals30.xp)} />
                <Tile label="Coins minted 30d" value={fmt(totals30.coins)} sub={`face ฿${fmt(Math.round(totals30.coins / 100))}`} />
                <Tile label="Journey steps done" value={fmt(journeyDone)} sub={`across ${fmt(stats?.profiles_total)} accounts`} />
            </div>

            {draft && (
                <>
                    <Panel
                        title="Everyday actions"
                        subtitle="Switching an action off stops it paying and stops any challenge that counts it. Daily cap = rewarded times per person per Bangkok day; it is what stops farming, so the farmable ones cannot go uncapped."
                    >
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-slate-500 uppercase text-[10px]">
                                        <th className="py-1 pr-3">Action</th>
                                        <th className="py-1 pr-3">On</th>
                                        <th className="py-1 pr-3">XP</th>
                                        <th className="py-1 pr-3">Coins</th>
                                        <th className="py-1 pr-3">Daily cap</th>
                                        {statHeads}
                                    </tr>
                                </thead>
                                <tbody>
                                    {actions.map((m) => (
                                        <tr key={m.key} className="border-t border-white/5 text-slate-300 tabular-nums align-middle">
                                            {ruleRow(m)}
                                            <StatCells stats={stats} ruleKey={m.key} />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    <Panel
                        title="Collector's Journey (one-time)"
                        subtitle="Paid once per account, the first time each step happens. A step switched off disappears from the checklist for anyone who has not done it yet."
                    >
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-slate-500 uppercase text-[10px]">
                                        <th className="py-1 pr-3">Step</th>
                                        <th className="py-1 pr-3">On</th>
                                        <th className="py-1 pr-3">XP</th>
                                        <th className="py-1 pr-3">Coins</th>
                                        <th className="py-1 pr-3 text-right">Done by</th>
                                        <th className="py-1 pr-3 text-right">% of accounts</th>
                                        <th className="py-1 pr-3 text-right">Last 30d</th>
                                        <th className="py-1 text-right">Coins paid</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {journey.map((m) => {
                                        const s = ruleStat(stats, m.key)
                                        const total = stats?.profiles_total ?? 0
                                        const pct = total > 0 ? Math.round(((s?.users_all ?? 0) / total) * 1000) / 10 : 0
                                        return (
                                            <tr key={m.key} className="border-t border-white/5 text-slate-300 tabular-nums align-middle">
                                                {ruleRow(m)}
                                                <td className="py-2 pr-3 text-right">{fmt(s?.users_all)}</td>
                                                <td className="py-2 pr-3 text-right">
                                                    <div className="inline-flex items-center gap-2">
                                                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                            <div className="h-full bg-brand-cyan" style={{ width: `${Math.min(100, pct)}%` }} />
                                                        </div>
                                                        <span className="w-10">{pct}%</span>
                                                    </div>
                                                </td>
                                                <td className="py-2 pr-3 text-right">{fmt(s?.events_30d)}</td>
                                                <td className="py-2 text-right text-amber-300/90">{fmt(s?.coins_all)}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    <Panel
                        title="Rank-up bonus"
                        subtitle="Coins paid each time a collector enters a new rarity band (Uncommon at Lv4, Rare at Lv7, up to Crown Rare at Lv20), once per band, ever."
                    >
                        <div className="flex flex-wrap items-end gap-6">
                            <label className="space-y-1">
                                <span className="block text-[11px] font-bold text-slate-400">Coins per band</span>
                                <NumField value={draft.bandBonusCoins} max={REWARD_LIMITS.bandBonusCoins} label="Rank-up bonus coins"
                                    onChange={(v) => update((d) => { d.bandBonusCoins = v as number })} />
                            </label>
                            <p className="text-xs text-slate-400 tabular-nums">
                                Paid {fmt(ruleStat(stats, 'band_bonus')?.events_all)} times so far
                                ({fmt(ruleStat(stats, 'band_bonus')?.coins_all)} coins), {fmt(ruleStat(stats, 'band_bonus')?.events_30d)} in the last 30 days.
                            </p>
                        </div>
                    </Panel>
                </>
            )}

            <Panel
                title="Paid by formula (tracking only)"
                subtitle="These pay from order values or from the Challenges tab, so they are tracked here but not edited here."
            >
                {!stats ? (
                    <p className="text-xs text-slate-500">Tracking appears once migration 20261010_reward_config.sql is applied.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-slate-500 uppercase text-[10px]">
                                    <th className="py-1 pr-3">Source</th>
                                    <th className="py-1 pr-3">How it pays</th>
                                    {statHeads}
                                </tr>
                            </thead>
                            <tbody>
                                {[...FORMULA_SOURCES, ...otherKeys.map((k) => ({ key: k, label: k, how: 'Other (manual or one-off grant)' }))].map((f) => (
                                    <tr key={f.key} className="border-t border-white/5 text-slate-300 tabular-nums">
                                        <td className="py-2 pr-3 font-bold text-white">{f.label}</td>
                                        <td className="py-2 pr-3 text-slate-400">{f.how}</td>
                                        <StatCells stats={stats} ruleKey={f.key} />
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <HistoryPanel editor={editor} sections={SECTIONS} />
            <SaveBar editor={editor} />
        </div>
    )
}
