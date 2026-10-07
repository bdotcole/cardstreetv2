/**
 * Cardstreet's tracked short links, as data — shared by the redirect routes
 * (lib/socialLinks.ts, server) and the Social dashboard (client), which is
 * why nothing here imports from next/server or any server-only module.
 *
 * Cardstreet only: the Chopper & Kuma pet channel is unrelated to the site
 * and never links here, so it has no short links and no site attribution.
 */

import type { SocialPlatform } from './types';

export interface ShortLink {
    slug: string;
    source: SocialPlatform;
    medium: string;
    /** Where to paste it. */
    placement: string;
}

export const SHORT_LINKS: ShortLink[] = [
    { slug: 'ig', source: 'instagram', medium: 'bio', placement: 'Instagram bio' },
    { slug: 'fb', source: 'facebook', medium: 'page', placement: 'Facebook Page button / About' },
    { slug: 'yt', source: 'youtube', medium: 'video', placement: 'YouTube channel link + video descriptions' },
    { slug: 'tt', source: 'tiktok', medium: 'bio', placement: 'TikTok bio' },
];

/** "/ig" — the path part of the short link. */
export function shortLinkPath(slug: string): string {
    return `/${slug}`;
}

export function shortLinkFor(slug: string): ShortLink | null {
    return SHORT_LINKS.find((l) => l.slug === slug) ?? null;
}
