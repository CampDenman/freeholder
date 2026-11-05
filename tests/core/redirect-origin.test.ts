// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Redirects land on the configured site origin, never the request's own URL.
// Behind a reverse proxy (a hosted preview, a load balancer) the request URL
// names the app's internal address — the C3.39 rehearsal found the customer
// magic link sending browsers to https://0.0.0.0:3000.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/core/env";
import { GET as magic } from "../../app/portal/magic/route";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}

afterEach(() => {
  delete process.env.APP_URL;
  resetEnvForTests();
});

describe("redirect targets", () => {
  it("the magic link confirms on the configured origin behind a proxy", () => {
    process.env.APP_URL = "https://preview.example";
    resetEnvForTests();
    const response = magic(new Request("https://0.0.0.0:3000/portal/magic?token=abcdefghijklmnopqrstuvwxyz&locale=en&default=en"));
    expect(response.headers.get("location")).toBe("https://preview.example/portal/magic/confirm");
  });

  it("no route handler builds a redirect from request.url", () => {
    const offenders = routes(join(process.cwd(), "app")).filter((file) =>
      /new URL\([^;]*?,\s*request\.url\s*,?\s*\)/s.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
