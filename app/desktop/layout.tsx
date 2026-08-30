import DesktopNav from '@/components/desktop/DesktopNav';
import DesktopFooter from '@/components/desktop/DesktopFooter';
import DesktopCartProvider from '@/components/desktop/DesktopCartContext';
import DesktopCartDrawer from '@/components/desktop/DesktopCartDrawer';
import DesktopRewardsHost from '@/components/desktop/DesktopRewardsHost';
import AuthLinkErrorNotice from '@/components/AuthLinkErrorNotice';
import SignupTracker from '@/components/SignupTracker';
import { localePrefix, requestPathLocale } from '@/lib/i18nRouting';

// No metadata here on purpose: the root layout's localized generateMetadata is
// the sitewide default, and every indexable desktop page (card / set / seller /
// game landing) exports its own. A static English block here would override the
// localized default for the whole subtree.

// Desktop experience shell. These routes are reached via middleware rewrites
// from the clean public URLs (/ and /card/*) — see middleware.ts. The mobile
// SPA at app/page.tsx is untouched by everything under this tree.
export default async function DesktopLayout({ children }: { children: React.ReactNode }) {
    // The shared chrome is the last place that still emitted bare Thai links on
    // /en pages, after e5aaddc made the content grids locale-correct. Resolved
    // here and handed down as a plain string: lib/i18nRouting imports
    // next/headers, so a client component cannot import it (same constraint the
    // content grids work under).
    //
    // From the URL prefix only, never the cs_lang cookie — a Thai-cookie visitor
    // on /en must still get /en links, or the chrome disagrees with the page's
    // own canonical.
    const pathPrefix = localePrefix(await requestPathLocale());

    return (
        <DesktopCartProvider>
            <div className="min-h-screen flex flex-col">
                <DesktopNav pathPrefix={pathPrefix} />
                <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 md:px-8 py-8">{children}</main>
                <DesktopFooter pathPrefix={pathPrefix} />
            </div>
            <DesktopCartDrawer />
            {/* Rewards Hub overlay. Mounted here, not in DesktopNav — the nav's
                backdrop-blur would trap its fixed positioning under the header. */}
            <DesktopRewardsHost />
            {/* Failed email-verification links redirect to / with a #error
                hash (invisible to server routes) — surface it. */}
            <AuthLinkErrorNotice />
            {/* Fires the GA4 sign_up event for OAuth accounts (see the
                cs_new_account marker set in /api/auth/callback). */}
            <SignupTracker />
        </DesktopCartProvider>
    );
}
