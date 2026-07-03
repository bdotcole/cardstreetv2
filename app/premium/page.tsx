'use client';

import React, { Suspense } from 'react';
import PremiumHub from '@/components/PremiumHub';

// Mobile/standalone Pro hub. Desktop browsers are rewritten by middleware to
// app/desktop/premium, which renders the same PremiumHub inside the desktop
// shell. Suspense: PremiumHub reads useSearchParams.
export default function PremiumPage() {
  return (
    <Suspense fallback={null}>
      <PremiumHub variant="mobile" />
    </Suspense>
  );
}
