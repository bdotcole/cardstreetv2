import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'CardStreet TCG',
        short_name: 'CardStreet',
        description: 'Thai Pokémon Card Marketplace',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1419',
        theme_color: '#06b6d4',
        icons: [
            {
                src: '/favicon.ico',
                sizes: 'any',
                type: 'image/x-icon',
            },
        ],
    }
}
