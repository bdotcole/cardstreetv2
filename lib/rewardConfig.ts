// Runtime-editable Collector Pass earn settings: the shape of the reward_config
// document, its defaults (the lib/rewardTiers.ts constants), the admin
// console's rule catalogue, and the validator every write goes through.
//
// Who reads the document:
//   - SQL (20261010_reward_config.sql): award_reward_event applies
//     `rules[<rule_key>]` (xp, coins, dailyCap, enabled) to every award of
//     that key, whichever path sends it (route, DB trigger, edge function),
//     plus `bandBonusCoins`; claim_daily_checkin reads `checkin`.
//   - TS: the quest claim + summary routes read `quests` and `checkin`
//     through lib/rewardConfig.server.ts.
// So only RULE_META keys may ever reach `rules`: an override on a
// formula-paid key (checkin, order_*, quest, badge) would flatten its maths.
//
// Client-safe — the admin pages import it.

import {
    CHECKIN_CALENDAR, CHECKIN_XP, EARN, FIRST_AWARDS, QUESTS_BY_WEEKDAY,
    QUEST_BONUS_COINS, QUEST_COINS, QUEST_XP, STREAK_MILESTONES, type QuestDef,
} from '@/lib/rewardTiers';

export type QuestRule = QuestDef['rule'];

export interface RewardRuleSetting {
    xp: number;
    coins: number;
    /** Earn rows per Bangkok day; null = uncapped. */
    dailyCap: number | null;
    enabled: boolean;
}

export interface RewardConfig {
    checkin: {
        /** Coins for cycle days 1..7. */
        calendar: number[];
        xp: number;
        /** Streak length (string key, one of STREAK_MILESTONE_DAYS) -> once-ever coins. */
        streakMilestones: Record<string, number>;
    };
    quests: {
        xp: number;
        coins: number;
        /** Paid once a day when every one of that day's challenges is claimed. */
        bonusCoins: number;
        /** Index 0 = Sunday (Date#getDay). */
        byWeekday: QuestDef[][];
    };
    rules: Record<string, RewardRuleSetting>;
    /** Coins per rarity band entered (once ever per band). */
    bandBonusCoins: number;
}

export type RewardConfigSection = keyof RewardConfig;
export const REWARD_CONFIG_SECTIONS: readonly RewardConfigSection[] = ['checkin', 'quests', 'rules', 'bandBonusCoins'];

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const STREAK_MILESTONE_DAYS = [7, 30, 100, 365] as const;

/** Upper bounds: they catch a typo (an extra zero) before it mints coins. */
export const REWARD_LIMITS = {
    xp: 1000,
    actionCoins: 500,
    journeyCoins: 2000,
    dailyCap: 100,
    checkinCoins: 500,
    checkinXp: 100,
    streakCoins: 5000,
    questXp: 200,
    questCoins: 200,
    questBonusCoins: 500,
    questsPerDay: 5,
    questTarget: 50,
    bandBonusCoins: 1000,
} as const;

export interface RuleMeta {
    key: string;
    group: 'action' | 'journey';
    label: string;
    /** When it pays and how often. */
    detail: string;
    /** XP only by design: a client-writable or farmable surface never mints
     *  coins (the Collector Pass firewall rule). */
    coinsLocked?: boolean;
    /** Farmable without a daily cap, so one must stay set. */
    capRequired?: boolean;
    /** No daily cap applies (once-only, or capped elsewhere in code). */
    noCap?: boolean;
}

const ACTION_RULES: readonly RuleMeta[] = [
    { key: 'vault_add', group: 'action', label: 'Add a card to the vault', detail: 'Once per card, ever', coinsLocked: true, capRequired: true },
    { key: 'wishlist_add', group: 'action', label: 'Wishlist a card', detail: 'Once per card, ever', coinsLocked: true, capRequired: true },
    { key: 'listing_publish', group: 'action', label: 'Publish a listing', detail: 'Per new listing', coinsLocked: true, capRequired: true },
    { key: 'scan_confirm', group: 'action', label: 'Scan and confirm a card', detail: 'Once per card, ever', coinsLocked: true, capRequired: true },
    { key: 'chat_stream', group: 'action', label: 'Chat in a live stream', detail: 'Once per stream', coinsLocked: true, capRequired: true },
    { key: 'watch_10m', group: 'action', label: 'Watch 10+ minutes of a live show', detail: 'Once per stream', coinsLocked: true, capRequired: true },
    { key: 'offer_accepted', group: 'action', label: 'Seller accepts an offer', detail: 'Paid to the seller', coinsLocked: true, capRequired: true },
    { key: 'review', group: 'action', label: 'Post a review', detail: 'Once per order' },
    { key: 'referral_signup', group: 'action', label: 'Invited friend signs up', detail: 'Paid to the referrer', coinsLocked: true },
    { key: 'referral_converted', group: 'action', label: "Invited friend's first order settles", detail: 'Paid to the referrer, max 10 a month', noCap: true },
];

const JOURNEY_LABELS: Record<string, { label: string; detail: string }> = {
    first_account: { label: 'Join Cardstreet', detail: 'First rewards open or check-in' },
    first_profile_complete: { label: 'Complete your profile', detail: 'Username and avatar set' },
    first_push: { label: 'Turn on notifications', detail: 'First push token saved' },
    first_scan: { label: 'Scan and confirm your first card', detail: 'First confirmed scan' },
    first_vault: { label: 'Add your first card to the vault', detail: 'First vault add' },
    first_wishlist: { label: 'Add a card to your wishlist', detail: 'First wishlist add' },
    first_watch: { label: 'Watch 10 minutes of a live show', detail: 'First verified watch' },
    first_chat: { label: 'Chat in a live stream', detail: 'First live chat message' },
    first_purchase: { label: 'Make your first purchase', detail: 'First paid order' },
    first_review: { label: 'Leave your first review', detail: 'First review' },
    first_stripe_complete: { label: 'Set up seller payouts', detail: 'Stripe details submitted' },
    first_listing: { label: 'Publish your first listing', detail: 'First active listing' },
    first_sale_settled: { label: 'Complete your first sale', detail: 'First sale released from escrow' },
    first_spot: { label: 'Buy a break spot in a live', detail: 'First paid break spot' },
    first_referral: { label: 'Invite a friend who signs up', detail: 'First attributed signup' },
};

/** Every rule the console can edit, in display order. */
export const RULE_META: readonly RuleMeta[] = [
    ...ACTION_RULES,
    ...FIRST_AWARDS.map((a): RuleMeta => ({
        key: a.key,
        group: 'journey',
        label: JOURNEY_LABELS[a.key]?.label ?? a.key,
        detail: JOURNEY_LABELS[a.key]?.detail ?? 'Once per account',
        noCap: true,
    })),
];

export const RULE_META_BY_KEY: Record<string, RuleMeta> = Object.fromEntries(RULE_META.map((m) => [m.key, m]));

/** Actions a daily challenge can count. Each needs a `rewards.quest.<rule>`
 *  string in lib/locales/{en,th}.json — the hub renders the title from it. */
export const QUEST_RULES: readonly { rule: QuestRule; label: string }[] = [
    { rule: 'vault_add', label: 'Add a card to your vault' },
    { rule: 'wishlist_add', label: 'Wishlist a card' },
    { rule: 'scan_confirm', label: 'Scan a new card' },
    { rule: 'listing_publish', label: 'List a card for sale' },
    { rule: 'chat_stream', label: 'Say hi in a live chat' },
    { rule: 'watch_10m', label: 'Watch a live show for 10 minutes' },
];
const QUEST_RULE_KEYS = new Set<string>(QUEST_RULES.map((q) => q.rule));
export const QUEST_RULE_LABEL: Record<string, string> = Object.fromEntries(QUEST_RULES.map((q) => [q.rule, q.label]));

function defaultRules(): Record<string, RewardRuleSetting> {
    const rules: Record<string, RewardRuleSetting> = {};
    for (const e of [
        EARN.VAULT_ADD, EARN.WISHLIST_ADD, EARN.LISTING_PUBLISH, EARN.SCAN_CONFIRM, EARN.CHAT_STREAM,
        EARN.WATCH_10M, EARN.OFFER_ACCEPTED, EARN.REVIEW, EARN.REFERRAL_SIGNUP,
    ]) {
        rules[e.rule] = { xp: e.xp, coins: e.coins, dailyCap: e.dailyCap, enabled: true };
    }
    // Its cap is monthly and lives in release-funds, not in the award RPC.
    rules[EARN.REFERRAL_CONVERTED.rule] = { xp: EARN.REFERRAL_CONVERTED.xp, coins: EARN.REFERRAL_CONVERTED.coins, dailyCap: null, enabled: true };
    for (const a of FIRST_AWARDS) {
        rules[a.key] = { xp: a.xp, coins: a.coins, dailyCap: null, enabled: true };
    }
    return rules;
}

/** A fresh copy of today's hardcoded economy — what applies with no saved config. */
export function defaultRewardConfig(): RewardConfig {
    return {
        checkin: {
            calendar: [...CHECKIN_CALENDAR],
            xp: CHECKIN_XP,
            streakMilestones: Object.fromEntries(Object.entries(STREAK_MILESTONES).map(([d, c]) => [d, c])),
        },
        quests: {
            xp: QUEST_XP,
            coins: QUEST_COINS,
            bonusCoins: QUEST_BONUS_COINS,
            byWeekday: QUESTS_BY_WEEKDAY.map((day) => day.map((q) => ({ ...q }))),
        },
        rules: defaultRules(),
        bandBonusCoins: 100,
    };
}

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface RewardConfigCheck {
    /** Always complete: every invalid or missing field falls back to its default. */
    config: RewardConfig;
    errors: string[];
}

/**
 * Validate a (possibly partial) config document. Missing fields take the
 * default silently; malformed ones take the default AND add an error, so the
 * write path can refuse them while the read path stays usable. Unknown keys
 * are dropped — notably any `rules` key outside RULE_META.
 */
export function checkRewardConfig(raw: unknown): RewardConfigCheck {
    const d = defaultRewardConfig();
    const errors: string[] = [];
    const src = isObj(raw) ? raw : {};

    const int = (v: unknown, min: number, max: number, fallback: number, label: string): number => {
        if (v === undefined) return fallback;
        if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
        errors.push(`${label} must be a whole number from ${min} to ${max}.`);
        return fallback;
    };

    // Check-in
    const ci = isObj(src.checkin) ? src.checkin : {};
    let calendar = d.checkin.calendar;
    if (ci.calendar !== undefined) {
        if (Array.isArray(ci.calendar) && ci.calendar.length === 7) {
            calendar = ci.calendar.map((c, i) => int(c, 0, REWARD_LIMITS.checkinCoins, d.checkin.calendar[i], `Check-in day ${i + 1} coins`));
        } else {
            errors.push('The check-in calendar must have exactly 7 days.');
        }
    }
    const milestonesIn = isObj(ci.streakMilestones) ? ci.streakMilestones : {};
    const streakMilestones: Record<string, number> = {};
    for (const day of STREAK_MILESTONE_DAYS) {
        const k = String(day);
        streakMilestones[k] = int(milestonesIn[k], 0, REWARD_LIMITS.streakCoins, d.checkin.streakMilestones[k] ?? 0, `${day}-day streak coins`);
    }
    const checkin: RewardConfig['checkin'] = {
        calendar,
        xp: int(ci.xp, 0, REWARD_LIMITS.checkinXp, d.checkin.xp, 'Check-in XP'),
        streakMilestones,
    };

    // Rules (allowlisted keys only)
    const rulesIn = isObj(src.rules) ? src.rules : {};
    const rules: Record<string, RewardRuleSetting> = {};
    for (const meta of RULE_META) {
        const def = d.rules[meta.key];
        const r = isObj(rulesIn[meta.key]) ? rulesIn[meta.key] as Record<string, unknown> : {};
        const name = `"${meta.label}"`;
        const maxCoins = meta.group === 'journey' ? REWARD_LIMITS.journeyCoins : REWARD_LIMITS.actionCoins;

        let coins = def.coins;
        if (meta.coinsLocked) {
            if (r.coins !== undefined && r.coins !== 0) errors.push(`${name} is XP-only, so its coins must stay 0.`);
        } else {
            coins = int(r.coins, 0, maxCoins, def.coins, `${name} coins`);
        }

        let dailyCap: number | null = def.dailyCap;
        if (meta.noCap) {
            dailyCap = null;
        } else if (r.dailyCap !== undefined) {
            if (r.dailyCap === null) {
                if (meta.capRequired) errors.push(`${name} needs a daily cap.`);
                else dailyCap = null;
            } else {
                dailyCap = int(r.dailyCap, 1, REWARD_LIMITS.dailyCap, def.dailyCap ?? 1, `${name} daily cap`);
            }
        }

        let enabled = def.enabled;
        if (r.enabled !== undefined) {
            if (typeof r.enabled === 'boolean') enabled = r.enabled;
            else errors.push(`${name} on/off must be true or false.`);
        }

        rules[meta.key] = { xp: int(r.xp, 0, REWARD_LIMITS.xp, def.xp, `${name} XP`), coins, dailyCap, enabled };
    }

    // Daily challenges
    const qs = isObj(src.quests) ? src.quests : {};
    let byWeekday = d.quests.byWeekday;
    if (qs.byWeekday !== undefined) {
        if (Array.isArray(qs.byWeekday) && qs.byWeekday.length === 7) {
            byWeekday = qs.byWeekday.map((day, wd) => {
                const dayName = WEEKDAY_NAMES[wd];
                if (!Array.isArray(day) || day.length < 1 || day.length > REWARD_LIMITS.questsPerDay) {
                    errors.push(`${dayName} needs 1 to ${REWARD_LIMITS.questsPerDay} challenges.`);
                    return d.quests.byWeekday[wd];
                }
                const parsed: QuestDef[] = [];
                for (const q of day) {
                    const rule = isObj(q) ? q.rule : undefined;
                    if (typeof rule !== 'string' || !QUEST_RULE_KEYS.has(rule)) {
                        errors.push(`${dayName} has a challenge with an unknown action.`);
                        return d.quests.byWeekday[wd];
                    }
                    const target = int((q as Record<string, unknown>).target, 1, REWARD_LIMITS.questTarget, 1, `${dayName} "${QUEST_RULE_LABEL[rule]}" target`);
                    parsed.push({ rule: rule as QuestRule, target });
                }
                return parsed;
            });
        } else {
            errors.push('The challenge schedule must cover all 7 weekdays.');
        }
    }
    const quests: RewardConfig['quests'] = {
        xp: int(qs.xp, 0, REWARD_LIMITS.questXp, d.quests.xp, 'Challenge XP'),
        coins: int(qs.coins, 0, REWARD_LIMITS.questCoins, d.quests.coins, 'Challenge coins'),
        bonusCoins: int(qs.bonusCoins, 0, REWARD_LIMITS.questBonusCoins, d.quests.bonusCoins, 'All-challenges bonus coins'),
        byWeekday,
    };

    // A challenge counts that action's ledger rows for the day, so it can
    // only ever complete when the action pays and its cap leaves room.
    byWeekday.forEach((day, wd) => {
        for (const q of day) {
            const rule = rules[q.rule];
            const title = `${WEEKDAY_NAMES[wd]}: "${QUEST_RULE_LABEL[q.rule]}"`;
            if (rule && !rule.enabled) {
                errors.push(`${title} counts an action that is switched off, so nobody can finish it.`);
            } else if (rule && rule.dailyCap !== null && q.target > rule.dailyCap) {
                errors.push(`${title} needs ${q.target} a day, but that action only pays ${rule.dailyCap} times a day.`);
            }
        }
    });

    return {
        config: {
            checkin,
            quests,
            rules,
            bandBonusCoins: int(src.bandBonusCoins, 0, REWARD_LIMITS.bandBonusCoins, d.bandBonusCoins, 'Rank-up bonus coins'),
        },
        errors,
    };
}

/** Lenient read: the stored document with every bad field defaulted. */
export function resolveRewardConfig(raw: unknown): RewardConfig {
    return checkRewardConfig(raw).config;
}

/**
 * Coins a month for a collector who never misses a check-in, and what doing
 * every challenge adds on top. The console shows it beside the inputs so an
 * edit's cost is visible before it is saved.
 */
export function monthlyCoinPreview(config: RewardConfig): { checkin: number; challenges: number } {
    const week = config.checkin.calendar.reduce((s, c) => s + c, 0);
    const challengeWeek = config.quests.byWeekday.reduce(
        (s, day) => s + day.length * config.quests.coins + config.quests.bonusCoins,
        0,
    );
    return {
        checkin: Math.round((week * 30) / 7),
        challenges: Math.round((challengeWeek * 30) / 7),
    };
}
