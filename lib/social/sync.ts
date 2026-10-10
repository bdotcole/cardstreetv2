/**
 * Social metrics sync orchestrator — the one place tokens are decrypted.
 *
 * Runs over every enabled social_accounts row (or one brand / one account),
 * asks the platform's provider for the window, and merges the answer into
 * social_metrics_daily / social_posts. Merge, not overwrite: a platform that
 * declined a metric this run (deprecated, hidden, rate-limited) hands back
 * null for it, and null never clobbers a number we already stored.
 *
 * Each account is isolated — one dead token marks that row with
 * last_sync_error and the rest still sync. Rotated tokens (TikTok refresh
 * tokens, Google access tokens) are persisted before the provider runs, so a
 * crash mid-sync can't strand a rotated credential.
 *
 * The default window re-pulls the last few days on every run because Meta
 * and YouTube restate a day's numbers for ~48h after it ends; a long window
 * (`days=90`) is the first-connect backfill.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptToken, encryptToken } from './tokenCrypto';
import { isGa4Configured } from './config';
import { syncFacebookPage, syncInstagramAccount } from './meta';
import { googleRefresh, syncYouTubeChannel } from './youtube';
import { syncTikTokAccount, tiktokRefresh } from './tiktok';
import { fetchSocialSignups, fetchSocialSiteTraffic } from './ga4';
import {
    eachDay, isoDay, shiftDay,
    type DailyMetrics, type SocialAccountRow, type SocialBrand, type SyncResult, type SyncWindow,
} from './types';

export const DEFAULT_SYNC_DAYS = 3;
export const MAX_SYNC_DAYS = 90;

export interface AccountSyncOutcome {
    accountId: string;
    platform: string;
    brand: string;
    label: string;
    ok: boolean;
    days: number;
    posts: number;
    error?: string;
    notes?: string[];
}

export interface SyncSummary {
    window: SyncWindow;
    accounts: AccountSyncOutcome[];
    siteTraffic: { ok: boolean; rows: number; error?: string; skipped?: boolean; signupRows?: number; signupError?: string };
    durationMs: number;
}

export function syncWindow(days: number): SyncWindow {
    const n = Math.max(1, Math.min(MAX_SYNC_DAYS, Math.floor(days) || DEFAULT_SYNC_DAYS));
    const until = shiftDay(isoDay(new Date()), -1);
    return { since: shiftDay(until, -(n - 1)), until };
}

export async function syncSocialAccounts(opts: {
    days?: number;
    brand?: SocialBrand;
    accountId?: string;
    includeSiteTraffic?: boolean;
} = {}): Promise<SyncSummary> {
    const started = Date.now();
    const supabase = createAdminClient();
    const window = syncWindow(opts.days ?? DEFAULT_SYNC_DAYS);

    let q = supabase.from('social_accounts').select('*').eq('enabled', true).order('platform').order('connected_at');
    if (opts.brand) q = q.eq('brand', opts.brand);
    if (opts.accountId) q = q.eq('id', opts.accountId);
    const { data: accounts, error } = await q;
    if (error) throw new Error(`social_accounts: ${error.message}`);

    const outcomes: AccountSyncOutcome[] = [];
    // Sequential on purpose: the platforms rate-limit per app, and a run is a
    // handful of accounts, not hundreds.
    for (const account of (accounts ?? []) as SocialAccountRow[]) {
        outcomes.push(await syncOne(supabase, account, window));
    }

    let siteTraffic: SyncSummary['siteTraffic'] = { ok: true, rows: 0, skipped: true };
    if (opts.includeSiteTraffic !== false && !opts.accountId) {
        if (!isGa4Configured()) {
            siteTraffic = { ok: true, rows: 0, skipped: true };
        } else {
            try {
                const rows = await fetchSocialSiteTraffic(window);
                if (rows.length) {
                    const stamp = new Date().toISOString();
                    const { error: e } = await supabase.from('social_site_traffic_daily').upsert(
                        rows.map((r) => ({ ...r, synced_at: stamp })),
                        { onConflict: 'day,platform,campaign,medium' },
                    );
                    if (e) {
                        // Before migration 20261007 the table is keyed by day+platform only: fold the
                        // campaign/medium split back together so the number still lands.
                        if (!/campaign|medium/i.test(e.message)) throw new Error(e.message);
                        const folded = new Map<string, { day: string; platform: string; sessions: number; users: number }>();
                        for (const r of rows) {
                            const cur = folded.get(`${r.day}|${r.platform}`) ?? { day: r.day, platform: r.platform, sessions: 0, users: 0 };
                            cur.sessions += r.sessions;
                            cur.users += r.users;
                            folded.set(`${r.day}|${r.platform}`, cur);
                        }
                        const { error: e2 } = await supabase.from('social_site_traffic_daily').upsert(
                            [...folded.values()].map((r) => ({ ...r, synced_at: stamp })),
                            { onConflict: 'day,platform' },
                        );
                        if (e2) throw new Error(e2.message);
                        siteTraffic = { ok: true, rows: folded.size, error: 'per-link split needs migration 20261007_social_link_clicks.sql' };
                    }
                }
                if (!siteTraffic.error) siteTraffic = { ok: true, rows: rows.length };
            } catch (e) {
                siteTraffic = { ok: false, rows: 0, error: e instanceof Error ? e.message : String(e) };
            }
            // Sign-ups by first-touch source ride the same table on their own
            // upsert (sessions/users default to 0 on a row only a sign-up created).
            try {
                const signups = await fetchSocialSignups(window);
                if (signups.length) {
                    const { error: e } = await supabase.from('social_site_traffic_daily').upsert(
                        signups.map((r) => ({ ...r, synced_at: new Date().toISOString() })),
                        { onConflict: 'day,platform,campaign,medium' },
                    );
                    if (e) throw new Error(e.message);
                }
                siteTraffic.signupRows = signups.length;
            } catch (e) {
                siteTraffic.signupError = e instanceof Error ? e.message : String(e);
            }
        }
    }

    return { window, accounts: outcomes, siteTraffic, durationMs: Date.now() - started };
}

async function syncOne(supabase: SupabaseClient, account: SocialAccountRow, window: SyncWindow): Promise<AccountSyncOutcome> {
    const label = account.display_name || account.handle || account.external_id;
    const base = { accountId: account.id, platform: account.platform, brand: account.brand, label };
    try {
        const result = await runProvider(supabase, account, window);
        await persist(supabase, account, result);
        // A profile field the API left blank must not erase what we already show.
        const profile = Object.fromEntries(Object.entries(result.profile ?? {}).filter(([, v]) => v !== null && v !== undefined));
        await supabase.from('social_accounts').update({
            last_synced_at: new Date().toISOString(),
            last_sync_error: result.notes?.length ? result.notes.join(' | ') : null,
            ...profile,
        }).eq('id', account.id);
        return { ...base, ok: true, days: result.days.length, posts: result.posts.length, notes: result.notes };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await supabase.from('social_accounts').update({ last_sync_error: message }).eq('id', account.id);
        return { ...base, ok: false, days: 0, posts: 0, error: message };
    }
}

/** The Page token for a Facebook row, or for an Instagram row via its parent Page. */
async function pageTokenFor(supabase: SupabaseClient, account: SocialAccountRow): Promise<string> {
    let enc = account.access_token_enc;
    if (account.platform === 'instagram' && account.parent_account_id) {
        const { data: parent } = await supabase
            .from('social_accounts').select('access_token_enc').eq('id', account.parent_account_id).maybeSingle();
        enc = parent?.access_token_enc ?? enc;
    }
    const token = decryptToken(enc);
    if (!token) throw new Error('No usable token — reconnect this account.');
    return token;
}

async function runProvider(supabase: SupabaseClient, account: SocialAccountRow, window: SyncWindow): Promise<SyncResult> {
    switch (account.platform) {
        case 'facebook':
            return syncFacebookPage(account.external_id, await pageTokenFor(supabase, account), window);
        case 'instagram':
            return syncInstagramAccount(account.external_id, await pageTokenFor(supabase, account), window);
        case 'youtube': {
            const refresh = decryptToken(account.refresh_token_enc);
            if (!refresh) throw new Error('No refresh token — reconnect this channel.');
            const tokens = await googleRefresh(refresh);
            await storeTokens(supabase, account.id, tokens.access_token, tokens.refresh_token ?? refresh, tokens.expires_at);
            return syncYouTubeChannel(tokens.access_token, window);
        }
        case 'tiktok': {
            const refresh = decryptToken(account.refresh_token_enc);
            if (!refresh) throw new Error('No refresh token — reconnect this account.');
            const tokens = await tiktokRefresh(refresh);
            await storeTokens(supabase, account.id, tokens.access_token, tokens.refresh_token, tokens.expires_at);
            const { data: prevRow } = await supabase
                .from('social_metrics_daily').select('day, followers, raw')
                .eq('account_id', account.id).order('day', { ascending: false }).limit(1).maybeSingle();
            return syncTikTokAccount(tokens.access_token, prevRow ? { followers: prevRow.followers, raw: prevRow.raw } : null);
        }
    }
}

async function storeTokens(supabase: SupabaseClient, accountId: string, access: string, refresh: string, expiresAt: string | null) {
    const accessEnc = encryptToken(access);
    const refreshEnc = encryptToken(refresh);
    if (!accessEnc || !refreshEnc) throw new Error('Token encryption unavailable (no secret configured).');
    const { error } = await supabase.from('social_accounts').update({
        access_token_enc: accessEnc,
        refresh_token_enc: refreshEnc,
        token_expires_at: expiresAt,
    }).eq('id', accountId);
    if (error) throw new Error(`store tokens: ${error.message}`);
}

const METRIC_KEYS: (keyof DailyMetrics)[] = [
    'followers', 'follower_delta', 'reach', 'views', 'profile_views', 'link_clicks',
    'engagements', 'likes', 'comments', 'shares', 'saves', 'watch_minutes', 'posts',
];

async function persist(supabase: SupabaseClient, account: SocialAccountRow, result: SyncResult) {
    if (result.days.length) {
        const days = result.days.map((d) => d.day).sort();
        const since = days[0];
        const until = days[days.length - 1];
        // Existing rows for the window plus the day before it (follower deltas).
        const { data: existing, error: readErr } = await supabase
            .from('social_metrics_daily').select('*')
            .eq('account_id', account.id).gte('day', shiftDay(since, -1)).lte('day', until);
        if (readErr) throw new Error(`read metrics: ${readErr.message}`);
        const byDay = new Map<string, Record<string, any>>((existing ?? []).map((r: any) => [r.day, r]));

        const rows: Record<string, any>[] = [];
        for (const d of result.days) {
            const prev = byDay.get(d.day) ?? {};
            const row: Record<string, any> = { account_id: account.id, day: d.day, synced_at: new Date().toISOString() };
            for (const k of METRIC_KEYS) {
                const next = d[k];
                row[k] = next !== null && next !== undefined ? next : (prev[k] ?? null);
            }
            row.raw = d.raw ? { ...(prev.raw ?? {}), ...d.raw } : (prev.raw ?? null);
            // Posts published that day, from the post list when the provider didn't count.
            if (row.posts === null) {
                const n = result.posts.filter((p) => p.published_at?.slice(0, 10) === d.day).length;
                if (n > 0) row.posts = n;
            }
            rows.push(row);
            byDay.set(d.day, row);
        }
        // A missing follower delta is the difference from the previous day's total.
        for (const day of eachDay(since, until)) {
            const row = byDay.get(day);
            const prev = byDay.get(shiftDay(day, -1));
            if (!row || !rows.includes(row)) continue;
            if (row.follower_delta === null && row.followers !== null && prev?.followers !== null && prev?.followers !== undefined) {
                row.follower_delta = row.followers - prev.followers;
            }
        }
        const { error } = await supabase.from('social_metrics_daily').upsert(rows, { onConflict: 'account_id,day' });
        if (error) throw new Error(`write metrics: ${error.message}`);
    }

    if (result.posts.length) {
        // Only the fields the provider actually set go up: a metric a platform
        // never reports stays undefined here and so keeps its stored value.
        const rows = result.posts.map((p) => {
            const row: Record<string, unknown> = { account_id: account.id, synced_at: new Date().toISOString() };
            for (const [k, v] of Object.entries(p)) if (v !== undefined) row[k] = v;
            return row;
        });
        const { error } = await supabase.from('social_posts').upsert(rows, { onConflict: 'account_id,external_id' });
        if (error) {
            // Before migration 20261010 the content columns don't exist: keep the basic post list flowing.
            if (!/column|schema cache/i.test(error.message)) throw new Error(`write posts: ${error.message}`);
            const basic = ['account_id', 'external_id', 'published_at', 'caption', 'media_type', 'permalink', 'thumbnail_url', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'raw', 'synced_at'];
            const { error: e2 } = await supabase.from('social_posts').upsert(
                rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => basic.includes(k)))),
                { onConflict: 'account_id,external_id' },
            );
            if (e2) throw new Error(`write posts: ${e2.message}`);
        }
    }
}
