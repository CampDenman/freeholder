// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: prove the public identity can edit content but cannot gain authority.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { validateSession } from "@/core/auth/sessions";
import { resetEnvForTests } from "@/core/env";
import { enterPlayground, initializePlayground } from "@/core/demo/playground";
import { playgroundAllows } from "@/core/demo/playground-policy";
import { createPage, updatePage, getPage } from "@/modules/cms/service";
import { createRole } from "@/core/roles/service";
import { requestHostUpdate } from "@/core/update/host";
import { ANONYMOUS, OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

it("requires explicit opt-in for each editing action", () => {
  for (const name of ["cms.testSendEmail", "cms.sendSmsTemplate", "cms.futurePrivilege", "auth.login", "auth.requestMagicLink", "roles.create", "platform.requestHostUpdate", "media.upload", "contacts.fulfillDataRequest"]) {
    expect(playgroundAllows(name, "mutation")).toBe(false);
  }
  expect(playgroundAllows("cms.updatePage", "mutation")).toBe(true);
});

describe.runIf(hasDatabase)("disposable playground", () => {
  beforeEach(async () => {
    await truncateSpine();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  afterAll(closeDb);

  it("does not convert a database containing real accounts", async () => {
    await db().insert(users).values({ email: "owner@example.test", role: "owner" });
    await expect(initializePlayground()).rejects.toThrow("disposable database");
    expect(await db().select().from(users)).toHaveLength(1);
  });

  it("issues only a restricted visitor session and supports a real page edit", async () => {
    await initializePlayground();
    await initializePlayground();
    const issued = await enterPlayground.call({}, ANONYMOUS);
    const session = await db().transaction((tx) => validateSession(tx, issued.token));
    expect(session?.role).toBe("playground");
    expect(session?.security.twoFactorRequired).toBe(false);
    if (!session) throw new Error("No session");
    const actor = { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants };
    const page = await createPage.call({ slug: "visitor-page", title: "Before" }, actor);
    await updatePage.call({ id: page.id, title: "After" }, actor);
    expect((await getPage.call({ id: page.id }, actor))?.title).toBe("After");
    await expect(createRole.call({ name: "Escalation", grants: [{ module: "*", access: "manage" }] }, actor)).rejects.toMatchObject({ code: "permission" });
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "permission" });
    expect((await db().select().from(users)).every((user) => !user.passwordHash)).toBe(true);
  });

  it("refuses entry on ordinary client installations", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await initializePlayground();
    await expect(enterPlayground.call({}, ANONYMOUS)).rejects.toMatchObject({ code: "not_found" });
    expect(await db().select().from(users)).toHaveLength(0);
  });

  it("requires a fresh owner factor before contacting the host", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "step_up_required" });
    await expect(requestHostUpdate.call({}, { kind: "agent", keyName: "test", scopes: ["platform:write"] })).rejects.toMatchObject({ code: "permission" });
  });
});
