import type { Metadata } from 'next'
import './globals.css'
import PayPalProvider from '@/components/PayPalProvider'
import { UserSettingsProvider } from '@/lib/contexts/UserSettingsContext'
import { ToastProvider } from '@/lib/contexts/ToastContext'
import PushNotificationManager from '@/components/PushNotificationManager'

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


export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="th">
            <head>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
            </head>
            <body>
                <UserSettingsProvider>
                    <PayPalProvider>
                        <ToastProvider>
                            <PushNotificationManager />
                            {children}
                        </ToastProvider>
                    </PayPalProvider>
                </UserSettingsProvider>

            </body>
        </html>
    )
}
