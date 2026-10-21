// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.31: the shipped app/db/caddy recipe must match the invariants the host
// executor enforces in inventory() — and Docker's socket must never enter the
// application. These files are not imported by anything; nothing else would
// notice them drifting from the executor's gates.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const DIR = "deploy/docker-selfhost/docker-updater";
const composeText = readFileSync(`${DIR}/compose.yml`, "utf8");
const compose = parse(composeText) as {
  services: Record<
    string,
    {
      image?: string;
      ports?: unknown[];
      expose?: unknown[];
      environment?: Record<string, string>;
      volumes?: Array<Record<string, unknown>> | string[];
    }
  >;
};

describe("host updater supported recipe (C10.31)", () => {
  it("is exactly the app/db/caddy recipe", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["app", "caddy", "db"]);
  });

  it("pins the app image through FREEHOLDER_IMAGE", () => {
    expect(compose.services.app?.image).toMatch(/\$\{FREEHOLDER_IMAGE/);
  });

  it("publishes no app port; traffic enters through Caddy only", () => {
    expect(compose.services.app?.ports ?? []).toEqual([]);
    expect(compose.services.caddy?.ports).toEqual(
      expect.arrayContaining(["80:80", "443:443"]),
    );
  });

  it("requires S3 media and the private updater socket", () => {
    const environment = compose.services.app?.environment ?? {};
    expect(environment.FREEHOLDER_STORAGE).toBe("s3");
    expect(environment.FREEHOLDER_UPDATE_SOCKET).toMatch(/^\/run\/freeholder-updater\//);
  });

  it("mounts only the read-only updater socket directory on the app", () => {
    const volumes = compose.services.app?.volumes ?? [];
    expect(volumes).toHaveLength(1);
    expect(volumes[0]).toBe("/run/freeholder-updater:/run/freeholder-updater:ro");
  });

  it("never mounts the Docker socket anywhere in the recipe", () => {
    expect(composeText).not.toMatch(/docker\.sock/);
    expect(composeText).not.toMatch(/\/var\/run\/docker/);
  });

  it("runs PostgreSQL 16 as the database", () => {
    expect(compose.services.db?.image).toMatch(/^postgres:16/);
  });

  it("proxies to the app from the shipped Caddyfile", () => {
    const caddyfile = readFileSync(`${DIR}/Caddyfile`, "utf8");
    expect(caddyfile).toContain("{$FREEHOLDER_DOMAIN}");
    expect(caddyfile).toContain("reverse_proxy app:3000");
  });
});
