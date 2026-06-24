import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal standalone directory so the Docker image only ships what is needed.
  output: "standalone",
};

export default nextConfig;
