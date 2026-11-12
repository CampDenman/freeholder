// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: the legacy API must not bypass shared trash, purge or subject holds.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { demoRecords } from "@/core/demo/schema";
import { getExternalService, listExternalServices } from "@/core/service";
import { loadDemoScenario, purgeDemoScenario } from "@/core/demo/service";
import { createDataRequest, addRetentionException } from "@/core/privacy/service";
import { issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import { forms, formSubmissions } from "@/modules/forms/schema";
import { createForm, deleteForm, removeForm, restoreForm, submitForm, updateForm, purgeDemoForms } from "@/modules/forms/service";
import { ANONYMOUS, OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const DELETE_KEY = { kind: "agent" as const, keyName: "fictional-forms-delete-only", scopes: ["forms.delete"] };
const fields = [{ key: "email", label: "Email", kind: "email" as const, required: true }];
const values = (extra: Record<string, unknown> = {}) => ({ email: "original-form-sender@example.test", name: "Fictional original sender", message: "Fictional original enquiry evidence", [STAMP_FIELD]: issueStamp(new Date(Date.now() - 30_000)), ...extra });
async function hold(formId: string) {
  const [submission] = await db().select().from(formSubmissions).where(eq(formSubmissions.formId, formId));
  const request = await createDataRequest.call({ contactId: submission!.contactId!, request: { kind: "erasure" } }, HUMAN);
  await addRetentionException.call({ dataRequestId: request.id, scope: "forms.submissions", reason: "legal_obligation", legalBasis: "Fictional independently documented hold protects the original enquiry evidence." }, HUMAN);
}
describe.runIf(hasDatabase)("legacy form deletion recovery and retention", () => {
  beforeEach(async () => { await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }); });
  afterAll(closeDb);
  it("keeps held original evidence recoverable through an exact legacy-delete key", async () => {
    const form = await createForm.call({ slug: "legacy-delete-held", name: "Fictional original form", fields }, HUMAN);
    const original = await submitForm.call({ slug: form.slug, values: values() }, ANONYMOUS);
    await hold(form.id);
    expect(await deleteForm.call({ id: form.id }, DELETE_KEY)).toEqual({ id: form.id, slug: form.slug });
    const [trashed] = await db().select().from(forms).where(eq(forms.id, form.id)); expect(trashed?.trashedAt).toBeInstanceOf(Date);
    const [submission] = await db().select().from(formSubmissions).where(eq(formSubmissions.id, original.submissionId)); expect(submission?.data).toMatchObject({ email: "original-form-sender@example.test" });
    expect((await restoreForm.call({ id: form.id }, HUMAN)).id).toBe(form.id);
    await expect(deleteForm.call({ id: form.id }, { ...DELETE_KEY, scopes: ["forms.list"] })).rejects.toMatchObject({ code: "permission" });
    expect((await db().select().from(forms).where(eq(forms.id, form.id)))[0]!.trashedAt).toBeNull();
  });
  it("never turns already trashed held evidence into an unconfirmed permanent deletion", async () => {
    const form = await createForm.call({ slug: "legacy-delete-trash", name: "Fictional original form", fields }, HUMAN);
    await submitForm.call({ slug: form.slug, values: values() }, ANONYMOUS); await hold(form.id); await removeForm.call({ id: form.id }, HUMAN);
    const [original] = await db().select().from(forms).where(eq(forms.id, form.id));
    expect(await deleteForm.call({ id: form.id }, DELETE_KEY)).toEqual({ id: form.id, slug: form.slug });
    const [retained] = await db().select().from(forms).where(eq(forms.id, form.id)); expect(retained?.trashedAt).toEqual(original!.trashedAt);
    expect(await db().select().from(formSubmissions).where(eq(formSubmissions.formId, form.id))).toHaveLength(1);
  });
  it("refuses tracked-demo cleanup when it would cascade over held submissions", async () => {
    await loadDemoScenario.call({ key: "seed.current-modules", locale: "en" }, HUMAN);
    const [form] = await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry")); expect(form).toBeTruthy();
    await updateForm.call({ id: form!.id, destination: "contact" }, HUMAN);
    await submitForm.call({ slug: form!.slug, values: values() }, ANONYMOUS); await hold(form!.id);
    await expect(purgeDemoScenario.call({}, HUMAN)).rejects.toThrow();
    expect(await db().select().from(forms).where(eq(forms.id, form!.id))).toHaveLength(1);
    expect(await db().select().from(formSubmissions).where(eq(formSubmissions.formId, form!.id))).toHaveLength(1);
  });
  it("still purges an unheld tracked demo through its approved cleanup workflow", async () => {
    await loadDemoScenario.call({ key: "seed.current-modules", locale: "en" }, HUMAN);
    expect((await purgeDemoScenario.call({}, HUMAN)).action).toBe("purged");
    expect(await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry"))).toHaveLength(0);
  });
  it("keeps fixture purge internal while the approved workflow retains its exact provenance", async () => {
    const loaded = await loadDemoScenario.call({ key: "seed.current-modules", locale: "en" }, HUMAN);
    const records = (await db().select().from(demoRecords).where(eq(demoRecords.runId, loaded.run.id))).filter(record => record.contributionKey === "forms.current-modules").map(({ fixtureKey, subjectType, subjectId, label }) => ({ fixtureKey, subjectType, subjectId, label }));
    const input = { runId: loaded.run.id, scenarioKey: loaded.run.scenarioKey, scenarioVersion: loaded.run.scenarioVersion, generation: loaded.run.generation, locale: loaded.run.locale, records };
    for (const actor of [HUMAN, { ...DELETE_KEY, scopes: ["forms.purgeDemoFixture"] }, { kind: "plugin" as const, name: "fictional", grants: HUMAN.grants }]) await expect(purgeDemoForms.call(input, actor)).rejects.toMatchObject({ code: "permission" });
    expect(listExternalServices().has("forms.purgeDemoFixture")).toBe(false);
    expect(() => getExternalService("forms.purgeDemoFixture")).toThrow();
    expect(await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry"))).toHaveLength(1);
    expect((await purgeDemoScenario.call({}, HUMAN)).action).toBe("purged");
  });

});
