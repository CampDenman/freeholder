// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Genuine current service/TCP producer; no positive SQL history or caller FIN.
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import { resetStorageForTests } from "@/adapters/storage";
import { observeStorageOperation, putWithReceipt } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { initializeStorageQuota, storageInventorySha256 } from "@/core/media/storage-quota";
import { advanceStorageTransfer, planStorageTransfer } from "@/core/media/transfer-service";
import { configuredTransferStores } from "@/core/media/transfer-storage";
import { admitTransferCall, retainTransferReturn, transferRuntimeIdentity } from "@/core/media/transfer-callers";
import { withTransferRequestScope } from "@/core/media/transfer-requests";
import { settleTransferQuota } from "@/core/media/transfer-quota";
import { mediaStorageTransferCalls as calls, mediaStorageTransferObjects as objects } from "@/core/media/transfer-schema";
import { runMigrationsOnDedicatedSession } from "@/core/migrate-runner.mjs";
import { mediaTransferProvider } from "../helpers/media-transfer-provider";
import { closeDb, OWNER } from "../helpers/spine";

const output = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_OUTPUT!;
const body = new Uint8Array(Buffer.from("%PDF-1.7\nGenuine quota-role original bytes.\n%%EOF\n"));
const syntheticOrigin = "https://s3.us-east-1.amazonaws.com", realFetch = globalThis.fetch.bind(globalThis);
describe("actual target ACK before outer caller FIN producer", () => {
  let provider: Awaited<ReturnType<typeof mediaTransferProvider>>;
  afterAll(async () => { await provider?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests(); await closeDb(); });
  it("produces real accounted target bytes without retaining the outer return", async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try { await runMigrationsOnDedicatedSession(client, { migrationsFolder: "db/migrations" }); } finally { await client.end(); }
    const tcpState = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_TCP_STATE;
    provider = await mediaTransferProvider(tcpState ? { stateFile: tcpState } : {});
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== syntheticOrigin) return realFetch(input, init);
      const target = new URL(`${url.pathname}${url.search}`, provider.endpoint);
      if (input instanceof Request) return realFetch(target, { method: input.method, headers: input.headers, body: input.body === null ? undefined : await input.arrayBuffer() });
      return realFetch(target, init);
    });
    for (const [name, value] of Object.entries({ NODE_ENV: "test", FREEHOLDER_STORAGE: "s3", S3_ENDPOINT: syntheticOrigin, S3_REGION: "fixture", S3_BUCKET: "source", S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: "synthetic", FREEHOLDER_STORAGE_QUOTA_BYTES: "1048576", FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY: "true", MEDIA_TRANSFER_TARGET_QUOTA_BYTES: "1048576", MEDIA_TRANSFER_TARGET_STORAGE: "s3", MEDIA_TRANSFER_TARGET_S3_ENDPOINT: syntheticOrigin, MEDIA_TRANSFER_TARGET_S3_REGION: "fixture", MEDIA_TRANSFER_TARGET_S3_BUCKET: "target", MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID: "synthetic", MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY: "synthetic" })) vi.stubEnv(name, value);
    resetEnvForTests(); resetStorageForTests(); await ready(); await stopJobs();
    const uploader = { ...OWNER, userId: randomUUID(), role: "customer" as const, grants: [] };
    await db().insert(users).values([{ id: OWNER.userId, email: "quota-owner@example.test", role: "owner" }, { id: uploader.userId, email: "quota-uploader@example.test", role: "customer" }]);
    const contact = await createContact.call({ name: "Original quota subject", email: "quota-uploader@example.test" }, OWNER);
    await db().update(contacts).set({ userId: uploader.userId }).where(eq(contacts.id, contact.id));
    await putWithReceipt({ key: "original/quota-role.pdf", body, contentType: "application/pdf", role: "original" }, uploader);
    const protocol: unknown = await import("../../scripts/media-transfer.mjs");
    const { createS3Store } = protocol as { createS3Store: (environment: Record<string, string>, prefix: string) => { accounted(observer?: never): Awaited<ReturnType<typeof configuredTransferStores>>["target"]; put(key: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>; readVersioned(key: string): Promise<{ body: Uint8Array<ArrayBuffer> } | undefined> } };
    const rawTarget = createS3Store({ TARGET_S3_ENDPOINT: syntheticOrigin, TARGET_S3_REGION: "fixture", TARGET_S3_BUCKET: "target", TARGET_S3_ACCESS_KEY_ID: "synthetic", TARGET_S3_SECRET_ACCESS_KEY: "synthetic", TARGET_S3_ALLOW_LOOPBACK_HTTP: "true" }, "TARGET").accounted();
    await rawTarget.inventoryConfiguration();
    for (const kind of ["objects", "versions", "sessions"] as const) {
      const page = await rawTarget.inventoryPage(kind);
      expect(page.entries).toEqual([]); expect(page.next).toBeNull();
    }
    await initializeStorageQuota(rawTarget.binding.namespace, 1048576, [], storageInventorySha256([]));
    const plan = await planStorageTransfer.call({ requestKey: randomUUID(), confirmation: "COPY ADOPT AND RETIRE ORIGINAL STORAGE" }, OWNER);
    const [object] = await db().select().from(objects).where(eq(objects.planId, plan.id));
    if (!object) throw new Error("The actual transfer object is missing.");
    const stage = process.env.FREEHOLDER_MEDIA_TRANSFER_QUOTA_ROLE_STAGE!;
    let targetCallId: string;
    if (!["ack_before_fin", "not_attempted_target"].includes(stage)) {
      if (stage === "unknown_target") provider.loseNextTargetPutReply();
      const copying = advanceStorageTransfer.call({ id: plan.id, objectId: object.id, action: "copy" }, OWNER);
      if (stage === "unknown_target") await expect(copying).rejects.toThrow(); else await copying;
      if (stage === "adopted_copy" || stage === "retired_source" || stage === "late_original") await advanceStorageTransfer.call({ id: plan.id, action: "adopt" }, OWNER);
      if (stage === "retired_source" || stage === "late_original") await advanceStorageTransfer.call({ id: plan.id, objectId: object.id, action: "retire" }, OWNER);
      const targetCall = (await db().select().from(calls)).find(row => row.objectId === object.id && row.kind === "target_put");
      if (!targetCall) throw new Error("The actual finished target caller is missing.");
      expect(targetCall.state).toBe(stage === "unknown_target" ? "unknown" : "returned");
      expect(targetCall.returnedAt).toBeInstanceOf(Date);
      targetCallId = targetCall.id;
    } else {
      const token = randomUUID() + randomUUID(), runtimeIdentity = await transferRuntimeIdentity();
      const call = await db().transaction(tx => admitTransferCall(tx, { planId: plan.id, objectId: object.id, kind: "target_put", token, runtimeIdentity }, OWNER));
      if (stage === "not_attempted_target") await retainTransferReturn(call.id, token, { notAttempted: true });
      else {
        const { target } = await configuredTransferStores();
        await withTransferRequestScope({ callId: call.id, token, runtimeIdentity, actor: OWNER }, () => target.put(object.targetKey, body, object.contentType));
        await db().transaction(tx => settleTransferQuota(tx, { objectId: object.id, side: "target", callId: call.id }));
      }
      const [targetCall] = await db().select().from(calls).where(eq(calls.id, call.id));
      expect(targetCall).toMatchObject({ state: stage === "not_attempted_target" ? "returned" : "admitted", returnedAt: stage === "not_attempted_target" ? targetCall?.returnedAt : null });
      if (stage === "not_attempted_target") { expect(targetCall?.returnedAt).toBeInstanceOf(Date); expect(targetCall?.observedAcceptedAt).toBeNull(); }
      else expect(targetCall?.observedAcceptedAt).toBeInstanceOf(Date);
      targetCallId = call.id;
    }
    if (stage === "not_attempted_target") expect(provider.objects.has(`/target/${object.targetKey}`)).toBe(false);
    else expect(provider.objects.get(`/target/${object.targetKey}`)?.body).toEqual(body);
    const sourceCall = (await db().select().from(calls)).find(row => row.kind === "ordinary_put");
    if (!sourceCall) throw new Error("The actual original source caller is missing.");
    if (stage === "late_original") {
      const rawSource = createS3Store({ SOURCE_S3_ENDPOINT: syntheticOrigin, SOURCE_S3_REGION: "fixture", SOURCE_S3_BUCKET: "source", SOURCE_S3_ACCESS_KEY_ID: "synthetic", SOURCE_S3_SECRET_ACCESS_KEY: "synthetic", SOURCE_S3_ALLOW_LOOPBACK_HTTP: "true" }, "SOURCE");
      expect(provider.objects.has(`/source/${object.key}`)).toBe(false);
      await rawSource.put(object.key, body, object.contentType);
      const reapplied = await rawSource.readVersioned(object.key);
      expect(reapplied?.body).toEqual(body);
      const [receipt] = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, sourceCall.physicalReceiptId ?? sourceCall.objectReceiptId!));
      if (!receipt?.providerRevision) throw new Error("The actual original provider revision is missing.");
      await observeStorageOperation(receipt.id, true, false, receipt.providerRevision);
    }
    let privacyRequestId: string | undefined;
    if (stage === "privacy_queued") {
      const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: request.id, method: "Synthetic genuine original transfer privacy verification" }, OWNER);
      const applied = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
      const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() })) }).parse(applied.artifact.body);
      const transfer = receipt.outcomes.find(row => row.scope === "media.storageTransfers");
      expect(transfer).toMatchObject({ outcome: "pending" });
      expect(transfer?.pendingJobs?.length).toBeGreaterThan(0);
      privacyRequestId = request.id;
    }
    writeFileSync(output, `${JSON.stringify({ stage, objectId: object.id, sourceCallId: sourceCall.id, targetCallId, subjectContactId: contact.id, ...(privacyRequestId ? { privacyRequestId } : {}) }, null, 2)}\n`, { mode: 0o600 });
  });
});
