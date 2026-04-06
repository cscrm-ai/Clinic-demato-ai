import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from Supabase storage
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  // API proxied to Python backend during local dev
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${apiBase}/api/:path*` },
      { source: "/analyze", destination: `${apiBase}/analyze` },
      { source: "/webhooks/:path*", destination: `${apiBase}/webhooks/:path*` },
      { source: "/health", destination: `${apiBase}/health` },
    ];
  },
};

export default nextConfig;
