// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: audit evidence must not become a raw private-file store.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineService } from "@/core/service";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const sample = defineService({
  name: "tests.privateInputAudit", summary: "Exercise audit metadata without persisting private file input.",
  kind: "mutation", permission: "scoped",
  input: z.object({ id: z.string(), payload: z.string(), credentialToken: z.string() }),
  auditInputFields: ["id", "credentialToken"],
  output: z.object({ length: z.number() }),
  handler: async (input, ctx) => { ctx.setSubject("test_record", input.id); return { length: input.payload.length }; },
});
describe.runIf(hasDatabase)("private service audit input projection", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);
  it("preserves caller/action/subject and global secret redaction while raw NUL input reaches only the handler", async () => {
    const payload = "\0Private binary source fixture";
    expect(await sample.call({ id: "audit-input-fixture", payload, credentialToken: "synthetic-private-token" }, OWNER)).toEqual({ length: payload.length });
    const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, sample.def.name));
    expect(audit).toMatchObject({ actor: `user:${OWNER.userId}`, action: sample.def.name, subjectType: "test_record", subjectId: "audit-input-fixture", diff: { id: "audit-input-fixture", credentialToken: "[redacted]" } });
    expect(audit!.diff).not.toHaveProperty("payload");
  });
});
