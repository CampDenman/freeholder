// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rewrite packages/sdk/src/generated.ts from the live service registry (C3.03).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
writeFileSync(
  join(root, "packages", "sdk", "src", "version.ts"),
  `// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Kept in lockstep with the platform package.json version (C3.20).
export const PLATFORM_VERSION = ${JSON.stringify(version)};
`,
);
const result = spawnSync(
  "pnpm exec vitest run --reporter=dot tests/core/sdk.test.ts",
  {
    cwd: root,
    env: { ...process.env, UPDATE_SDK: "1" },
    shell: true,
    stdio: "inherit",
  },
);
process.exit(result.status === 0 ? 0 : result.status ?? 1);
