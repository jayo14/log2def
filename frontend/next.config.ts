import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

    return [
      {
        source: '/api/:path*',
        destination,
      },
      {
        source: '/health',
        destination: `${backendTarget}/health/`,
      },
    ];
  },
};

export default nextConfig;
