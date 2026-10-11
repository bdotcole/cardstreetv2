/**
 * GET /api/admin/social/connect/<provider>/callback?code=&state=
 *
 * Finishes the OAuth dance: verifies the signed state against the cookie,
 * trades the code for tokens, discovers the accounts behind them, and files
 * each as a social_accounts row under the brand the admin chose. An account
 * that already exists keeps its brand and enabled flag — only its tokens and
 * profile refresh — so reconnecting never silently moves a Page between
 * brands. Lands back on the dashboard with ?connected=<provider>&accounts=N,
 * which triggers the first backfill from the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConnectProvider, providerRedirectUri, dashboardPath, type ConnectProvider } from '@/lib/social/config';
import { OAUTH_STATE_COOKIE, verifyOAuthState } from '@/lib/social/oauthState';
import { encryptToken } from '@/lib/social/tokenCrypto';
import type { SocialBrand, SocialPlatform } from '@/lib/social/types';
import { metaDiscoverPages, metaExchangeCode, META_SCOPES } from '@/lib/social/meta';
import { googleExchangeCode, youtubeDiscoverChannel, YOUTUBE_SCOPES } from '@/lib/social/youtube';
import { tiktokExchangeCode, tiktokUserInfo, TIKTOK_SCOPES } from '@/lib/social/tiktok';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface AccountUpsert {
    platform: SocialPlatform;
    external_id: string;
    handle?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    profile_url?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    token_expires_at?: string | null;
    token_scopes?: string[];
    parent_external_id?: string | null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
    const back = new URL(dashboardPath(), request.nextUrl.origin);
    const fail = (message: string) => {
        back.searchParams.set('error', message);
        const res = NextResponse.redirect(back);
        res.cookies.delete(OAUTH_STATE_COOKIE);
        return res;
    };

    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;

    const { provider } = await params;
    if (!isConnectProvider(provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

    const sp = request.nextUrl.searchParams;
    const providerError = sp.get('error_description') || sp.get('error_message') || sp.get('error');
    if (providerError) return fail(`${provider}: ${providerError}`);

    const stateParam = sp.get('state');
    const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const state = verifyOAuthState(stateParam);
    if (!state || !cookieState || cookieState !== stateParam) return fail('The connection link expired or did not match — please try again.');
    if (state.adminId !== gate.user.id) return fail('This connection was started by a different admin.');

    const code = sp.get('code');
    if (!code) return fail('No authorization code returned.');

    let upserts: AccountUpsert[];
    try {
        upserts = await discover(provider, code, providerRedirectUri(provider));
    } catch (e) {
        return fail(e instanceof Error ? e.message : 'Token exchange failed.');
    }
    if (upserts.length === 0) {
        return fail(provider === 'meta'
            ? 'Facebook returned no Pages for this login — make sure you have a role on the Page and ticked it in the permissions dialog.'
            : 'No account was returned by the provider.');
    }

    const supabase = createAdminClient();
    const idByExternal = new Map<string, string>();
    let saved = 0;
    try {
        // Parents (Facebook Pages) first so Instagram rows can point at them.
        const ordered = [...upserts].sort((a, b) => Number(Boolean(a.parent_external_id)) - Number(Boolean(b.parent_external_id)));
        for (const u of ordered) {
            const id = await saveAccount(supabase, u, state.brand, gate.user.id, idByExternal);
            idByExternal.set(`${u.platform}:${u.external_id}`, id);
            saved++;
        }
    } catch (e) {
        return fail(e instanceof Error ? e.message : 'Could not save the account.');
    }

    back.searchParams.set('connected', provider);
    back.searchParams.set('accounts', String(saved));
    back.searchParams.set('brand', state.brand);
    const res = NextResponse.redirect(back);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
}

async function discover(provider: ConnectProvider, code: string, redirectUri: string): Promise<AccountUpsert[]> {
    switch (provider) {
        case 'meta': {
            const userToken = await metaExchangeCode(code, redirectUri);
            const pages = await metaDiscoverPages(userToken);
            const out: AccountUpsert[] = [];
            for (const p of pages) {
                out.push({
                    platform: 'facebook',
                    external_id: p.pageId,
                    display_name: p.name,
                    avatar_url: p.avatarUrl,
                    profile_url: p.link ?? `https://www.facebook.com/${p.pageId}`,
                    access_token: p.pageToken,
                    token_scopes: META_SCOPES,
                });
                if (p.instagram) {
                    out.push({
                        platform: 'instagram',
                        external_id: p.instagram.igUserId,
                        handle: p.instagram.username,
                        display_name: p.instagram.name ?? p.instagram.username,
                        avatar_url: p.instagram.avatarUrl,
                        profile_url: p.instagram.username ? `https://www.instagram.com/${p.instagram.username}/` : null,
                        token_scopes: META_SCOPES,
                        parent_external_id: p.pageId,
                    });
                }
            }
            return out;
        }
        case 'youtube': {
            const tokens = await googleExchangeCode(code, redirectUri);
            if (!tokens.refresh_token) {
                throw new Error('Google did not return a refresh token. Remove Cardstreet under myaccount.google.com/permissions and connect again.');
            }
            const channel = await youtubeDiscoverChannel(tokens.access_token);
            if (!channel) throw new Error('That Google account has no YouTube channel. Pick the channel\'s account (or Brand Account) at the Google account chooser.');
            return [{
                platform: 'youtube',
                external_id: channel.channelId,
                handle: channel.handle,
                display_name: channel.title,
                avatar_url: channel.avatarUrl,
                profile_url: channel.handle ? `https://www.youtube.com/${channel.handle}` : `https://www.youtube.com/channel/${channel.channelId}`,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expires_at: tokens.expires_at,
                token_scopes: YOUTUBE_SCOPES,
            }];
        }
        case 'tiktok': {
            const tokens = await tiktokExchangeCode(code, redirectUri);
            const user = await tiktokUserInfo(tokens.access_token);
            return [{
                platform: 'tiktok',
                external_id: user.open_id || tokens.open_id,
                handle: user.username,
                display_name: user.display_name ?? user.username,
                avatar_url: user.avatar_url,
                profile_url: user.profile_deep_link ?? (user.username ? `https://www.tiktok.com/@${user.username}` : null),
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expires_at: tokens.expires_at,
                token_scopes: TIKTOK_SCOPES,
            }];
        }
    }
}

async function saveAccount(
    supabase: ReturnType<typeof createAdminClient>,
    u: AccountUpsert,
    brand: SocialBrand,
    adminId: string,
    idByExternal: Map<string, string>,
): Promise<string> {
    const enc = (v?: string | null) => {
        if (!v) return null;
        const e = encryptToken(v);
        if (!e) throw new Error('Token encryption unavailable (no secret configured).');
        return e;
    };
    const parentId = u.parent_external_id ? idByExternal.get(`facebook:${u.parent_external_id}`) ?? null : null;
    const profile = {
        handle: u.handle ?? null,
        display_name: u.display_name ?? null,
        avatar_url: u.avatar_url ?? null,
        profile_url: u.profile_url ?? null,
        token_scopes: u.token_scopes ?? null,
        parent_account_id: parentId,
        connected_by: adminId,
        connected_at: new Date().toISOString(),
        last_sync_error: null,
    };
    const tokens: Record<string, unknown> = {};
    if (u.access_token) tokens.access_token_enc = enc(u.access_token);
    if (u.refresh_token) tokens.refresh_token_enc = enc(u.refresh_token);
    if (u.token_expires_at !== undefined) tokens.token_expires_at = u.token_expires_at;

    const { data: existing, error: readErr } = await supabase
        .from('social_accounts').select('id').eq('platform', u.platform).eq('external_id', u.external_id).maybeSingle();
    if (readErr) throw new Error(readErr.message);

    if (existing?.id) {
        const { error } = await supabase.from('social_accounts').update({ ...profile, ...tokens }).eq('id', existing.id);
        if (error) throw new Error(error.message);
        return existing.id as string;
    }
    const { data, error } = await supabase
        .from('social_accounts')
        .insert({ ...profile, ...tokens, brand, platform: u.platform, external_id: u.external_id, enabled: true })
        .select('id')
        .single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    return data.id as string;
}
