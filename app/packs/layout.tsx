import type { Metadata, Viewport } from 'next';
import { Kanit } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasSlabPacksAccess } from '@/lib/slabPacks/access';
import '@/components/slabPacks/slabPacks.css';

// Display face for the pack-opening feature only. Kanit carries Thai and
// Latin in the same heavy italic, so a Thai headline matches the English one
// instead of falling back to a system font beside it.
const kanit = Kanit({
    subsets: ['latin', 'thai'],
    weight: ['700', '800', '900'],
    style: ['normal', 'italic'],
    variable: '--font-kanit',
    display: 'swap',
});

// Static Thai title, as on /live: /packs is not in middleware's matcher, so
// no x-cs-lang header reaches this layout to branch on.
export const metadata: Metadata = {
    title: 'ซองสุ่มสแลป | Cardstreet',
    robots: { index: false, follow: false },
};

// The stage is always dark, so the browser chrome is too, whatever the theme.
export const viewport: Viewport = {
    themeColor: '#06070b',
};

// Admin wall. Decided per request from the session cookie, never cached.
export const dynamic = 'force-dynamic';

export default async function PacksLayout({ children }: { children: React.ReactNode }) {
    // Not an admin: the same 404 as a route that does not exist. No "coming
    // soon", no hint the feature is here.
    if (!(await hasSlabPacksAccess())) notFound();
    return <div className={kanit.variable}>{children}</div>;
}
