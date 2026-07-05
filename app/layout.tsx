import type { Metadata } from 'next'
import { headers, cookies } from 'next/headers'
import './globals.css'
import { UserSettingsProvider } from '@/lib/contexts/UserSettingsContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'
import PushNotificationManager from '@/components/PushNotificationManager'
import HtmlLangSync from '@/components/HtmlLangSync'
import { GoogleAnalytics } from '@next/third-parties/google'
export const metadata: Metadata = {
    title: 'CardStreet TCG - Thai Pokémon Card Marketplace',
    description: 'Buy, sell, and collect Pokémon cards in Thailand. Scan cards with AI, track your collection value, and trade with verified sellers.',
    keywords: ['Pokemon', 'TCG', 'Thailand', 'การ์ด', 'โปเกมอน', 'marketplace'],
    manifest: '/manifest.json',
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

    return (
        <html lang={lang === 'EN' ? 'en' : 'th'} className={theme === 'light' ? 'theme-light' : undefined}>
            <head>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
            </head>
            <body>
                {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
                    <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
                )}
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
                        {children}
                    </ToastProvider>
                </UserSettingsProvider>

            </body>
        </html>
    )
}
