import type { Metadata } from 'next';

// The /live tree is beta-gated and renders a generic not-found block without the
// grant, so none of it belongs in the index. Every page under it is 'use client'
// with no server wrapper, so without this layout they all inherited the root
// layout's homepage title and shipped no canonical at all — the same defect
// fixed for /sell and /orders in 8f6a342. /live/[id] is an unbounded URL space,
// and the desktop nav link becomes crawlable the day the beta flag opens.
//
// Title is static Thai rather than locale-branched on purpose: /live is not in
// middleware's config.matcher, so no x-cs-lang header ever reaches this page and
// a locale branch would silently always pick Thai anyway. Thai is the site
// default. If /live is ever added to the matcher, branch it then.
export const metadata: Metadata = {
    title: 'ไลฟ์เปิดการ์ด | CardStreet',
    robots: { index: false, follow: false },
};

export default function LiveLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
