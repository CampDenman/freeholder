// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The public surface is dynamic SSR with caching — never SSG'd content
  // (MASTER.md §32: no build step between an owner and their site).
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
