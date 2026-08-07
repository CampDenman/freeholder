// Copyright (C) 2026 Tony Aly
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

  // sharp loads its native library by resolving a path at runtime, which
  // dependency tracing cannot see — so the standalone output shipped the
  // JavaScript and left `libvips-cpp.so` behind, and the image died on boot
  // with ERR_DLOPEN_FAILED. Naming the packages explicitly is what gets the
  // platform binaries into the artifact.
  //
  // Found by CI booting the image rather than by anything at build time: the
  // build succeeds either way, which is exactly why §18's recipe check runs
  // the container instead of trusting that it compiled.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/sharp/**", "./node_modules/@img/**"],
  },

  // Security headers (MASTER.md §36: "security headers … shipped, not sold").
  // Set here rather than in a recipe's reverse proxy on purpose — every target
  // must get them, and a header that depends on the deploy being configured
  // correctly is a header half the deploys will not have.
  async headers() {
    return [
      {
        // The editor canvas frames this same origin (§32's live preview), and
        // `DENY` blocks framing even by the site itself — so the preview group
        // is carved out here and given `SAMEORIGIN` below rather than having
        // the whole site weakened to allow one screen.
        source: "/((?!preview).*)",
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
      {
        // Same protections, minus the one that would stop the editor showing
        // the page being edited. `frame-ancestors 'self'` is the modern
        // expression of the same rule and is what a current browser honours;
        // SAMEORIGIN is there for anything that does not.
        source: "/preview/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
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
