// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scaffold a plugin folder (C3.12).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function scaffoldPlugin(root: string, name: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "plugin.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        freeholder: ">=0.0.0",
        license: "MIT",
        permissions: ["cms:view"],
        requires: ["core"],
        migrations: [],
        capabilities: { blocks: true, automations: true, adapters: [] },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "CHANGELOG.md"),
    `# Changelog\n\n## 0.1.0\n\n- Initial scaffold for ${name}.\n`,
  );
  await writeFile(
    join(root, "README.md"),
    `# ${name}\n\nA Freeholder plugin. \`plugin.json\` is the contract (C3.08).\n\nExamples in this folder: block, service, adapter, automation, route.\n`,
  );
  await writeFile(
    join(root, "block.ts"),
    `// Example CMS block contribution.\nexport const type = "example-block";\n`,
  );
  await writeFile(
    join(root, "service.ts"),
    `// Example service. Register through defineService on a real plugin.\nexport const name = "${name}.ping";\n`,
  );
  await writeFile(
    join(root, "adapter.ts"),
    `// Example adapter family contribution.\nexport const family = "storage";\n`,
  );
  await writeFile(
    join(root, "automation.ts"),
    `// Example automation verb.\nexport const verb = "${name}.notify";\n`,
  );
  await writeFile(
    join(root, "route.ts"),
    `// Example public route seam.\nexport const path = "/${name}";\n`,
  );
}
