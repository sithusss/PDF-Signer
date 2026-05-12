import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:5000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/add-signature",
        destination: `${backendUrl}/add-signature`,
      },
    ];
  },
};

export default nextConfig;
