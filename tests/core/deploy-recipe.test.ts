// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Guards on the deploy recipes (MASTER.md §18). These files are not imported by
// anything, so nothing else would notice them breaking — and the way they break
// is silent.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEPLOY = "deploy";

function recipes(): string[] {
  return readdirSync(DEPLOY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("cloud-init files are ASCII only", () => {
  // The bug this exists for: an em dash in a comment made cloud-init reject the
  // entire document with "unacceptable character #x0080". User-data reaches the
  // parser without a UTF-8 decode, so one byte above 0x7F discards every
  // directive. Worse, it fails silently — `cloud-init status` still says
  // "done", and the failure surfaces as no Docker on a machine that claims to
  // have finished bootstrapping.
  for (const recipe of recipes()) {
    const path = join(DEPLOY, recipe, "infra", "cloud-init.yml");
    let contents: string | undefined;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      contents = undefined;
    }

    it.runIf(contents !== undefined)(`${recipe}: no byte above 0x7F`, () => {
      const offenders = [...contents!]
        .map((char, index) => ({ char, index, code: char.codePointAt(0)! }))
        .filter(({ code }) => code > 0x7f);

      expect(
        offenders.map((o) => `${JSON.stringify(o.char)} at offset ${o.index}`),
      ).toEqual([]);
    });
  }
});

describe("every recipe carries the files §18 requires", () => {
  for (const recipe of recipes()) {
    it(`${recipe} is complete`, () => {
      const required = ["recipe.yaml", "README.md", ".env.example", "verify.md"];
      const present = readdirSync(join(DEPLOY, recipe));
      for (const file of required) {
        expect(present, `${recipe}/${file}`).toContain(file);
      }
    });
  }
});

describe("the compose stack does not contradict the storage mandate", () => {
  for (const recipe of recipes()) {
    const path = join(DEPLOY, recipe, "infra", "compose.yml");
    let compose: string | undefined;
    try {
      compose = readFileSync(path, "utf8");
    } catch {
      compose = undefined;
    }

    it.runIf(compose !== undefined)(`${recipe}: no media volume`, () => {
      // §18: media lives in object storage, never on instance disk. A bind
      // mount for uploads would quietly reintroduce exactly what the mandate
      // forbids, and it would look reasonable in review.
      expect(compose!).not.toMatch(/media.*:\s*\/app\/(public\/)?media/i);
      expect(compose!).not.toMatch(/uploads:/i);
    });

    it.runIf(compose !== undefined)(
      `${recipe}: the proxy is given every variable its config interpolates`,
      () => {
        // The bug this exists for: the Caddyfile reads {$FREEHOLDER_DOMAIN},
        // which is Caddy's own substitution against the *container's*
        // environment — not compose's substitution against .env. The service
        // had neither `environment:` nor `env_file:`, so the variable was
        // empty, the site address vanished, and Caddy read the leftover `{` as
        // a global options block and refused to start. Nothing looked wrong:
        // app and db were up, and only the public surface was missing.
        const proxyPath = join(DEPLOY, recipe, "infra", "Caddyfile");
        let proxyConfig: string | undefined;
        try {
          proxyConfig = readFileSync(proxyPath, "utf8");
        } catch {
          return; // recipe does not use Caddy
        }

        const interpolated = [
          ...proxyConfig.matchAll(/\{\$([A-Z0-9_]+)\}/g),
        ].map((m) => m[1]!);
        expect(interpolated.length).toBeGreaterThan(0);

        const caddySection = compose!.slice(
          compose!.indexOf("  caddy:"),
          compose!.indexOf("  app:"),
        );
        for (const variable of interpolated) {
          expect(
            caddySection,
            `Caddyfile interpolates ${variable}, but the caddy service never receives it — ` +
              `it will read as empty and the config will not parse.`,
          ).toMatch(new RegExp(`${variable}\\s*:`));
        }
      },
    );

    it.runIf(compose !== undefined)(`${recipe}: database is not published`, () => {
      // `ports:` on the database would expose Postgres to the internet; the
      // app reaches it over the compose network with `expose:` instead.
      const dbSection = compose!.slice(compose!.indexOf("  db:"));
      expect(dbSection).not.toMatch(/^\s{4}ports:/m);
    });
  }
});
