import type { Metadata } from 'next'
import './globals.css'

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
                {children}
            </body>
        </html>
    )
}
