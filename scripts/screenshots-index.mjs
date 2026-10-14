// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Turn test-results/screenshots/manifest.json into a browsable README.md for
// the `screenshots` branch (living screenshots, MASTER.md C3.29).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GROUPS = [
  ["Customer journey", (s) => s.slug.startsWith("journey-")],
  ["Public site", (s) => !s.slug.startsWith("journey-") && s.role === "public"],
  ["Customer portal", (s) => !s.slug.startsWith("journey-") && s.role === "customer"],
  ["Admin", (s) => s.role === "owner"],
];

export function renderIndex(manifest) {
  const lines = [
    "# Freeholder screenshots",
    "",
    "Every screen of the current Freeholder app, captured automatically from",
    "`main` over the Aurora Coast demo business. Light and dark, desktop (1440px)",
    "and mobile (390px). Do not edit this branch by hand; the Screenshots workflow",
    "replaces it on every change.",
    "",
    `Captured ${manifest.capturedAt}${manifest.commit ? ` from commit \`${manifest.commit.slice(0, 12)}\`` : ""}.`,
    `${manifest.shots.length} screens; ${manifest.skipped.length} routes not captured (listed at the end).`,
    "",
  ];
  for (const [title, test] of GROUPS) {
    const shots = manifest.shots.filter(test);
    if (shots.length === 0) continue;
    lines.push(`## ${title} (${shots.length})`, "");
    for (const shot of shots) {
      const [desktopLight] = shot.files;
      const links = shot.files.map((f) => `[${f.split("--").slice(1).join(" ").replace(".webp", "")}](${f})`).join(" · ");
      lines.push(`### \`${shot.url}\``, "", `${shot.title}`, "", `<a href="${desktopLight}"><img src="${desktopLight}" width="480" alt="${shot.url}"></a>`, "", links, "");
    }
  }
  if (manifest.skipped.length > 0) {
    lines.push("## Not captured", "", "| Route | Why |", "| --- | --- |");
    for (const s of manifest.skipped) lines.push(`| \`${s.route}\` | ${s.reason.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
    lines.push("");
  }
  return lines.join("\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const dir = process.argv[2] ?? "test-results/screenshots";
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  writeFileSync(join(dir, "README.md"), renderIndex(manifest));
  console.log(`Wrote ${join(dir, "README.md")} for ${manifest.shots.length} screens.`);
}
