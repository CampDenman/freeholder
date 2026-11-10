// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.38: the owner reaches a private intake attachment from its project.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { storage } from "@/adapters/storage";
import { closeDb, db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { assets } from "@/core/media/schema";
import { forms, formSubmissionFiles, formSubmissions } from "@/modules/forms/schema";
import { projectLinks, projects } from "@/modules/projects/schema";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("a private intake file downloads from the project and stays private", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useOwnerSession(context, await seedC11Owner("Intake file qualification"));
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 4, true);
  const key = `tests/intake/${randomUUID()}.wav`;
  await storage().put(key, bytes, "audio/wav");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Intake customer", email: "intake@example.test" }).returning();
    const [form] = await db().insert(forms).values({ slug: "episode-intake", name: "Episode intake", fields: [] }).returning();
    const [asset] = await db().insert(assets).values({
      kind: "audio", storageKey: key, filename: "episode-owner.wav", mime: "audio/wav",
      legacyBytes: bytes.length, bytes: bytes.length, isPrivate: true, provenance: { purpose: "form" },
    }).returning();
    const [submission] = await db().insert(formSubmissions).values({
      formId: form!.id, contactId: contact!.id, data: { episode: { assetId: asset!.id } },
    }).returning();
    const [attachment] = await db().insert(formSubmissionFiles).values({
      submissionId: submission!.id, fieldKey: "episode", assetId: asset!.id,
    }).returning();
    const [project] = await db().insert(projects).values({
      title: "Edit the episode", slug: "edit-the-episode", contactId: contact!.id,
    }).returning();
    await db().insert(projectLinks).values({
      projectId: project!.id, kind: "form_submission", targetId: submission!.id, label: "Episode intake",
    });
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await page.goto(`/admin/projects/${project!.id}`);
      const link = page.getByRole("link", { name: "episode-owner.wav", exact: true });
      await expect(link).toHaveAttribute("href", `/admin/forms/files/${attachment!.id}`);
      await link.focus();
      await expect(link).toBeFocused();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
    const download = await page.request.get(`/admin/forms/files/${attachment!.id}`);
    expect(download.status()).toBe(200);
    expect(download.headers()["cache-control"]).toContain("no-store");
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    expect(new Uint8Array(await download.body())).toEqual(bytes);
    const visitor = await context.browser()!.newContext({ baseURL: C11_BASE_URL });
    try {
      expect((await visitor.request.get(`/admin/forms/files/${attachment!.id}`)).status()).toBe(404);
      expect((await visitor.request.get(`/media/${key}`)).status()).toBe(404);
    } finally {
      await visitor.close();
    }
    await db().update(assets).set({ status: "quarantined" }).where(eq(assets.id, asset!.id));
    await page.reload();
    await expect(page.getByRole("link", { name: "episode-owner.wav", exact: true })).toHaveCount(0);
    expect((await page.request.get(`/admin/forms/files/${attachment!.id}`)).status()).toBe(404);
  } finally {
    await storage().delete(key);
  }
});

test.afterAll(async () => { await resetBrowserDatabase(); await closeDb(); });
