import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // required for the slim Docker image (see Dockerfile)
  output: "standalone",
  // projects.json is read from disk at runtime (it's the repo allowlist, edited
  // from the UI), so keep it in the standalone output.
  outputFileTracingIncludes: { "/*": ["./projects.json"] },
  // Silence Turbopack error when webpack config is present (from Serwist)
  turbopack: {},
};

export default withSerwist(nextConfig);
