import type { Metadata } from 'next';
import MobileHome from '@/components/MobileHome';
import { buildAlternatesForRequest } from '@/lib/i18nRouting';

// Server wrapper for the mobile SPA shell (components/MobileHome.tsx). The
// shell is one large client component and cannot export metadata itself; this
// wrapper owns the homepage canonical + hreflang (desktop browsers are
// rewritten to /desktop by middleware and never render this route). Title and
// description come from the root layout's localized generateMetadata.
export async function generateMetadata(): Promise<Metadata> {
    return { alternates: await buildAlternatesForRequest('/') };
}

export default function HomePage() {
    return <MobileHome />;
}
