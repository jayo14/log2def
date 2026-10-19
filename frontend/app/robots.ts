import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://log2def.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/dashboard/', '/projects/'],
      },
      {
        userAgent: ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'OAI-SearchBot', 'Claude-SearchBot'],
        allow: '/',
        disallow: ['/admin/', '/api/', '/dashboard/', '/projects/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
