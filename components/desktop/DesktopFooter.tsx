'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Game landing pages (see middleware GAME_LANDING_PATHS). Sitewide footer links
// are the primary internal-link path search engines use to discover them.
const GAME_LINKS: { href: string; en: string; th: string }[] = [
    { href: '/pokemon', en: 'Pokémon TCG', th: 'การ์ดโปเกมอน' },
    { href: '/one-piece', en: 'One Piece', th: 'การ์ดวันพีช' },
    { href: '/yugioh', en: 'Yu-Gi-Oh!', th: 'การ์ดยูกิ' },
    { href: '/mtg', en: 'Magic: The Gathering', th: 'การ์ด MTG' },
    { href: '/lorcana', en: 'Disney Lorcana', th: 'การ์ด Lorcana' },
    { href: '/riftbound', en: 'Riftbound', th: 'การ์ด Riftbound' },
];

export default function DesktopFooter() {
    const { t, language } = useTranslation();
    return (
        <footer className="border-t border-white/5 mt-16">
            <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-6 text-xs text-slate-500">
                <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2" aria-label={language === 'TH' ? 'เกมการ์ด' : 'Card games'}>
                    {GAME_LINKS.map(({ href, en, th }) => (
                        <Link key={href} href={href} className="hover:text-slate-300 transition-colors">
                            {language === 'TH' ? th : en}
                        </Link>
                    ))}
                    <Link href="/sets" className="hover:text-slate-300 transition-colors">{t('desktop.navSets')}</Link>
                </nav>
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <p>© {new Date().getFullYear()} CardStreet TCG</p>
                    <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                        <Link href="/faq" className="hover:text-slate-300 transition-colors">{t('desktop.footerFaq')}</Link>
                        <Link href="/help" className="hover:text-slate-300 transition-colors">{t('desktop.footerHelp')}</Link>
                        <Link href="/contact" className="hover:text-slate-300 transition-colors">{t('desktop.footerContact')}</Link>
                        <Link href="/terms" className="hover:text-slate-300 transition-colors">{t('desktop.footerTerms')}</Link>
                        <Link href="/privacy" className="hover:text-slate-300 transition-colors">{t('desktop.footerPrivacy')}</Link>
                        {/* Plain anchor on purpose: the ?view= switch needs a full request so
                            middleware can set the cs_view cookie and re-route. nofollow because
                            that re-route is a redirect on every page of the site -- crawlers
                            should not spend budget rediscovering it sitewide. */}
                        <a href="/?view=mobile" rel="nofollow" className="hover:text-slate-300 transition-colors">{t('desktop.switchToMobile')}</a>
                    </nav>
                </div>
            </div>
        </footer>
    );
}
