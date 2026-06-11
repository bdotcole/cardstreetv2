const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Card art is immutable once published; without this the optimizer falls
    // back to a 60s TTL when origins send short/no cache headers, re-fetching
    // and re-transforming the same images constantly.
    minimumCacheTTL: 2678400, // 31 days
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
        // Official 25th-anniversary portal — logos for some Thai sets (e.g. S8a)
        protocol: 'https',
        hostname: 'card25th.portal-pokemon.com',
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
        // Google avatars (used by Supabase Auth)
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        // Pokedata set images (used for some English sets like Temporal Forces)
        protocol: 'https',
        hostname: 'pokemonsetimages.pokedata.io',
      },
      {
        // Scryfall card images (Magic: The Gathering catalog)
        protocol: 'https',
        hostname: 'cards.scryfall.io',
      },
      {
        // Scryfall set symbol/icon SVGs (used as MTG set logos)
        protocol: 'https',
        hostname: 'svgs.scryfall.io',
      },
      {
        // YGOPRODeck card images (Yu-Gi-Oh! catalog)
        protocol: 'https',
        hostname: 'images.ygoprodeck.com',
      },
      {
        // optcgapi card images (One Piece Card Game catalog)
        protocol: 'https',
        hostname: 'optcgapi.com',
      },
      {
        // Limitless TCG CDN (Japanese Pokemon images for sets TCGdex lacks)
        protocol: 'https',
        hostname: 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com',
      },
      {
        // Limitless TCG set logos (Japanese SV-era set symbols)
        protocol: 'https',
        hostname: 's3.limitlesstcg.com',
      },
      {
        // Bulbagarden archives (real Japanese expansion logos)
        protocol: 'https',
        hostname: 'archives.bulbagarden.net',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['recharts', 'lucide-react'],
  },
  eslint: {
    // Re-enabled: lint must pass at build time. Run `npm run lint` locally
    // before pushing to catch issues before CI does.
    ignoreDuringBuilds: false,
  },
  typescript: {
    // Typecheck must pass at build. Run `npm run typecheck` locally to see
    // errors before pushing; CI will reject builds that have type errors.
    ignoreBuildErrors: false,
  },
}

module.exports = withSentryConfig(
  nextConfig,
  {
    silent: true,
    org: process.env.SENTRY_ORG || "cardstreet",
    project: process.env.SENTRY_PROJECT || "javascript-nextjs",
  },
  {
    widenClientFileUpload: true,
    transpileClientSDK: true,
    hideSourceMaps: true,
    disableLogger: true,
  }
);
