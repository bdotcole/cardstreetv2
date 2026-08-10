import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import {
    BASE_URL,
    buildAlternates,
    localePrefix,
    localizedUrl,
    requestPathLocale,
} from '@/lib/i18nRouting';
import BecomeABreakerContent from './BecomeABreakerContent';
import type { BreakerFormPrefill } from './BreakerApplicationForm';

// Public application landing for the Cardstreet Live breaker program.
//
// Universal like the other public content pages: one server-rendered document
// per URL for every device, no phone->SPA redirect (see the note on
// PUBLIC_CONTENT_PREFIXES in middleware.ts — bouncing phones is what made the
// catalog invisible to Google's mobile-first crawler). The route is registered
// in middleware's matcher so /en/become-a-breaker resolves and x-cs-lang is set.
//
// Claims discipline lives in ./content.ts: no earnings, audience-size, or
// review-timeline promises anywhere on this page.

export async function generateMetadata(): Promise<Metadata> {
    // Metadata follows the URL variant, never the cs_lang cookie — same rule as
    // /faq and the game landing pages, so title/description can't disagree with
    // the canonical rendered on the same URL.
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';

    const title = isThai
        ? 'สมัครเป็น Cardstreet Breaker | Cardstreet Live'
        : 'Become a Cardstreet Breaker | Cardstreet Live';
    const description = isThai
        ? 'สมัครเป็นหนึ่งใน breaker ไลฟ์เปิดการ์ด TCG กลุ่มแรกของ Cardstreet และร่วมเปิดตัว Cardstreet Live ในประเทศไทย'
        : 'Apply to become one of the first livestream TCG breakers on Cardstreet and help launch Cardstreet Live in Thailand.';

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/become-a-breaker', pathLocale),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/become-a-breaker', pathLocale),
            locale: isThai ? 'th_TH' : 'en_US',
        },
        twitter: { card: 'summary_large_image', title, description },
    };
}

/**
 * Safe profile fields to pre-fill for a signed-in visitor. Strictly optional —
 * any failure here degrades to an empty form rather than breaking a public
 * page, and nothing sensitive (address lines, Stripe state, role) is passed to
 * the client.
 */
async function loadPrefill(): Promise<BreakerFormPrefill> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return {};

        const { data: profile } = await supabase
            .from('profiles')
            .select('display_name, username, phone_number, state, province, has_placeholder_email')
            .eq('id', user.id)
            .maybeSingle();

        return {
            fullName: profile?.display_name ?? '',
            // Admin-created partner accounts carry a synthetic address; filling
            // it in would hand the applicant an email that doesn't reach them.
            email: profile?.has_placeholder_email ? '' : (user.email ?? ''),
            phone: profile?.phone_number ?? '',
            city: profile?.state ?? '',
            province: profile?.province ?? '',
            cardstreetUsername: profile?.username ?? '',
        };
    } catch {
        return {};
    }
}

function buildJsonLd(pathLocale: 'th' | 'en') {
    const isThai = pathLocale === 'th';
    const url = localizedUrl('/become-a-breaker', pathLocale);
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'CardStreet', item: BASE_URL },
                    {
                        '@type': 'ListItem',
                        position: 2,
                        name: isThai ? 'สมัครเป็น Cardstreet Breaker' : 'Become a Cardstreet Breaker',
                        item: url,
                    },
                ],
            },
            {
                // Deliberately NOT a JobPosting: this is early access to a
                // marketplace feature, not employment, and mislabelling it in
                // structured data would be a claim we can't stand behind.
                '@type': 'WebPage',
                name: isThai ? 'สมัครเป็น Cardstreet Breaker' : 'Become a Cardstreet Breaker',
                url,
                inLanguage: isThai ? 'th-TH' : 'en-TH',
                isPartOf: { '@id': `${BASE_URL}/#website` },
                about: {
                    '@type': 'Thing',
                    name: 'Cardstreet Live',
                    description: isThai
                        ? 'ไลฟ์เปิดการ์ด TCG บนมาร์เก็ตเพลส CardStreet'
                        : 'Live TCG breaks on the CardStreet marketplace',
                },
            },
        ],
    };
}

export default async function BecomeABreakerPage() {
    const pathLocale = await requestPathLocale();
    const prefill = await loadPrefill();

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(pathLocale)) }}
            />
            <BecomeABreakerContent prefix={localePrefix(pathLocale)} prefill={prefill} />
        </>
    );
}
