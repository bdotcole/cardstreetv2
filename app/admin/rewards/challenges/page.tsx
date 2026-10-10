'use client'

import {
    QUEST_RULES, REWARD_LIMITS, STREAK_MILESTONE_DAYS, WEEKDAY_NAMES,
    monthlyCoinPreview, type QuestRule, type RewardConfigSection,
} from '@/lib/rewardConfig'
import {
    HistoryPanel, NumField, Panel, SAVE_BAR_SPACE, SaveBar, SettingsHeader, Tile, fmt, inputCls,
    useRewardConfigEditor,
} from '../_config'

/**
 * Daily challenges + the 7-day check-in: edit the schedule and payouts, and
 * see how many collectors claim them. Saves the `quests` and `checkin`
 * sections of reward_config (see app/admin/rewards/_config.tsx).
 */

const SECTIONS: readonly RewardConfigSection[] = ['quests', 'checkin']
// Monday first reads like a week; byWeekday itself is Sunday-indexed.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Bangkok weekday of a YYYY-MM-DD Bangkok date (the stats RPC's `today`). */
function weekdayOf(ymd: string | undefined): number | null {
    if (!ymd) return null
    const [y, m, d] = ymd.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export default function AdminRewardChallengesPage() {
    const editor = useRewardConfigEditor(SECTIONS)
    const { data, draft, update } = editor
    const stats = data?.stats ?? null
    const today = stats?.daily?.[0]
    const todayWeekday = weekdayOf(stats?.today)
    const preview = draft ? monthlyCoinPreview(draft) : null

    return (
        <div className={`max-w-5xl space-y-6 ${SAVE_BAR_SPACE}`}>
            <SettingsHeader
                title="Challenges & check-in"
                subtitle="The daily challenges and the 7-day check-in calendar. Saved changes apply to every collector straight away."
                editor={editor}
            />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Check-ins today" value={fmt(today?.checkins)} sub="Bangkok day" />
                <Tile label="Challenges claimed today" value={fmt(today?.quests)} sub={`all done: ${fmt(today?.quest_bonus)}`} />
                <Tile label="Active earners today" value={fmt(today?.earners)} sub="earned anything" />
                <Tile label="Coins minted today" value={fmt(today?.coins)} sub={`XP: ${fmt(today?.xp)}`} />
            </div>

            {draft && (
                <>
                    <Panel
                        title="Challenge rewards"
                        subtitle="Every challenge pays the same. The bonus pays once a day, when a collector has claimed all of that day's challenges."
                    >
                        <div className="flex flex-wrap gap-6">
                            <label className="space-y-1">
                                <span className="block text-[11px] font-bold text-slate-400">XP per challenge</span>
                                <NumField value={draft.quests.xp} max={REWARD_LIMITS.questXp} label="XP per challenge"
                                    onChange={(v) => update((d) => { d.quests.xp = v as number })} />
                            </label>
                            <label className="space-y-1">
                                <span className="block text-[11px] font-bold text-slate-400">Coins per challenge</span>
                                <NumField value={draft.quests.coins} max={REWARD_LIMITS.questCoins} label="Coins per challenge"
                                    onChange={(v) => update((d) => { d.quests.coins = v as number })} />
                            </label>
                            <label className="space-y-1">
                                <span className="block text-[11px] font-bold text-slate-400">All-done bonus coins</span>
                                <NumField value={draft.quests.bonusCoins} max={REWARD_LIMITS.questBonusCoins} label="All-done bonus coins"
                                    onChange={(v) => update((d) => { d.quests.bonusCoins = v as number })} />
                            </label>
                        </div>
                        {preview && (
                            <p className="text-[11px] text-slate-500">
                                Doing every challenge every day earns about <span className="text-amber-300 font-bold">{fmt(preview.challenges)}</span> coins a month
                                {' '}(100 coins = ฿1 of voucher value).
                            </p>
                        )}
                    </Panel>

                    <Panel
                        title="Weekly schedule"
                        subtitle="Same challenges for everyone on a given weekday (Bangkok time). A challenge counts that action's rewarded events for the day, so the action must be switched on and its daily cap must allow the target (Earning rules tab)."
                    >
                        <div className="divide-y divide-white/5">
                            {WEEK_ORDER.map((wd) => {
                                const day = draft.quests.byWeekday[wd] ?? []
                                const isToday = wd === todayWeekday
                                return (
                                    <div key={wd} className={`py-3 flex flex-col md:flex-row md:items-start gap-3 ${isToday ? 'bg-brand-cyan/5 -mx-4 px-4 rounded-xl' : ''}`}>
                                        <div className="w-32 shrink-0">
                                            <p className="text-sm font-black text-white">{WEEKDAY_NAMES[wd]}</p>
                                            {isToday && <p className="text-[10px] font-bold uppercase tracking-wider text-brand-cyan">Today</p>}
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            {day.map((q, slot) => {
                                                const rule = draft.rules[q.rule]
                                                const off = rule && !rule.enabled
                                                const overCap = rule && rule.dailyCap !== null && q.target > rule.dailyCap
                                                const claimed = isToday ? stats?.quest_slots_today?.[String(slot)] ?? 0 : null
                                                return (
                                                    <div key={slot} className="flex flex-wrap items-center gap-2">
                                                        <select
                                                            value={q.rule}
                                                            aria-label={`${WEEKDAY_NAMES[wd]} challenge ${slot + 1} action`}
                                                            onChange={(e) => update((d) => { d.quests.byWeekday[wd][slot].rule = e.target.value as QuestRule })}
                                                            className={`${inputCls} w-64 bg-brand-darker`}
                                                        >
                                                            {QUEST_RULES.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}
                                                        </select>
                                                        <span className="text-slate-500 text-xs">x</span>
                                                        <NumField value={q.target} max={REWARD_LIMITS.questTarget} className="w-16"
                                                            label={`${WEEKDAY_NAMES[wd]} challenge ${slot + 1} target`}
                                                            onChange={(v) => update((d) => { d.quests.byWeekday[wd][slot].target = v as number })} />
                                                        <button
                                                            onClick={() => update((d) => { d.quests.byWeekday[wd].splice(slot, 1) })}
                                                            disabled={day.length <= 1}
                                                            aria-label="Remove challenge"
                                                            title={day.length <= 1 ? 'Each day needs at least one challenge' : 'Remove'}
                                                            className="w-8 h-8 rounded-lg text-slate-500 hover:text-red-300 hover:bg-white/5 disabled:opacity-30"
                                                        >
                                                            <i className="fa-solid fa-xmark" />
                                                        </button>
                                                        {off && <span className="text-[11px] font-bold text-amber-300">action switched off</span>}
                                                        {!off && overCap && <span className="text-[11px] font-bold text-amber-300">over the daily cap of {rule.dailyCap}</span>}
                                                        {claimed !== null && <span className="text-[11px] text-slate-400 tabular-nums">{fmt(claimed)} claimed today</span>}
                                                    </div>
                                                )
                                            })}
                                            {day.length < REWARD_LIMITS.questsPerDay && (
                                                <button
                                                    onClick={() => update((d) => {
                                                        const used = new Set(d.quests.byWeekday[wd].map((q) => q.rule))
                                                        const next = QUEST_RULES.find((r) => !used.has(r.rule))?.rule ?? 'vault_add'
                                                        d.quests.byWeekday[wd].push({ rule: next, target: 1 })
                                                    })}
                                                    className="text-xs font-bold text-brand-cyan"
                                                >
                                                    <i className="fa-solid fa-plus mr-1" />Add challenge
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        {todayWeekday !== null && (
                            <p className="text-[11px] text-slate-500">
                                Editing today&apos;s challenges takes effect immediately. Claims already made today stay
                                claimed by position, so swapping a challenge mid-day can show it as already claimed.
                            </p>
                        )}
                    </Panel>

                    <Panel
                        title="Daily check-in"
                        subtitle="Coins for each day of the 7-day cycle (day 7 is the big one), XP for every check-in, and one-time streak milestone coins."
                    >
                        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                            {draft.checkin.calendar.map((coins, i) => (
                                <label key={i} className="space-y-1">
                                    <span className="block text-[10px] font-bold uppercase text-slate-500">Day {i + 1}</span>
                                    <NumField value={coins} max={REWARD_LIMITS.checkinCoins} className="w-full" label={`Check-in day ${i + 1} coins`}
                                        onChange={(v) => update((d) => { d.checkin.calendar[i] = v as number })} />
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-6 pt-1">
                            <label className="space-y-1">
                                <span className="block text-[11px] font-bold text-slate-400">XP per check-in</span>
                                <NumField value={draft.checkin.xp} max={REWARD_LIMITS.checkinXp} label="XP per check-in"
                                    onChange={(v) => update((d) => { d.checkin.xp = v as number })} />
                            </label>
                            {STREAK_MILESTONE_DAYS.map((days) => (
                                <label key={days} className="space-y-1">
                                    <span className="block text-[11px] font-bold text-slate-400">{days}-day streak coins</span>
                                    <NumField value={draft.checkin.streakMilestones[String(days)] ?? 0} max={REWARD_LIMITS.streakCoins}
                                        label={`${days}-day streak coins`}
                                        onChange={(v) => update((d) => { d.checkin.streakMilestones[String(days)] = v as number })} />
                                </label>
                            ))}
                        </div>
                        {preview && (
                            <p className="text-[11px] text-slate-500">
                                Checking in every day earns about <span className="text-amber-300 font-bold">{fmt(preview.checkin)}</span> coins a month,
                                plus streak milestones (each paid once per account, ever).
                            </p>
                        )}
                    </Panel>
                </>
            )}

            <Panel title="Last 14 days" subtitle="Bangkok days, newest first. Earners = people who earned anything that day.">
                {!stats ? (
                    <p className="text-xs text-slate-500">Tracking appears once migration 20261010_reward_config.sql is applied.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-slate-500 uppercase text-[10px]">
                                    <th className="py-1 pr-4">Day</th>
                                    <th className="py-1 pr-4 text-right">Check-ins</th>
                                    <th className="py-1 pr-4 text-right">Challenges</th>
                                    <th className="py-1 pr-4 text-right">All done</th>
                                    <th className="py-1 pr-4 text-right">Earners</th>
                                    <th className="py-1 pr-4 text-right">XP</th>
                                    <th className="py-1 text-right">Coins</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.daily.map((d) => (
                                    <tr key={d.day} className="border-t border-white/5 text-slate-300 tabular-nums">
                                        <td className="py-1.5 pr-4 font-bold text-white">
                                            {WEEKDAY_NAMES[weekdayOf(d.day) ?? 0].slice(0, 3)} {d.day.slice(5)}
                                        </td>
                                        <td className="py-1.5 pr-4 text-right">{fmt(d.checkins)}</td>
                                        <td className="py-1.5 pr-4 text-right">{fmt(d.quests)}</td>
                                        <td className="py-1.5 pr-4 text-right">{fmt(d.quest_bonus)}</td>
                                        <td className="py-1.5 pr-4 text-right">{fmt(d.earners)}</td>
                                        <td className="py-1.5 pr-4 text-right">{fmt(d.xp)}</td>
                                        <td className="py-1.5 text-right">{fmt(d.coins)}</td>
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
