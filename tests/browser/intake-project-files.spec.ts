// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.38: the owner reaches a private intake attachment from its project.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { createLocalStorage } from "@/adapters/storage/local";
import { closeDb, db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { CSRF_COOKIE, CSRF_HEADER } from "@/core/http/csrf";
import { assets } from "@/core/media/schema";
import { forms, formSubmissionFiles, formSubmissions } from "@/modules/forms/schema";
import { projectLinks, projects } from "@/modules/projects/schema";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("a private intake file downloads from the project and stays private", async ({ page, context }) => {
  test.setTimeout(120_000);
  const ownerToken = await seedC11Owner("Intake file qualification");
  await useOwnerSession(context, ownerToken);
  await page.request.get("/api/auth/session");
  const csrf = (await context.cookies()).find(cookie => cookie.name === CSRF_COOKIE)?.value;
  expect(csrf).toBeTruthy();
  const apiHeaders = { authorization: `Bearer ${ownerToken}`, [CSRF_HEADER]: csrf! };
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
  let key: string | undefined;
  try {
    const reserved = await page.request.post("/api/media/uploads", {
      headers: apiHeaders,
      data: {
        filename: "episode-owner.wav", contentType: "audio/wav", bytes: bytes.byteLength,
        provenance: { purpose: "form" }, metadata: {},
      },
    });
    expect(reserved.status()).toBe(200);
    const reservation = await reserved.json() as { id: string };
    const uploaded = await page.request.post("/api/media", {
      headers: apiHeaders,
      multipart: {
        uploadId: reservation.id,
        file: { name: "episode-owner.wav", mimeType: "audio/wav", buffer: Buffer.from(bytes) },
      },
    });
    expect(uploaded.status()).toBe(200);
    const asset = await uploaded.json() as { id: string; storageKey: string };
    key = asset.storageKey;
    const [contact] = await db().insert(contacts).values({ name: "Intake customer", email: "intake@example.test" }).returning();
    const [form] = await db().insert(forms).values({ slug: "episode-intake", name: "Episode intake", fields: [] }).returning();
    const [submission] = await db().insert(formSubmissions).values({
      formId: form!.id, contactId: contact!.id, data: { episode: { assetId: asset.id } },
    }).returning();
    const [attachment] = await db().insert(formSubmissionFiles).values({
      submissionId: submission!.id, fieldKey: "episode", assetId: asset.id,
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
    await db().update(assets).set({ status: "quarantined" }).where(eq(assets.id, asset.id));
    await page.reload();
    await expect(page.getByRole("link", { name: "episode-owner.wav", exact: true })).toHaveCount(0);
    expect((await page.request.get(`/admin/forms/files/${attachment!.id}`)).status()).toBe(404);
  } finally {
    if (key) await createLocalStorage({ root: process.env.LOCAL_STORAGE_ROOT!, publicPath: "/media" }).delete(key);
  }
});

test.afterAll(async () => { await resetBrowserDatabase(); await closeDb(); });
