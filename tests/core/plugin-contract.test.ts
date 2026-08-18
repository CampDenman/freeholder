// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin manifest, permissions and compatibility (C3.08).
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  definePlugin,
  describePermission,
  parsePermission,
  pluginFitsPlatform,
  PluginContractError,
  satisfies,
} from "@freeholder/plugin-kit";
import { assertPluginFitsInstance, isPluginManifest } from "@/core/plugin";
import { PLATFORM_VERSION } from "@/core/platform";
import manifests from "@/modules";
import proof from "@/modules/proof/manifest";

describe("plugin semver ranges", () => {
  it("understands caret, tilde and comparator ranges", () => {
    expect(satisfies("1.4.2", "^1.4.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.4.0")).toBe(false);
    expect(satisfies("0.1.5", "^0.1.0")).toBe(true);
    expect(satisfies("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfies("1.2.9", "~1.2.0")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfies("0.0.0", ">=0.0.0")).toBe(true);
    expect(satisfies("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  });
});

describe("plugin permissions", () => {
  it("maps §26 verbs onto view/manage and names them for a person", () => {
    expect(parsePermission("contacts:read")).toEqual({
      raw: "contacts:read",
      module: "contacts",
      access: "view",
    });
    expect(parsePermission("invoicing:create")).toMatchObject({
      module: "invoicing",
      access: "manage",
    });
    expect(describePermission(parsePermission("network:external"))).toBe(
      "can make outbound network requests",
    );
    expect(describePermission(parsePermission("cms:view"))).toBe("can view cms");
  });

  it("refuses a scope that is not a permission", () => {
    expect(() => parsePermission("contacts.*")).toThrow(PluginContractError);
    expect(() => parsePermission("root")).toThrow(PluginContractError);
  });
});

describe("definePlugin", () => {
  it("stamps kind and keeps the module fields boot already understands", () => {
    const plugin = definePlugin({
      name: "gift-registry",
      version: "0.1.0",
      freeholder: ">=0.0.0",
      license: "MIT",
      permissions: ["invoicing:create", "contacts:read"],
      requires: ["core", "invoicing"],
      migrations: ["0100_gift_registry.sql"],
      capabilities: { blocks: true },
    });
    expect(plugin.kind).toBe("plugin");
    expect(plugin.requires).toEqual(["core", "invoicing"]);
    expect(plugin.migrations).toEqual(["0100_gift_registry.sql"]);
  });

  it("refuses a broken name, version, range, license or migration", () => {
    const base = {
      name: "gift-registry",
      version: "0.1.0",
      freeholder: ">=0.0.0",
      license: "MIT",
    };
    expect(() => definePlugin({ ...base, name: "GiftRegistry" })).toThrow(
      /lowercase/,
    );
    expect(() => definePlugin({ ...base, version: "1" })).toThrow(/semver/);
    expect(() => definePlugin({ ...base, freeholder: "latest" })).toThrow(
      /semver range/,
    );
    expect(() => definePlugin({ ...base, license: "proprietary license" })).toThrow(
      /SPDX/,
    );
    expect(() =>
      definePlugin({ ...base, migrations: ["not-sql"] }),
    ).toThrow(/\.sql/);
  });
});

describe("instance fit", () => {
  it("accepts the proof plugin against this platform and its migrations", () => {
    expect(isPluginManifest(proof)).toBe(true);
    expect(pluginFitsPlatform(proof.freeholder, PLATFORM_VERSION)).toBe(true);
    assertPluginFitsInstance(proof, {
      installed: manifests.map((row) => row.name),
      migrationsDir: "db/migrations",
    });
    expect(existsSync("db/migrations/0073_plain_lilandra.sql")).toBe(true);
  });

  it("names the plugin when the platform is outside its range", () => {
    const plugin = definePlugin({
      name: "gift-registry",
      version: "0.1.0",
      freeholder: "^1.4.0",
      license: "MIT",
    });
    expect(() =>
      assertPluginFitsInstance(plugin, {
        platformVersion: "0.0.0",
        installed: ["core"],
      }),
    ).toThrow(/requires Freeholder \^1\.4\.0/);
  });

  it("names a missing module dependency", () => {
    const plugin = definePlugin({
      name: "gift-registry",
      version: "0.1.0",
      freeholder: ">=0.0.0",
      license: "MIT",
      requires: ["core", "calendar"],
    });
    expect(() =>
      assertPluginFitsInstance(plugin, {
        installed: ["core", "cms"],
      }),
    ).toThrow(/requires module "calendar"/);
  });
});
