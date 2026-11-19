// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ask an S3-compatible provider the four questions Freeholder's recorded-write
// path actually depends on, using Freeholder's own protocol and signer.
//
// WHY THIS EXISTS
// ---------------
// "S3-compatible" is a claim, not a guarantee. Measured 2026-11-18 against
// three stores run locally: adobe/s3mock answers `?versions` with HTTP 200 and
// a ListBucketResult, which reads as "no versions exist"; LocalStack refuses a
// conditional delete with 501; and SeaweedFS 3.99 accepted a DELETE carrying a
// deliberately wrong if-match, returned 204, and DESTROYED THE OBJECT. All
// three are maintained and S3-compatible by reputation.
//
// So before trusting a provider with original media, ask it directly. Run this
// against a bucket you are willing to have one probe key written to and
// deleted from:
//
//   PROBE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
//   PROBE_S3_REGION=auto \
//   PROBE_S3_BUCKET=<a disposable bucket> \
//   PROBE_S3_ACCESS_KEY_ID=... PROBE_S3_SECRET_ACCESS_KEY=... \
//   node scripts/s3-provider-probe.mjs
//
// It writes one object under __freeholder_conditional_probe__/ and removes it.
// It never prints a credential, a key or a response body.
import { AwsClient } from "aws4fetch";
import { createS3TransferProtocol, proveS3ConditionalSemantics } from "./media-transfer-protocol.mjs";

const need = (name) => {
  const value = process.env[name];
  if (!value) { console.error(`Set ${name}.`); process.exit(2); }
  return value;
};
const endpoint = need("PROBE_S3_ENDPOINT");
const bucket = need("PROBE_S3_BUCKET");
const region = process.env.PROBE_S3_REGION ?? "us-east-1";
const style = process.env.PROBE_S3_ADDRESSING_STYLE ?? "path";
const client = new AwsClient({
  accessKeyId: need("PROBE_S3_ACCESS_KEY_ID"),
  secretAccessKey: need("PROBE_S3_SECRET_ACCESS_KEY"),
  region, service: "s3", retries: 0,
});
const origin = endpoint.replace(/\/+$/, "");
const url = (key) => {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return style === "virtual"
    ? `${origin.replace("://", `://${bucket}.`)}/${path}`
    : `${origin}/${bucket}/${path}`;
};
// Declared proven and versioned so the protocol does not refuse before the
// provider has been asked; this probe reports what the provider does, it does
// not grant authority to anything.
const protocol = createS3TransferProtocol({
  client, url,
  binding: { kind: "s3", namespace: "0".repeat(64), location: { endpoint: origin, bucket } },
  authority: { conditional: "proven", versioning: "enabled" },
});

const report = [];
// `required` separates a safety floor from a capability. Only the conditional
// write semantics are required: a store that accepts `if-none-match: *` or
// `if-match` and ignores it reports success for a write that landed on a live
// key, or deletes an object it was told to leave alone. Everything else is
// reported so an operator knows what evidence this provider can supply.
const ask = async (question, required, run) => {
  try { report.push([question, required, "yes", await run()]); }
  catch (error) { report.push([question, required, "NO", error?.reason ?? error?.code ?? error?.message?.slice(0, 60) ?? "refused"]); }
};

await ask("honours if-none-match and if-match", true, async () => (await proveS3ConditionalSemantics({ client, url })).conditional);
await ask("lists objects", true, async () => `${(await protocol.inventoryPage("objects")).entries.length} entries`);
const configuration = await ask("retains versions", false, async () => (await protocol.inventoryConfiguration()).versioning);
for (const kind of ["versions", "sessions"]) {
  await ask(`lists ${kind}`, false, async () => `${(await protocol.inventoryPage(kind)).entries.length} entries`);
}
void configuration;

const width = Math.max(...report.map(([question]) => question.length));
for (const [question, required, verdict, detail] of report) {
  console.log(`${question.padEnd(width)}  ${(required ? "required" : "optional").padEnd(8)}  ${verdict.padEnd(3)}  ${detail}`);
}
const failed = report.filter(([, required, verdict]) => required && verdict === "NO");
const missing = report.filter(([, required, verdict]) => !required && verdict === "NO");
if (failed.length > 0) {
  console.log(`\n${failed.length} REQUIRED answer missing: Freeholder will refuse recorded writes here, because this`);
  console.log("store does not actually honour the write preconditions it accepts.");
} else if (missing.length > 0) {
  console.log(`\nUsable. ${missing.length} optional capability absent, so the inventory will record less`);
  console.log("evidence here than on a provider that offers it. Nothing is refused.");
} else {
  console.log("\nUsable, and able to supply every piece of evidence the inventory can record.");
}
process.exit(failed.length === 0 ? 0 : 1);
