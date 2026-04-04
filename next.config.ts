import type { NextConfig } from "next";

const enableLocator =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_LOCATORJS !== "0";
const turbopack = enableLocator
  ? {
      rules: {
        "**/*.{tsx,jsx}": {
          loaders: [
            {
              loader: "@locator/webpack-loader",
              options: {
                env: "development",
              },
            },
          ],
        },
      },
    }
  : undefined;

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: 60 * 1024 * 1024,
  },
  turbopack,
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
