import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Full API base URL incl. /api/v1 (server-side only). Used for SSR calls and as the proxy target.
// NOTE: rewrite destinations are resolved at build time, so set this before `next build`.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1";
const API_ORIGIN = API_INTERNAL_URL.replace(/\/api\/v1\/?$/, "");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Legacy: images uploaded before the move off Supabase Storage. Remove once migrated.
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com", // Google OAuth avatars
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com", // Fallback avatars
      },
    ],
    formats: ["image/avif", "image/webp"],
  },
  // Required for mapbox-gl to bundle correctly in Next.js
  transpilePackages: ["mapbox-gl"],
  // Proxy the browser's /api/v1/* calls to the NestJS API. Same-origin means no CORS and the
  // API's HttpOnly refresh cookie (path /api/v1/auth) works without SameSite=None.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default function config(phase: string): NextConfig {
  return {
    ...nextConfig,
    // Production builds clear their output; keep the running dev server's files separate.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
