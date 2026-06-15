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

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    viewportFit: 'cover' as const,
    themeColor: '#0f1419',
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

    return (
        <html lang={lang === 'EN' ? 'en' : 'th'}>
            <head>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
            </head>
            <body>
                {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
                    <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
                )}
                <UserSettingsProvider initialLanguage={lang}>
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
