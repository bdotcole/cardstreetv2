import type { Metadata } from 'next'
import { headers, cookies } from 'next/headers'
import './globals.css'
import { localizedUrl, requestPathLocale } from '@/lib/i18nRouting'
import { UserSettingsProvider } from '@/lib/contexts/UserSettingsContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'
import PushNotificationManager from '@/components/PushNotificationManager'
import ActivityPinger from '@/components/ActivityPinger'
import HtmlLangSync from '@/components/HtmlLangSync'
import { GoogleAnalytics } from '@next/third-parties/google'
import AttributionCapture from '@/components/AttributionCapture'
// Sitewide metadata default, localized per request (middleware resolves the
// locale into the x-cs-lang header; Thai is canonical). Pages with their own
// generateMetadata override this. Copy names all six games — the marketplace
// stopped being Pokémon-only long ago and Thai head terms (การ์ดโปเกมอน,
// การ์ดวันพีช, ...) are what the Thai market actually searches.
export async function generateMetadata(): Promise<Metadata> {
    const lang = (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH'
    const title =
        lang === 'EN'
            ? 'CardStreet — Buy & Sell Pokémon, One Piece, Yu-Gi-Oh & MTG Cards in Thailand'
            : 'CardStreet — ตลาดซื้อขายการ์ดโปเกมอน วันพีช ยูกิ MTG ในไทย'
    const description =
        lang === 'EN'
            ? 'Buy, sell, and collect Pokémon, One Piece, Yu-Gi-Oh!, Magic: The Gathering, Lorcana, and Riftbound cards in Thailand. AI card scanning, live market prices, verified sellers, nationwide shipping.'
            : 'ซื้อ ขาย และสะสมการ์ดโปเกมอน การ์ดวันพีช การ์ดยูกิ Magic, Lorcana และ Riftbound ในประเทศไทย สแกนการ์ดด้วย AI เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ส่งไวทั่วไทย'

    // Search-engine site-verification tokens. Set these in Vercel env to verify
    // ownership via the meta-tag method (no code change / redeploy of source):
    //   NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION — the token from Google Search
    //     Console's "HTML tag" method (the content="..." value, not the whole tag).
    //   NEXT_PUBLIC_BING_SITE_VERIFICATION — the token from Bing Webmaster Tools'
    //     "meta tag" (msvalidate.01) option.
    // Both render nothing until set, so this is inert by default. GSC can also be
    // verified with zero config via the existing Google Analytics tag.
    const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    const bingVerification = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION

    return {
        // Absolute base so the auto-generated OG image + canonical URLs resolve for
        // crawlers (LINE / Facebook / Messenger, where Thai reshare traffic flows).
        metadataBase: new URL('https://cardstreet.app'),
        title,
        description,
        keywords: [
            'Pokemon TCG', 'การ์ดโปเกมอน', 'โปเกมอนการ์ด', 'การ์ดวันพีช', 'One Piece Card Game',
            'การ์ดยูกิ', 'Yu-Gi-Oh', 'Magic The Gathering', 'MTG', 'Disney Lorcana', 'Riftbound',
            'ตลาดการ์ด', 'เช็คราคาการ์ด', 'ร้านขายการ์ด', 'Thailand',
        ],
        manifest: '/manifest.webmanifest',
        // og:image / twitter:image are auto-populated from app/opengraph-image.tsx.
        openGraph: {
            type: 'website',
            siteName: 'CardStreet',
            // Follow the URL variant being served — a bare-path og:url on an /en
            // render is a stray canonical hint back at the Thai URL.
            url: localizedUrl('/', await requestPathLocale()),
            title,
            description,
            locale: lang === 'EN' ? 'en_US' : 'th_TH',
            alternateLocale: lang === 'EN' ? 'th_TH' : 'en_US',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
        ...((googleVerification || bingVerification) && {
            verification: {
                ...(googleVerification ? { google: googleVerification } : {}),
                ...(bingVerification ? { other: { 'msvalidate.01': bingVerification } } : {}),
            },
        }),
    }
}

export async function generateViewport() {
    const theme = (await cookies()).get('cs_theme')?.value
    return {
        width: 'device-width',
        initialScale: 1,
        maximumScale: 1,
        viewportFit: 'cover' as const,
        themeColor: theme === 'light' ? '#f1f5f9' : '#0f1419',
    }
}


export default async function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Locale resolved by middleware (cs_lang cookie / Accept-Language), passed
    // via the x-cs-lang request header. Drives <html lang> and the settings
    // provider's initial language so the server renders the right locale.
    // Thai is the canonical default when nothing is set.
    const resolved = (await headers()).get('x-cs-lang')
        ?? (await cookies()).get('cs_lang')?.value
    const lang: 'TH' | 'EN' = resolved === 'EN' ? 'EN' : 'TH'

    // Theme is a plain cookie preference (set by UserSettingsContext when the
    // user toggles it in settings). Rendering the class on <html> server-side
    // means a light-mode user never sees a dark flash.
    const theme: 'dark' | 'light' =
        (await cookies()).get('cs_theme')?.value === 'light' ? 'light' : 'dark'

    // Trailing whitespace in the dashboard value lands verbatim in the GA
    // <script> src. A raw newline there is an invalid CSS selector, so the
    // querySelector next/script uses to dedupe the tag throws, the script never
    // loads, and window.gtag stays undefined — analytics silently records
    // nothing while every page load emits an uncaught SyntaxError. Trim so a
    // stray newline in the env var can't take the tag down again.
    const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()

    return (
        <html lang={lang === 'EN' ? 'en' : 'th'} className={theme === 'light' ? 'theme-light' : undefined}>
            <head>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
            </head>
            <body>
                {/* Sitewide Organization + WebSite graph. The SearchAction target is
                    the marketplace's /?q= listings search (see DesktopNav) — it makes
                    the site eligible for the Google sitelinks search box and gives AI
                    answer engines a machine-readable identity for CardStreet. */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@graph': [
                                {
                                    '@type': 'Organization',
                                    '@id': 'https://cardstreet.app/#organization',
                                    name: 'CardStreet',
                                    url: 'https://cardstreet.app',
                                    logo: 'https://cardstreet.app/logo.png',
                                },
                                {
                                    '@type': 'WebSite',
                                    '@id': 'https://cardstreet.app/#website',
                                    name: 'CardStreet',
                                    url: 'https://cardstreet.app',
                                    inLanguage: ['th', 'en'],
                                    publisher: { '@id': 'https://cardstreet.app/#organization' },
                                    potentialAction: {
                                        '@type': 'SearchAction',
                                        target: {
                                            '@type': 'EntryPoint',
                                            urlTemplate: 'https://cardstreet.app/?q={search_term_string}',
                                        },
                                        'query-input': 'required name=search_term_string',
                                    },
                                },
                            ],
                        }),
                    }}
                />
                {/* First-touch acquisition capture. In the ROOT layout because the
                    standalone SEO landings (/prices, /graded, /sell-cards, /faq) sit
                    outside both shells, and those are the pages organic visitors
                    land on first. */}
                <AttributionCapture />
                {gaId && <GoogleAnalytics gaId={gaId} />}
                {/* Meta Pixel. Loads inside the iOS WebView and on web; conversion
                    events are sent via lib/metaEvents.ts (which also bridges to the
                    native FB SDK in the app). Inert until NEXT_PUBLIC_META_PIXEL_ID
                    is set, so this is safe to ship before the Pixel is configured. */}
                {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
                    <>
                        <script
                            dangerouslySetInnerHTML={{
                                __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${process.env.NEXT_PUBLIC_META_PIXEL_ID}');
fbq('track', 'PageView');`,
                            }}
                        />
                        <noscript>
                            <img
                                height="1"
                                width="1"
                                style={{ display: 'none' }}
                                alt=""
                                src={`https://www.facebook.com/tr?id=${process.env.NEXT_PUBLIC_META_PIXEL_ID}&ev=PageView&noscript=1`}
                            />
                        </noscript>
                    </>
                )}
                <UserSettingsProvider initialLanguage={lang} initialTheme={theme}>
                    <ToastProvider>
                        <HtmlLangSync />
                        <PushNotificationManager />
                        <ActivityPinger />
                        {children}
                    </ToastProvider>
                </UserSettingsProvider>

            </body>
        </html>
    )
}
