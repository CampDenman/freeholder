// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// CLI boundary for the ownership-export runtime library. Keeping argument
// parsing here prevents a server import from making Next trace the scripts
// directory and the repository around it into the standalone image.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createOwnershipExport,
} from "../src/core/portability/ownership-export.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const databaseUrl = argument(
  "database-url",
  process.env.EXPORT_DATABASE_URL ?? process.env.DATABASE_URL,
);
const stamp = new Date().toISOString().replaceAll(":", "-");
const outputDirectory = argument(
  "output",
  path.resolve(`freeholder-export-${stamp}`),
);
const configPath = path.resolve(
  argument("config", path.resolve("freeholder.config.ts")),
);

try {
  const configContents = await readFile(configPath, "utf8");
  const result = await createOwnershipExport({
    databaseUrl,
    outputDirectory,
    configuration: {
      filename: path.basename(configPath),
      contents: configContents,
    },
  });
  console.log(
    `ownership export: ${result.manifest.tableCount} tables, ${result.manifest.rowCount} rows, ${result.manifest.media.assetCount} media assets -> ${result.outputDirectory}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
