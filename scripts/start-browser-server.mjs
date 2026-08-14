// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Launch the production standalone build for Playwright on its configured URL.

import { cpSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const baseUrl = new URL(
  process.env.BROWSER_BASE_URL ??
  process.env.A11Y_BASE_URL ??
  "http://localhost:3100",
);
const standalone = resolve(".next/standalone");
if (!existsSync(resolve(standalone, "server.js"))) {
  throw new Error("Build the standalone application before starting browser tests.");
}

for (const [source, destination] of [
  [resolve(".next/static"), resolve(standalone, ".next/static")],
  [resolve("public"), resolve(standalone, "public")],
  [resolve("db/migrations"), resolve(standalone, "db/migrations")],
]) {
  if (existsSync(source)) cpSync(source, destination, { recursive: true });
}

process.env.PORT = baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80");
process.env.HOSTNAME = baseUrl.hostname;
await import(pathToFileURL(resolve(standalone, "server.js")).href);
