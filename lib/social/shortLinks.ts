/**
 * The tracked short links, as data — shared by the redirect routes
 * (lib/socialLinks.ts, server) and the Social dashboard (client), which is
 * why nothing here imports from next/server or any server-only module.
 */

import type { SocialBrand, SocialPlatform } from './types';

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

/** URL path prefix per brand: Cardstreet owns the root slugs, the pet channel sits under /ck. */
export const BRAND_LINK_PREFIX: Record<SocialBrand, string> = {
    cardstreet: '',
    chopper_kuma: '/ck',
};

/** "/ig" or "/ck/ig" — the path part of the short link. */
export function shortLinkPath(brand: SocialBrand, slug: string): string {
    return `${BRAND_LINK_PREFIX[brand]}/${slug}`;
}

export function shortLinkFor(slug: string): ShortLink | null {
    return SHORT_LINKS.find((l) => l.slug === slug) ?? null;
}
