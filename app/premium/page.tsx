import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { headers } from 'next/headers';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import PremiumHub from '@/components/PremiumHub';

async function resolveLang(): Promise<'EN' | 'TH'> {
  return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

// /premium is a public, marketed page — it needs its own title/description
// (without them it cloned the homepage metadata) and the shared canonical for
// the URL both experiences serve.
export async function generateMetadata(): Promise<Metadata> {
  const lang = await resolveLang();
  const title =
    lang === 'EN'
      ? 'CardStreet Pro — Premium Collector Tools & Price History'
      : 'CardStreet Pro — เครื่องมือสะสมการ์ดและกราฟราคาระดับพรีเมียม';
  const description =
    lang === 'EN'
      ? 'Upgrade to CardStreet Pro for extended 180-day and 1-year price history charts and premium collector tools on Thailand’s trading card marketplace.'
      : 'อัปเกรดเป็น CardStreet Pro เพื่อดูกราฟราคาย้อนหลัง 180 วันและ 1 ปี พร้อมเครื่องมือสะสมการ์ดระดับพรีเมียมบนตลาดซื้อขายการ์ดของไทย';
  const pathLocale = await requestPathLocale();
  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    alternates: buildAlternates('/premium', pathLocale),
    openGraph: { title, description, type: 'website', siteName: 'CardStreet', url: localizedUrl('/premium', pathLocale) },
  };
}

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
