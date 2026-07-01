import type { Metadata } from 'next';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import HelpContent from './HelpContent';

// Server wrapper so the shared /help route emits canonical + hreflang (Thai bare
// path / English /en) in <head>. The visible body is bilingual and rendered by
// the client component, mirroring app/faq/page.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Help Center — CardStreet TCG Marketplace',
  description:
    'Get help with buying, selling, scanning, shipping, and payments on CardStreet, Thailand’s marketplace for Pokémon, Magic, Yu-Gi-Oh, and One Piece trading cards.',
  alternates: buildAlternates('/help'),
  openGraph: {
    title: 'CardStreet Help Center',
    description: 'Answers about buying, selling, scanning, and shipping trading cards on CardStreet in Thailand.',
    type: 'website',
    siteName: 'CardStreet',
    url: '/help',
  },
};

export default function HelpPage() {
  return <HelpContent />;
}
