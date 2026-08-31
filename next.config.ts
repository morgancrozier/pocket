import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    const headers = [
      {
        key: "Origin-Agent-Cluster",
        value: "?1",
      },
    ];

    if (process.env.WEBMCP_ORIGIN_TRIAL_TOKEN) {
      headers.push({
        key: "Origin-Trial",
        value: process.env.WEBMCP_ORIGIN_TRIAL_TOKEN,
      });
    }

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
