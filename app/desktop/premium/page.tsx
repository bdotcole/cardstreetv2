import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { headers } from 'next/headers';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import PremiumHub from '@/components/PremiumHub';

async function resolveLang(): Promise<'EN' | 'TH'> {
  return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

// Same metadata as the mobile route (app/premium) — /premium is one public URL
// whichever experience renders it, so both routes must emit the same canonical
// and their own title/description (without them this page cloned the homepage
// metadata, one of the duplicate-title clusters).
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
