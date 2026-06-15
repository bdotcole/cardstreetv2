import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Internal/authenticated surfaces — no SEO value, keep crawlers out.
      disallow: ['/admin', '/api', '/desktop'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
