import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";

// Next is always run from apps/admin-web. Compile from here, but inside the monorepo keep tracing from the repo root
// so the standalone build stays at .next/standalone/apps/admin-web, where the desktop app loads it.
const projectRoot = process.cwd();
const repoRoot = path.join(projectRoot, "../..");
const inMonorepo = existsSync(path.join(repoRoot, "apps", "admin-web", "package.json"));

// Baseline browser hardening for every page (web and the desktop app's local web server).
// A full Content-Security-Policy is a separate, tested step because maps load third-party tiles.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  turbopack: { root: projectRoot },
  ...(inMonorepo ? { outputFileTracingRoot: repoRoot } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites(){return[{source:"/api/:path*",destination:`${process.env.KWMS_API_ORIGIN||"https://kampalawms.com"}/api/:path*`}];},
};

export default nextConfig;
