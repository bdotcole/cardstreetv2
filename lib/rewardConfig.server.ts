// Server-side reader for the admin-edited Collector Pass settings
// (reward_config, one row). The SQL award paths read the row themselves; this
// is for the TS ones — the quest claim and summary routes — which must agree
// with what the RPCs pay.

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultRewardConfig, resolveRewardConfig, type RewardConfig } from '@/lib/rewardConfig';

type AdminClient = SupabaseClient<any, any, any>;

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']);

export interface RewardConfigRow {
    config: RewardConfig;
    /** false = nothing saved yet; the defaults apply. */
    stored: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
    /** The 20261010 migration has not been applied. */
    tableMissing: boolean;
}

/** Read the row, resolved over the defaults. Throws only on an unexpected DB error. */
export async function readRewardConfigRow(admin: AdminClient): Promise<RewardConfigRow> {
    const { data, error } = await admin
        .from('reward_config')
        .select('config, updated_at, updated_by')
        .eq('id', 1)
        .maybeSingle();
    if (error) {
        if (MISSING_SCHEMA_CODES.has(error.code ?? '')) {
            return { config: defaultRewardConfig(), stored: false, updatedAt: null, updatedBy: null, tableMissing: true };
        }
        throw new Error(error.message);
    }
    return {
        config: resolveRewardConfig(data?.config ?? {}),
        stored: !!data,
        updatedAt: (data?.updated_at as string | undefined) ?? null,
        updatedBy: (data?.updated_by as string | undefined) ?? null,
        tableMissing: false,
    };
}

// Per-instance cache: an admin edit reaches every serverless instance within
// this window. The award RPCs read the row directly, so only challenge and
// calendar DISPLAY can trail a save by this much.
const TTL_MS = 30_000;
let cache: { at: number; config: RewardConfig } | null = null;

/** Live earn settings for award paths. Never throws — defaults on any failure. */
export async function getRewardConfig(admin: AdminClient): Promise<RewardConfig> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.config;
    try {
        const row = await readRewardConfigRow(admin);
        cache = { at: Date.now(), config: row.config };
        return row.config;
    } catch (err) {
        console.warn('[Rewards] config read failed, using defaults:', (err as Error)?.message);
        return cache?.config ?? defaultRewardConfig();
    }
}

/** Seed this instance's cache right after a save, so the saving admin's own
 *  next request already sees the new values. */
export function primeRewardConfigCache(config: RewardConfig) {
    cache = { at: Date.now(), config };
}
