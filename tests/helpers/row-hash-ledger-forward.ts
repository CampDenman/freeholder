// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

const continuationSchema = z.object({
  path: z.string(), afterSha256: z.string(), beforeSha256: z.string(), continue: z.boolean().default(false),
  edits: z.array(z.object({ before: z.string(), after: z.string(), occurrences: z.number().int().positive() }).strict()),
}).strict();
const recordSchema = z.object({
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()).default([]),
  testContinuations: z.array(continuationSchema).default([]),
  files: z.array(z.object({ path: z.string(), afterSha256: z.string(), beforeSha256: z.string(), edits: z.array(z.object({ before: z.string(), after: z.string() }).strict()) }).strict()).default([]),
}).passthrough();
const records = ["controlled-row-hash-ledger88.source.json", "financial-row-hash-ledger89.source.json", "controlled-safe-view-digest89.source.json", "controlled-journal-heads90.source.json", "controlled-view-cache90.source.json", "controlled-composition-clone90.source.json", "atomic-credit-source-fee90.source.json", "atomic-credit-evidence-reuse90.source.json", "controlled-preview-basis91.source.json", "blog-author-closure28.source.json", "blog-taxonomy-closure27.source.json", "blog-comments-closure29.source.json", "form-lead-destination34.source.json", "private-preview-credential35.source.json", "preview-mail-delivery36.source.json", "media-rendition-recovery-lock.source.json", "import-transport-acceptance47.source.json", "storage-quota-scoped-fixture.source.json", "original-put-recovery-lifecycle.source.json", "original-provider-privacy-lifecycle.source.json", "original-retirement-lifecycle.source.json", "original-applied-retirement-lifecycle.source.json", "monotonic-delete-lifecycle.source.json", "finished-delete-recovery-lifecycle.source.json", "original-first-capture-lifecycle.source.json", "multipart-create-birth-lifecycle.source.json", "multipart-session-fact-ledger.source.json", "multipart-part-issuance-lifecycle.source.json", "multipart-known-create-lifecycle.source.json", "multipart-part-verification-lifecycle.source.json", "multipart-readback-lifecycle.source.json", "multipart-part-manifest-lifecycle.source.json", "multipart-part-withheld-lifecycle.source.json", "multipart-applied-recovery-lifecycle.source.json", "multipart-abort-recovery-lifecycle.source.json", "multipart-repeat-abort-lifecycle.source.json", "multipart-retirement-certificate-lifecycle.source.json", "multipart-idle-compaction-lifecycle.source.json", "multipart-retirement-catchup-lifecycle.source.json", "multipart-idle-retirement-lifecycle.source.json", "media-transfer-read-provenance-lifecycle.source.json", "media-chained-transfer-lifecycle.source.json", "media-target-put-review-lifecycle.source.json", "media-transfer-drain-association-lifecycle.source.json", "media-original-namespace-fence-lifecycle.source.json", "media-transfer-controller-fence-lifecycle.source.json", "media-storage-transfer-lifecycle.source.json", "media-transfer-unadmitted-target.source.json", "media-multipart-complete-wire.source.json", "media-multipart-part-capability-wire.source.json", "media-multipart-part-verification-wire.source.json", "media-multipart-readback-wire.source.json", "media-completed-stream-wire.source.json", "media-original-metadata-wire.source.json", "media-multipart-part-disposition.source.json", "media-multipart-complete-manifest.source.json", "media-multipart-part-bodies-proof.source.json", "media-multipart-create-baseline-proof.source.json", "media-multipart-known-create-proof.source.json", "media-multipart-abort-recovery-proof.source.json", "media-multipart-idle-retirement-proof.source.json", "media-multipart-complete-recovery-proof.source.json", "media-multipart-retained-identity-proof.source.json", "media-multipart-retirement-certificate-proof.source.json", "media-multipart-retirement-job-contract.source.json", "media-original-applied-review-proof.source.json", "media-target-put-review-proof.source.json", "media-monotonic-delete-local-closure.source.json", "media-original-retirement-proof.source.json", "media-original-request-recovery-proof.source.json", "media-original-recovery-quota.source.json", "media-original-quota-late-fact-proof.source.json", "media-managed-producers-lifecycle.source.json", "media-upload-reservation-lifecycle.source.json", "media-empty-first-scope-lifecycle.source.json", "media-empty-first-scope-current.source.json", "media-pure-proof-qualification.source.json", "media-part-signing-authority-lifecycle.source.json", "media-part-signing-current108.source.json", "media-part-consumption-current108.source.json", "media-terminal-recovery-current108.source.json", "media-retirement-certificate-current108.source.json", "media-idle-minimization-current108.source.json", "media-namespace-origin-admission.source.json", "media-adapter-completed-drain-proof.source.json", "media-stored-part-readback.source.json", "media-current-resumable-lifecycle.source.json", "media-current-complete-current108.source.json", "media-raster-guard-lifecycle.source.json", "media-capture-erasure-lifecycle.source.json", "media-watermark-backfill-lifecycle.source.json", "media-multipart-receipts-current.source.json", "media-historical-control-routing.source.json", "media-write-ownership-lifecycle.source.json", "media-late-erasure-lifecycle.source.json", "media-write-late-erasure-current108.source.json", "integrated-fast-gates-20261116.source.json", "production-build-20261116.source.json", "package-artifacts-20261116.source.json", "local-release-smoke-20261116.source.json", "source-continuity-current108-20261116.source.json", "full-local-browser-20261116.source.json", "next-security-performance-20261116.source.json", "intake-files-current-browser.source.json", "media-storage-recovery-browser-current.source.json", "media-consent-browser-current.source.json", "editor-media-browser-current.source.json", "import-hosted-media-browser-current.source.json", "subscription-current-period-billing.source.json", "catalog-fulfillment-current-protocol.source.json", "media-transfer-preview-history.source.json", "media-legacy-upload-unknown-producer.source.json", "media-legacy-upload-retired-reachability.source.json", "media-legacy-upload-unrecoverable-pending.source.json", "media-transfer-quota-ack-producer.source.json", "media-transfer-quota-verified-copy.source.json", "media-transfer-quota-source-retirement.source.json", "media-transfer-privacy-scope-reachability.source.json", "media-transfer-privacy-descendant-recovery.source.json", "media-transfer-quota-unknown-target.source.json", "media-transfer-quota-unattempted-target.source.json", "media-transfer-quota-late-original.source.json", "browser-failure-repairs-20261116.source.json", "master-status-continuation-20261117.source.json",
  "wordpress-atom-parser-continuation-20261120.source.json",
  "rc1-package-version-continuation-20261120.source.json"]
  .map(record => recordSchema.parse(JSON.parse(readFileSync(new URL(`../../deploy/${record}`, import.meta.url), "utf8"))));
const continuations = records.flatMap(record => record.testContinuations);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const artifact = (recordOrPath: string, continuationPath?: string) => {
  const path = continuationPath ?? recordOrPath;
  const exact = records.flatMap(record => record.artifacts).find(row => row.path === path);
  assert.ok(exact, `Require the exact row-hash artifact for ${path}`);
  return exact.sha256;
};

export function restoreRowHashLedgerSource(path: string, source: string, stopAtSha256?: string): string {
  const continuation = continuations.find(row => row.path === path && row.afterSha256 === sha(source));
  if (continuation) {
    for (const edit of [...continuation.edits].reverse()) {
      assert.equal(source.split(edit.after).length, edit.occurrences + 1, `${path} ${sha(source)}: ${edit.after.slice(0, 120)}`);
      source = source.replaceAll(edit.after, () => edit.before);
    }
    assert.equal(sha(source), continuation.beforeSha256);
    if (sha(source) === stopAtSha256) return source;
    return continuation.continue ? restoreRowHashLedgerSource(path, source, stopAtSha256) : source;
  }
  if (path === "src/modules/subscriptions/controlled-provider-schema.ts" && sha(source) === "66d26c8ac7710436917d8f4a03e396da044e01a73907cd627243c2133527a312") {
    const restored = source
      .replace('rowId:uuid("row_id").notNull(),resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),rowSha256:', 'rowId:uuid("row_id").notNull(),rowSha256:')
      .replace(',index("subscription_controlled_row_hashes_resource").on(t.resourceId)', '')
      .replace(/\n\nexport const subscriptionControlledJournalHeads=[\s\S]*$/, "\n");
    assert.equal(sha(restored), "95141d6aed8df1b55bb2cd3f741f7b8bf33a9bf89feeab65e687ee651231dfb5");
    return restoreRowHashLedgerSource(path, restored);
  }
  if (path === "src/modules/subscriptions/controlled-provider-proof.ts" && sha(source) === "68b99204d00e47e252fe9735784445c874e10c4276fc50ab8d8f4ddcb343b8f7") {
    const exact = z.object({ readerContinuation: z.object({ beforeFragmentPath: z.string(), beforeFragmentSha256: z.string() }).passthrough() }).passthrough()
      .parse(JSON.parse(readFileSync(new URL("../../deploy/controlled-journal-heads90.source.json", import.meta.url), "utf8"))).readerContinuation;
    const file = readFileSync(new URL(`../../${exact.beforeFragmentPath}`, import.meta.url), "utf8");
    const fragment = file.slice(file.indexOf("async function readJournalContent"));
    assert.equal(sha(fragment), exact.beforeFragmentSha256);
    const start = source.indexOf("async function readJournalContent"), end = source.indexOf("\nfunction decodeJournalInventory", start);
    assert.ok(start >= 0 && end > start);
    const restored = `${source.slice(0, start)}${fragment}${source.slice(end + 1)}`;
    assert.equal(sha(restored), "4c5862f5e66a308afb4776c84ecf379d8dae36d8c19c587c82aba34b87a81df5");
    return restoreRowHashLedgerSource(path, restored);
  }
  if (path === "src/modules/subscriptions/controlled-provider-schema.ts") {
    assert.equal(sha(source), artifact(path));
    const restored = source
      .replace('import { bigint, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";', 'import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";')
      .replace(/\n\nexport const subscriptionControlledRowHashes=[\s\S]*$/, "\n");
    assert.equal(sha(restored), "3abf1444b78e6a608a4dfa7caef36f696190e1c0b3df090a11c8181587c9a830");
    return restored;
  }
  if (path === "src/modules/subscriptions/controlled-provider-proof.ts") {
    assert.equal(sha(source), artifact("controlled-row-hash-ledger88.source.json", path));
    let count = 0;
    const restored = source.replace(/h\.row_sha256( AS fingerprint)?,h\.row_bytes( AS bytes)? FROM (actual_[a-z]+) ([a-z]) JOIN subscription_controlled_row_hashes h ON h\.table_name='subscription_controlled_[a-z_]+' AND h\.row_id=\4\.[a-z_]+/g,
      (_match, fingerprint: string | undefined, bytes: string | undefined, actual: string, alias: string) => {
        count++;
        return `encode(sha256(convert_to(to_jsonb(${alias})::text,'UTF8')),'hex')${fingerprint ?? ""},octet_length(to_jsonb(${alias})::text)::bigint${bytes ?? ""} FROM ${actual} ${alias}`;
      });
    assert.equal(count, 9);
    assert.equal(sha(restored), "016c3b15d37e18958880749d2d901770bd99ee2b06f42a8e8f3e17610174309f");
    return restored;
  }
  if (path === "src/modules/invoicing/controlled-provider-financial-parent.ts") {
    assert.equal(sha(source), artifact("financial-row-hash-ledger89.source.json", path));
    let count = 0;
    const restored = source.replace(/freeholder_financial_row_fingerprint\('([^']+)',([a-z]+)\.[a-z_]+\)/g,
      (_match, table: string, alias: string) => {
        count++;
        const content = table === "subscription_provider_schedule_resources" ? `(to_jsonb(${alias})-'updated_at')` : `to_jsonb(${alias})`;
        return `encode(sha256(convert_to(${content}::text,'UTF8')),'hex')`;
      });
    assert.equal(count, 42);
    assert.equal(sha(restored), "f9cd1b929611733de28c2c2818a53a10a1c067af3e6182075b5edf472067a3c8");
    return restored;
  }
  return source;
}
