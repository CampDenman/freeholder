// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The public surface is dynamic SSR with caching — never SSG'd content
  // (MASTER.md §32: no build step between an owner and their site).
  reactStrictMode: true,
  poweredByHeader: false,
  // Ships a self-contained server with only the files it actually imports, so
  // the production image carries neither node_modules nor the build toolchain
  // (§14: one-command deploy, and a droplet with 4GB has better uses for it).
  output: "standalone",

  // Security headers (MASTER.md §36: "security headers … shipped, not sold").
  // Set here rather than in a recipe's reverse proxy on purpose — every target
  // must get them, and a header that depends on the deploy being configured
  // correctly is a header half the deploys will not have.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser second-guessing a declared content type, which is
          // how an uploaded file gets treated as a script (§18 media lives in
          // object storage, but the app still serves user-influenced bytes).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Clickjacking: no Freeholder surface is meant to be framed, and the
          // admin least of all.
          { key: "X-Frame-Options", value: "DENY" },
          // Referrers keep the origin cross-site but never leak an admin or
          // portal path — those URLs name entities.
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Nothing in core asks for a camera, a microphone or a location.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Two years, subdomains included. Recipes terminate TLS in front of
          // the app (Caddy on the droplet), so this is the app stating the
          // requirement rather than trusting each proxy to remember it.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
