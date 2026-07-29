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
};

export default nextConfig;
