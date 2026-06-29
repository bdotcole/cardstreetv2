import type { Metadata } from 'next';
import DesktopNav from '@/components/desktop/DesktopNav';
import DesktopFooter from '@/components/desktop/DesktopFooter';
import DesktopCartProvider from '@/components/desktop/DesktopCartContext';
import DesktopCartDrawer from '@/components/desktop/DesktopCartDrawer';

export const metadata: Metadata = {
    title: 'CardStreet — Trading Card Marketplace',
    description:
        'Buy and sell Pokémon, Magic: The Gathering, Yu-Gi-Oh! and One Piece cards in Thailand. Live prices, verified sellers, nationwide shipping.',
};

// Desktop experience shell. These routes are reached via middleware rewrites
// from the clean public URLs (/ and /card/*) — see middleware.ts. The mobile
// SPA at app/page.tsx is untouched by everything under this tree.
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
    return (
        <DesktopCartProvider>
            <div className="min-h-screen flex flex-col">
                <DesktopNav />
                <main className="flex-1 w-full max-w-screen-2xl mx-auto px-8 py-8">{children}</main>
                <DesktopFooter />
            </div>
            <DesktopCartDrawer />
        </DesktopCartProvider>
    );
}
