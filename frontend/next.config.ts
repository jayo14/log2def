import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Built-in reverse proxy rewrite: forwards /api/* to the Django backend
    const backendTarget = (
      process.env.BACKEND_API_URL ||
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      'http://127.0.0.1:8000'
    ).trim().replace(/\/+$/, '');

    const destination = backendTarget.endsWith('/api')
      ? `${backendTarget}/:path*`
      : `${backendTarget}/api/:path*`;

    const backendRoot = backendTarget.endsWith('/api')
      ? backendTarget.replace(/\/api$/, '')
      : backendTarget;

    return [
      {
        source: '/api/:path*',
        destination,
      },
      {
        source: '/media/:path*',
        destination: `${backendRoot}/media/:path*`,
      },
      {
        source: '/health',
        destination: `${backendRoot}/health/`,
      },
    ];
  },
};

export default nextConfig;
