'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

export default function DesktopFooter() {
    const { t } = useTranslation();
    return (
        <footer className="border-t border-white/5 mt-16">
            <div className="max-w-screen-2xl mx-auto px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
                <p>© {new Date().getFullYear()} CardStreet TCG</p>
                <nav className="flex items-center gap-6">
                    <Link href="/faq" className="hover:text-slate-300 transition-colors">{t('desktop.footerFaq')}</Link>
                    <Link href="/help" className="hover:text-slate-300 transition-colors">{t('desktop.footerHelp')}</Link>
                    <Link href="/contact" className="hover:text-slate-300 transition-colors">{t('desktop.footerContact')}</Link>
                    <Link href="/terms" className="hover:text-slate-300 transition-colors">{t('desktop.footerTerms')}</Link>
                    <Link href="/privacy" className="hover:text-slate-300 transition-colors">{t('desktop.footerPrivacy')}</Link>
                    {/* Plain anchor on purpose: the ?view= switch needs a full request so
                        middleware can set the cs_view cookie and re-route. */}
                    <a href="/?view=mobile" className="hover:text-slate-300 transition-colors">{t('desktop.switchToMobile')}</a>
                </nav>
            </div>
        </footer>
    );
}
