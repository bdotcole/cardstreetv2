import DesktopNav from '@/components/desktop/DesktopNav';
import DesktopFooter from '@/components/desktop/DesktopFooter';
import DesktopCartProvider from '@/components/desktop/DesktopCartContext';
import DesktopCartDrawer from '@/components/desktop/DesktopCartDrawer';
import AuthLinkErrorNotice from '@/components/AuthLinkErrorNotice';

// No metadata here on purpose: the root layout's localized generateMetadata is
// the sitewide default, and every indexable desktop page (card / set / seller /
// game landing) exports its own. A static English block here would override the
// localized default for the whole subtree.

// Desktop experience shell. These routes are reached via middleware rewrites
// from the clean public URLs (/ and /card/*) — see middleware.ts. The mobile
// SPA at app/page.tsx is untouched by everything under this tree.
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
    return (
        <DesktopCartProvider>
            <div className="min-h-screen flex flex-col">
                <DesktopNav />
                <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 md:px-8 py-8">{children}</main>
                <DesktopFooter />
            </div>
            <DesktopCartDrawer />
            {/* Failed email-verification links redirect to / with a #error
                hash (invisible to server routes) — surface it. */}
            <AuthLinkErrorNotice />
        </DesktopCartProvider>
    );
}
