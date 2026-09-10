// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The public surface is dynamic SSR with caching — never SSG'd content
  // (MASTER.md §32: no build step between an owner and their site).
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@freeholder/templates"],
  // Ships a self-contained server with only the files it actually imports, so
  // the production image carries neither node_modules nor the build toolchain
  // (§14: one-command deploy, and a droplet with 4GB has better uses for it).
  output: "standalone",

  // sharp is a native module and must not be bundled. Declaring it external is
  // the supported way to say so, and it is what lets tracing treat the package
  // as a package rather than as a pile of files to enumerate.
  //
  // Added when Next 16.3 was taken for two critical advisories: 16.3's
  // Turbopack follows every glob match and reads it, and pnpm's layout puts a
  // *symlinked directory* — `@img/sharp-libvips-linux-x64` — inside the tree
  // the include below matches. 16.2 tolerated that; 16.3 fails the build with
  // "Is a directory (os error 21)".
  serverExternalPackages: ["sharp"],

  // sharp loads its native library by resolving a path at runtime, which
  // dependency tracing cannot see — so the standalone output shipped the
  // JavaScript and left `libvips-cpp.so` behind, and the image died on boot
  // with ERR_DLOPEN_FAILED. Naming the packages explicitly is what gets the
  // platform binaries into the artifact.
  //
  // Found by CI booting the image rather than by anything at build time: the
  // build succeeds either way, which is exactly why §18's recipe check runs
  // the container instead of trusting that it compiled.
  // Every pattern ends in something file-shaped, and that is the point rather
  // than tidiness. pnpm's virtual store puts *symlinked directories* under
  // `node_modules/.pnpm/node_modules/@img/` — `colour`, and the platform
  // package. A bare `@img/**/*` matches those symlinks, and Turbopack 16.3
  // reads every match: "Is a directory (os error 21)" on Linux, "Access is
  // denied" on Windows. 16.2 tolerated it. Requiring an extension or a `lib/`
  // segment means a directory can never be a match in the first place.
  //
  // `lib/*` rather than `lib/*.so`: the Linux artifact is `libvips-cpp.so.42`,
  // whose extension is `.42`.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/sharp/**/*.{js,cjs,mjs,json,node}",
      "./node_modules/@img/**/*.{js,cjs,mjs,json,node}",
      "./node_modules/@img/*/lib/*",
    ],
  },

  // Runtime filesystem adapters accept paths that do not exist until an
  // owner uses them. Static tracing can conservatively mistake those reads
  // for dependencies on matching source, fixture and documentation files.
  // These roots are either compiled into server chunks or copied explicitly
  // by the runtime image (public/ and db/); none is executed from source.
  outputFileTracingExcludes: {
    "/*": [
      "./.git/**",
      "./.github/**",
      "./.agents/**",
      "./.codex/**",
      "./.claude/**",
      "./.work/**",
      "./apps/**",
      "./test-results/**",
      "./app/**/*.{ts,tsx,md}",
      "./db/**/*.md",
      "./deploy/**",
      "./locales/**/*.md",
      "./packages/**/*.md",
      "./plugins/**/*.{ts,tsx,md,json}",
      "./scripts/**",
      "./seed/**",
      "./src/**/*.{ts,tsx,mjs,mts,md}",
      "./tests/**",
      "./README.md",
    ],
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
        source: "/((?!preview|embed).*)",
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
          // Record Studio asks for same-origin camera, microphone and screen
          // capture after a person clicks Grant. Browser permission remains
          // mandatory. This must be document-wide rather than scoped only to
          // /admin/media/record: client navigation retains the policy of the
          // document that first loaded the admin. Location and Payment Request
          // are not core capabilities and remain disabled.
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()",
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
        // the page being edited. Proxy supplies the nonce-based CSP and its
        // `frame-ancestors 'self'`; SAMEORIGIN remains the legacy fallback.
        source: "/preview/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      {
        // Copy-paste embeds (C9.36 / §34). Framed on purpose. CSP
        // `frame-ancestors *` is the real control; omitting X-Frame-Options
        // lets that directive stand. These URLs are widgets, not pages.
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
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
