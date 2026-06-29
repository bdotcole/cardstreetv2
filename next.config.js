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
      {
        // TCGPlayer CDN (real Japanese scans for vintage cards, keyed by tcgplayerId)
        protocol: 'https',
        hostname: 'tcgplayer-cdn.tcgplayer.com',
      },
      {
        // TCGPlayer product images (sized thumbnail variant)
        protocol: 'https',
        hostname: 'product-images.tcgplayer.com',
      },
      {
        // Disney Lorcana official CDN (LorcanaJSON catalog images)
        protocol: 'https',
        hostname: 'api.lorcana.ravensburger.com',
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

// NOTE: the v10 SDK takes a single options object. The previous third
// positional argument (widenClientFileUpload / hideSourceMaps /
// transpileClientSDK) was silently ignored, so those settings never applied.
//
// Source map upload requires SENTRY_AUTH_TOKEN (an org auth token with the
// project:releases scope) in the BUILD environment (Vercel). Without it no maps
// are uploaded and production stack traces show minified frames (js_no_source) —
// the gap that left CARDSTREET-5's real frames unreadable for two months.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || "cardstreet",
  project: process.env.SENTRY_PROJECT || "cardstreet",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Stay quiet locally, but log upload status in the Vercel build so a missing
  // auth token is visible next time instead of silently skipping upload.
  silent: !process.env.VERCEL,
  // Upload maps for the framework/vendor chunks too (the unsymbolicated
  // 4bd1b696-* / 1799-* frames in CARDSTREET-5), not just first-party files.
  widenClientFileUpload: true,
  sourcemaps: {
    // Upload, then strip from the client bundle so maps aren't served publicly
    // (replaces the v10-ignored `hideSourceMaps: true`).
    deleteSourcemapsAfterUpload: true,
  },
});
