import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js, so the Docker
  // runtime stage ships without node_modules. Required by every container
  // host (Railway/Render/Fly/Cloud Run); ignored by `next dev` and `next start`.
  output: "standalone",
};

export default nextConfig;
