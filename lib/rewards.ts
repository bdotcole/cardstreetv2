// Server-side Collector Pass award helpers. Every call is fail-soft: rewards
// must NEVER break checkout, fulfillment, chat, or any other primary flow, and
// the code ships before the 20260828_collector_pass_foundation.sql migration
// runs — a missing function/table (PGRST202/PGRST205/42883/42P01/42703) is an
// expected, quiet no-op.
//
// Never import from a 'use client' module: the award RPCs have EXECUTE revoked
// from anon/authenticated, so only a service-role client can call them.

import type { SupabaseClient } from '@supabase/supabase-js';
import { FIRST_AWARD_BY_KEY } from '@/lib/rewardTiers';

export interface AwardParams {
    userId: string;
    rule: string;
    /** Idempotency scope: (userId, rule, ref) is unique among earn rows. */
    ref: string;
    xp: number;
    coins: number;
    dailyCap?: number | null;
}

export interface AwardResult {
    awarded: boolean;
    xpTotal?: number;
    level?: number;
    coinBalance?: number;
    leveledUp?: boolean;
    reason?: string;
}

// Any admin/service-role supabase-js client (Next createAdminClient or an
// inline createClient in webhook code) satisfies this.
type AdminClient = SupabaseClient<any, any, any>;

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']);

/** Award one event through the SECURITY DEFINER RPC. Never throws. */
export async function awardEvent(admin: AdminClient, params: AwardParams): Promise<AwardResult | null> {
    try {
        if (!params.userId || !params.rule) return null;
        const { data, error } = await admin.rpc('award_reward_event', {
            p_user: params.userId,
            p_rule_key: params.rule,
            p_ref_id: params.ref ?? '',
            p_xp: Math.max(0, Math.round(params.xp || 0)),
            p_coins: Math.max(0, Math.round(params.coins || 0)),
            p_daily_cap: params.dailyCap ?? null,
        });
        if (error) {
            if (!MISSING_SCHEMA_CODES.has(error.code ?? '')) {
                console.warn(`[Rewards] award ${params.rule} failed:`, error.message);
            }
            return null;
        }
        const row = data as Record<string, unknown> | null;
        if (!row) return null;
        return {
            awarded: row.awarded === true,
            xpTotal: typeof row.xp_total === 'number' ? row.xp_total : undefined,
            level: typeof row.level === 'number' ? row.level : undefined,
            coinBalance: typeof row.coin_balance === 'number' ? row.coin_balance : undefined,
            leveledUp: row.leveled_up === true,
            reason: typeof row.reason === 'string' ? row.reason : undefined,
        };
    } catch (err) {
        console.warn('[Rewards] award error (non-fatal):', (err as Error)?.message);
        return null;
    }
}

/** One-shot first-time award by key from lib/rewardTiers.ts. Never throws. */
export async function awardFirst(admin: AdminClient, userId: string, key: string): Promise<AwardResult | null> {
    const def = FIRST_AWARD_BY_KEY[key];
    if (!def) return null;
    return awardEvent(admin, { userId, rule: def.key, ref: 'first', xp: def.xp, coins: def.coins });
}

/** Today's date in the Bangkok calendar, as YYYY-MM-DD. */
export function bangkokDateString(now: Date = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** Bangkok weekday, 0 = Sunday .. 6 = Saturday (Date#getDay convention). */
export function bangkokWeekday(now: Date = new Date()): number {
    const [y, m, d] = bangkokDateString(now).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1).getDay();
}

/** UTC instant of today's Bangkok midnight — the earn-window lower bound. */
export function bangkokDayStartIso(now: Date = new Date()): string {
    return new Date(`${bangkokDateString(now)}T00:00:00+07:00`).toISOString();
}
