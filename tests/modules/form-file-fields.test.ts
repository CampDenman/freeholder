// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.38: file questions in forms. The file goes through the media upload
// pipeline as the signed-in submitter's private form upload; `forms.submit`
// attaches it only when it is theirs, of a sniffed kind the question accepts,
// within its limit and not attached elsewhere. The owner opens it from the
// submission; nobody else can, and it is in the contact's data export.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import {
  authorizeObjectDelivery,
  resolveAsset,
  uploadAsset,
} from "@/core/media/service";
import { contactPrivacySources } from "@/core/privacy/service";
import { formSubmissionFiles, formSubmissions } from "@/modules/forms/schema";
import {
  createForm,
  listSubmissionFiles,
  openSubmissionFile,
  submitForm,
} from "@/modules/forms/service";
import { fieldsSchema, fileFieldMaxBytes, type FormField } from "@/modules/forms/fields";
import { issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const MB = 1024 * 1024;

describe("file field definitions (C3.38)", () => {
  const parse = (field: Record<string, unknown>) =>
    fieldsSchema.safeParse([{ key: "episode", label: "Episode", kind: "file", ...field }]);

  it("accepts one kind or a list of kinds within the media limit", () => {
    expect(parse({ accept: "audio", maxMb: 500 }).success).toBe(true);
    expect(parse({ accept: ["doc", "image"], maxMb: 25 }).success).toBe(true);
    expect(parse({ accept: "doc", required: true }).success).toBe(true);
  });

  it("refuses a file field without accepted kinds, with video, or over the limit", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ accept: [] }).success).toBe(false);
    expect(parse({ accept: "video" }).success).toBe(false);
    expect(parse({ accept: "audio", maxMb: 501 }).success).toBe(false);
    // A list takes the tightest limit among its kinds: image is 25 MB.
    const mixed = parse({ accept: ["audio", "image"], maxMb: 100 });
    expect(mixed.success).toBe(false);
    expect(JSON.stringify(mixed.error?.issues)).toContain("at most 25 MB");
    expect(parse({ accept: "audio", maxMb: 0 }).success).toBe(false);
  });

  it("refuses file settings on a field that is not a file", () => {
    const result = fieldsSchema.safeParse([
      { key: "name", label: "Name", kind: "text", accept: "audio" },
    ]);
    expect(result.success).toBe(false);
  });

  it("defaults the size limit to the media ceiling", () => {
    expect(fileFieldMaxBytes({ accept: "audio" })).toBe(500 * MB);
    expect(fileFieldMaxBytes({ accept: ["doc", "audio"] })).toBe(100 * MB);
    expect(fileFieldMaxBytes({ accept: "audio", maxMb: 2 })).toBe(2 * MB);
  });
});

/** A valid WAV of about `bytes` bytes: sniffed as audio whatever it is called. */
function wav(bytes = 4096): Uint8Array {
  const body = new Uint8Array(bytes);
  const view = new DataView(body.buffer);
  body.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes - 8, true);
  body.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  body.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, bytes - 44, true);
  return body;
}

async function upload(
  actor: typeof RAE,
  file: { filename: string; contentType: string; bytes: Uint8Array },
  purpose: "form" | null = "form",
) {
  return uploadAsset.call(
    { ...file, provenance: purpose ? { purpose } : {} },
    actor,
  );
}

const episode = (actor: typeof RAE, bytes = 4096) =>
  upload(actor, { filename: "episode-12.wav", contentType: "audio/wav", bytes: wav(bytes) });

const FIELDS: FormField[] = [
  { key: "email", label: "Email", kind: "email", required: true },
  { key: "episode", label: "Episode audio", kind: "file", accept: "audio", maxMb: 1, required: true },
];

const answers = (over: Record<string, unknown> = {}) => ({
  email: "rae@example.test",
  [STAMP_FIELD]: issueStamp(new Date(Date.now() - 30_000)),
  ...over,
});

describe.runIf(hasDatabase)("file answers in forms.submit (C3.38)", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await createForm.call(
      { slug: "show-notes", name: "Show notes intake", fields: FIELDS },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("keeps a form upload private from the moment it exists", async () => {
    const asset = await episode(RAE);
    const [stored] = await db().select().from(assets).where(eq(assets.id, asset.id));
    expect(stored!.isPrivate).toBe(true);
    expect(stored!.kind).toBe("audio");
    expect(await authorizeObjectDelivery.call({ key: stored!.storageKey }, ANONYMOUS)).toBeNull();
    expect(await resolveAsset.call({ id: asset.id }, ANONYMOUS)).toBeNull();
    expect(await resolveAsset.call({ id: asset.id }, RAE)).toBeNull();
  });

  it("attaches the submitter's own upload and stores its facts, never a URL", async () => {
    const asset = await episode(RAE);
    const sent = await submitForm.call(
      { slug: "show-notes", values: answers({ episode: asset.id }) },
      RAE,
    );
    const [submission] = await db()
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, sent.submissionId));
    expect(submission!.status).toBe("received");
    expect((submission!.data as Record<string, unknown>).episode).toEqual({
      assetId: asset.id,
      filename: "episode-12.wav",
      bytes: 4096,
      mime: "audio/wav",
    });
    expect(JSON.stringify(submission!.data)).not.toContain("/media/");
    const links = await db()
      .select()
      .from(formSubmissionFiles)
      .where(eq(formSubmissionFiles.submissionId, sent.submissionId));
    expect(links.map((link) => [link.fieldKey, link.assetId])).toEqual([["episode", asset.id]]);
  });

  it("refuses a file whose sniffed kind the question does not accept", async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .png()
        .toBuffer(),
    );
    // Named as audio, but the bytes are a PNG: the upload's sniffing refuses it.
    const disguised = await failure(
      upload(RAE, { filename: "episode.wav", contentType: "audio/wav", bytes: png }),
    );
    expect(disguised.code).toBe("validation");
    // An honest image uploads, and the audio question refuses it by kind.
    const image = await upload(RAE, { filename: "cover.png", contentType: "image/png", bytes: png });
    const refused = await failure(
      submitForm.call({ slug: "show-notes", values: answers({ episode: image.id }) }, RAE),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toBe(
      "Episode audio must be an audio file; that file is an image.",
    );
  });

  it("refuses a file over the question's limit", async () => {
    const big = await episode(RAE, Math.floor(1.5 * MB));
    const refused = await failure(
      submitForm.call({ slug: "show-notes", values: answers({ episode: big.id }) }, RAE),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toBe(
      "Episode audio must be 1 MB or smaller; that file is 2 MB.",
    );
  });

  it("asks an anonymous visitor to sign in, with or without a file", async () => {
    const asset = await episode(RAE);
    const withFile = await failure(
      submitForm.call({ slug: "show-notes", values: answers({ episode: asset.id }) }, ANONYMOUS),
    );
    expect(withFile.code).toBe("permission");
    expect(withFile.message).toBe("Sign in to upload a file with this form.");
    const withoutFile = await failure(
      submitForm.call({ slug: "show-notes", values: answers() }, ANONYMOUS),
    );
    expect(withoutFile.code).toBe("permission");
    // And the upload API refuses an anonymous upload outright.
    expect(
      (await failure(upload(ANONYMOUS as typeof RAE, { filename: "a.wav", contentType: "audio/wav", bytes: wav() })))
        .code,
    ).toBe("permission");
    expect(await db().select().from(formSubmissions)).toHaveLength(0);
  });

  it("refuses another person's upload, a library upload, and reuse", async () => {
    const theirs = await episode(SAM);
    const notMine = await failure(
      submitForm.call({ slug: "show-notes", values: answers({ episode: theirs.id }) }, RAE),
    );
    expect(notMine.code).toBe("validation");
    expect(notMine.message).toContain("not yours to attach");

    const library = await upload(
      RAE,
      { filename: "library.wav", contentType: "audio/wav", bytes: wav() },
      null,
    );
    expect(
      (await failure(
        submitForm.call({ slug: "show-notes", values: answers({ episode: library.id }) }, RAE),
      )).message,
    ).toContain("not yours to attach");

    const mine = await episode(RAE);
    await submitForm.call({ slug: "show-notes", values: answers({ episode: mine.id }) }, RAE);
    const again = await failure(
      submitForm.call({ slug: "show-notes", values: answers({ episode: mine.id }) }, RAE),
    );
    expect(again.code).toBe("conflict");
    expect(await db().select().from(formSubmissionFiles)).toHaveLength(1);
  });

  it("lets the owner open the file from the submission and nobody else", async () => {
    const asset = await episode(RAE);
    const sent = await submitForm.call(
      { slug: "show-notes", values: answers({ episode: asset.id }) },
      RAE,
    );
    const [link] = await listSubmissionFiles.call({ submissionIds: [sent.submissionId] }, OWNER);
    expect(link).toMatchObject({ fieldKey: "episode", assetId: asset.id });
    const opened = await openSubmissionFile.call({ id: link!.id }, OWNER);
    expect(opened).toMatchObject({ filename: "episode-12.wav", mime: "audio/wav", bytes: 4096 });

    expect((await failure(openSubmissionFile.call({ id: link!.id }, ANONYMOUS))).code).toBe("permission");
    expect((await failure(openSubmissionFile.call({ id: link!.id }, RAE))).code).toBe("permission");
    expect((await failure(listSubmissionFiles.call({ submissionIds: [sent.submissionId] }, RAE))).code)
      .toBe("permission");
    expect(await authorizeObjectDelivery.call({ key: opened!.storageKey }, ANONYMOUS)).toBeNull();
  });

  it("puts the file in the contact's export and removes it on erasure", async () => {
    const asset = await episode(RAE);
    const sent = await submitForm.call(
      { slug: "show-notes", values: answers({ episode: asset.id }) },
      RAE,
    );
    const [submission] = await db()
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, sent.submissionId));
    const contactId = submission!.contactId!;
    expect(contactId).toBeTruthy();
    const source = contactPrivacySources().find((one) => one.scope === "forms.submissions")!;
    expect(source.tables).toContain("form_submission_files");

    const exported = (await db().transaction((tx) => source.exportData(tx, contactId))) as {
      submissions: Array<{ data: Record<string, unknown> }>;
      files: Array<Record<string, unknown>>;
    };
    expect(exported.submissions[0]!.data.episode).toMatchObject({ assetId: asset.id });
    expect(exported.files).toEqual([
      expect.objectContaining({
        submissionId: sent.submissionId,
        fieldKey: "episode",
        assetId: asset.id,
        filename: "episode-12.wav",
        mime: "audio/wav",
        bytes: 4096,
      }),
    ]);

    await db().transaction((tx) => source.erase(tx, contactId, { requestId: "test" }));
    const [erased] = await db().select().from(assets).where(eq(assets.id, asset.id));
    expect(erased!.status).toBe("trashed");
    expect(erased!.purgeAfter).not.toBeNull();
    expect(await db().select().from(formSubmissionFiles)).toHaveLength(0);
    const [blank] = await db()
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, sent.submissionId));
    expect(blank!.data).toEqual({});
  });
});
