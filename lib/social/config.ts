/**
 * Which social providers are configured, and where their OAuth callbacks live.
 *
 * Facebook and Instagram share one Meta app and one "Connect" button: an
 * Instagram professional account is reached through the Facebook Page it is
 * linked to, with the Page's token. YouTube and TikTok are their own apps.
 *
 * Every secret is read lazily so an unset provider only disables its button
 * on the dashboard instead of crashing module load. Server-only.
 */

import { getAppBaseUrl } from '@/lib/stripe';
import type { SocialPlatform } from './types';

export type ConnectProvider = 'meta' | 'youtube' | 'tiktok';

export const CONNECT_PROVIDERS: ConnectProvider[] = ['meta', 'youtube', 'tiktok'];

export const PROVIDER_LABELS: Record<ConnectProvider, string> = {
    meta: 'Facebook & Instagram',
    youtube: 'YouTube',
    tiktok: 'TikTok',
};

export function providerForPlatform(platform: SocialPlatform): ConnectProvider {
    return platform === 'facebook' || platform === 'instagram' ? 'meta' : platform;
}

export function isConnectProvider(v: string): v is ConnectProvider {
    return (CONNECT_PROVIDERS as string[]).includes(v);
}

export function providerCredentials(provider: ConnectProvider): { id: string; secret: string } | null {
    const pick = (idKey: string, secretKey: string) => {
        const id = process.env[idKey];
        const secret = process.env[secretKey];
        return id && secret ? { id, secret } : null;
    };
    switch (provider) {
        case 'meta': return pick('META_APP_ID', 'META_APP_SECRET');
        case 'youtube': return pick('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET');
        case 'tiktok': return pick('TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET');
    }
}

export function isProviderConfigured(provider: ConnectProvider): boolean {
    return providerCredentials(provider) !== null;
}

/**
 * The callback URL registered with each provider. Always the canonical app
 * origin (cardstreet.app), never the request host: the providers only accept
 * redirect URIs that were registered in advance, and local dev registers its
 * own via NEXT_PUBLIC_APP_URL.
 */
export function providerRedirectUri(provider: ConnectProvider): string {
    return `${getAppBaseUrl()}/api/admin/social/connect/${provider}/callback`;
}

/** GA4 is the one non-OAuth source: a service account key, same as scripts/ga4-report.mjs. */
export function isGa4Configured(): boolean {
    return Boolean(process.env.GA4_PROPERTY_ID && (process.env.GA4_SA_KEY_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS));
}

/** Where the dashboard lives; connect flows bounce back here with ?connected= / ?error=. */
export function dashboardPath(): string {
    return '/admin/social';
}
