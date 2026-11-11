// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { redirects } from "@/core/seo/schema";
import { resolveRedirect } from "@/core/seo/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("unprefixed imported redirects use the business language", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);
  it.each(["es", "fr", "ar"])("resolves %s without changing explicit language requests", async locale => {
    await updateBusiness.call({ name: "Fictional archive", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver", defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }, OWNER);
    await db().insert(redirects).values([
      { fromPath: "legacy/team.html", toPath: "our-team", locale, source: "import" },
      { fromPath: "legacy/team.html", toPath: "english-team", locale: "en", source: "import" },
    ]);
    expect(await resolveRedirect.call({ path: "legacy/team.html" }, ANONYMOUS)).toEqual({ toPath: "our-team", status: "301" });
    expect(await resolveRedirect.call({ path: "legacy/team.html", locale: "en" }, ANONYMOUS)).toEqual({ toPath: "english-team", status: "301" });
    expect(await resolveRedirect.call({ path: "legacy/team.html", locale }, ANONYMOUS)).toEqual({ toPath: "our-team", status: "301" });
  });
});
