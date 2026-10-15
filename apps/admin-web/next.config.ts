import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  async rewrites(){return[{source:"/api/:path*",destination:`${process.env.KWMS_API_ORIGIN||"https://kampalawms.com"}/api/:path*`}];},
};

export default nextConfig;
