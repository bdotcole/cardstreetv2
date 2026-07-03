'use client';

import React, { Suspense } from 'react';
import PremiumHub from '@/components/PremiumHub';

// Desktop-shell Pro hub: same PremiumHub the mobile route renders, wrapped in
// the desktop layout (nav + footer) so the Pro nav link doesn't eject the
// user from the desktop experience. Suspense: PremiumHub reads useSearchParams.
export default function DesktopPremiumPage() {
  return (
    <Suspense fallback={null}>
      <PremiumHub variant="desktop" />
    </Suspense>
  );
}
