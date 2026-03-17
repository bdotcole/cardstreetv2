/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.tcgdex.net',
      },
      {
        protocol: 'https',
        hostname: 'api.tcgdex.net',
      },
      {
        protocol: 'https',
        hostname: 'asia.pokemon-card.com',
      },
      {
        // Supabase Storage — card images, set logos, avatars
        protocol: 'https',
        hostname: 'fdxgzddvywtmnqsaqysx.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Supabase Storage render/transform endpoint
        protocol: 'https',
        hostname: 'fdxgzddvywtmnqsaqysx.supabase.co',
        pathname: '/storage/v1/render/image/**',
      },
      {
        // DiceBear avatars (used as user avatar fallback)
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
      {
        // Pokedata set images (used for some English sets like Temporal Forces)
        protocol: 'https',
        hostname: 'pokemonsetimages.pokedata.io',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['recharts'],
  },
}

module.exports = nextConfig
