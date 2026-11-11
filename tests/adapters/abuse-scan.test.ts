// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30: the PhotoDNA adapter against recorded HTTP (request shape from
// Microsoft's public PhotoDNA Cloud Service reference; not yet run against
// the live service), and the composite scanner that puts abuse matching in
// front of the malware scan and fails closed.
import { describe, expect, it } from "vitest";
import { createPhotoDna } from "@/adapters/abuse-scan/photodna";
import { saferScanner } from "@/adapters/abuse-scan/safer";
import { createCompositeScanner } from "@/adapters/malware";
import { noMalwareScanner } from "@/adapters/malware/none";
import { setAbuseRecorder, type AbuseMatchRecord, type AbuseScanner } from "@/adapters/abuse-scan";
import type { MalwareScanner } from "@/adapters/malware/types";

const body = (bytes: Uint8Array) => (async function* () { yield bytes as Uint8Array<ArrayBuffer>; })();

describe("PhotoDNA (C12.30)", () => {
  it("sends the image with the subscription key and reads matches", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const reply = { Status: { Code: 3000, Description: "OK" }, IsMatch: true, TrackingId: "trk_1", MatchDetails: { MatchFlags: [{ Source: "NCMEC" }] } };
    const photodna = createPhotoDna({ subscriptionKey: "key", endpoint: "https://photodna.test/v1.0", fetch: (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch });
    expect(await photodna.match({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })).toEqual({ matched: true, matchId: "trk_1", source: "NCMEC" });
    expect(calls[0]).toMatchObject({ url: "https://photodna.test/v1.0/Match?enhance=false", headers: { "ocp-apim-subscription-key": "key", "content-type": "image/jpeg" } });
    // An unsupported image is unchecked, not a negative hash match.
    await expect(photodna.match({ bytes: new Uint8Array([1]), contentType: "image/webp" })).rejects.toThrow(/format/i);
    expect(calls).toHaveLength(1);
    expect(createPhotoDna({ subscriptionKey: "" }).missing()).toEqual(["PHOTODNA_SUBSCRIPTION_KEY"]);
  });

  it("treats a provider error as an error, not as clean", async () => {
    const failing: typeof fetch = async () => new Response(JSON.stringify({ Status: { Code: 3208, Description: "Image too small" } }), { status: 200 });
    const photodna = createPhotoDna({ subscriptionKey: "key", fetch: failing });
    await expect(photodna.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).rejects.toThrow(/could not check/);
  });

  it.each([{}, { IsMatch: false }, { IsMatch: "false", Status: { Code: 3000 } }, { IsMatch: false, Status: { Code: "3000" } }, { IsMatch: true, Status: { Code: 3000 }, MatchDetails: { MatchFlags: [{ Source: {} }] } }])("does not turn a malformed success body into a scan verdict: %j", async reply => {
    const adapter = createPhotoDna({ subscriptionKey: "test-only-key", fetch: async () => Response.json(reply) });
    await expect(adapter.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).rejects.toThrow();
  });

  it("holds unsupported images and malformed provider answers without recording a match", async () => {
    let malwareCalls = 0;
    const malware: MalwareScanner = { id: "clamav", scan: async () => { malwareCalls++; return { status: "clean", engine: "test-only" }; } };
    const adapter = createPhotoDna({ subscriptionKey: "test-only-key", fetch: async () => Response.json({}) });
    const scanner = createCompositeScanner(malware, adapter);
    for (const contentType of ["image/webp", "image/avif", "image/png"]) {
      expect(await scanner.scan({ filename: "test-only", contentType, bytes: 1, body: body(new Uint8Array([1])) })).toMatchObject({ status: "error", engine: "abuse-hash-error:photodna" });
    }
    expect(malwareCalls).toBe(0);
  });

  it("accepts only an explicit successful negative answer as clean", async () => {
    const adapter = createPhotoDna({ subscriptionKey: "test-only-key", fetch: async () => Response.json({ IsMatch: false, Status: { Code: 3000 } }) });
    expect(await adapter.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).toMatchObject({ matched: false });
  });

  it("bounds streamed responses, rejects invalid UTF-8 and refuses unsuccessful HTTP", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); },
      cancel() { cancelled = true; },
    });
    const fixtures = [new Response(stream), new Response(new Uint8Array([255])), Response.json({ IsMatch: false, Status: { Code: 3000 } }, { status: 503 })];
    for (const response of fixtures) {
      const adapter = createPhotoDna({ subscriptionKey: "test-only-key", fetch: async () => response });
      await expect(adapter.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).rejects.toThrow(/could not check/);
    }
    expect(cancelled).toBe(true);
  });

  it("does not pretend Safer works before its adapter is completed", async () => {
    expect(saferScanner.missing()).not.toEqual([]);
    await expect(saferScanner.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).rejects.toThrow();
  });
});

describe("abuse matching in front of the malware scan (C12.30)", () => {
  const recorded: Uint8Array[] = [];
  const inner: MalwareScanner = {
    id: "clamav",
    async scan(input) {
      for await (const chunk of input.body) recorded.push(chunk);
      return { status: "clean", engine: "fake-av" };
    },
  };
  const abuse = (result: "match" | "clean" | "fail"): AbuseScanner => ({
    id: "photodna",
    missing: () => [],
    match: async () => {
      if (result === "fail") throw new Error("down");
      return result === "match" ? { matched: true, matchId: "m1" } : { matched: false };
    },
  });

  const image = new Uint8Array([9, 9, 9]);
  const input = (contentType: string) => ({ filename: "x", contentType, bytes: image.byteLength, body: body(image) });

  // Runs first: no recorder is registered yet in this file.
  it("refuses a match when nothing would record it for the legal report", async () => {
    await expect(createCompositeScanner(inner, abuse("match")).scan(input("image/jpeg"))).rejects.toThrow(/No recorder/);
  });

  it("holds a match, holds when the check cannot run, and passes everything else on", async () => {
    const matches: AbuseMatchRecord[] = [];
    setAbuseRecorder(async (record) => { matches.push(record); });
    // Installing again replaces the recorder: a reload never records a match twice.
    setAbuseRecorder(async (record) => { matches.push(record); });
    expect(await createCompositeScanner(inner, abuse("match")).scan(input("image/jpeg"))).toMatchObject({ status: "infected", engine: "abuse-hash:photodna" });
    expect(matches).toHaveLength(1);
    // Unchecked is not a match: its own tag, so it is never taken for evidence.
    expect(await createCompositeScanner(inner, abuse("fail")).scan(input("image/jpeg"))).toMatchObject({ status: "error", engine: "abuse-hash-error:photodna" });
    expect(await createCompositeScanner(inner, abuse("clean")).scan({ ...input("image/jpeg"), bytes: 65 * 1024 * 1024 })).toMatchObject({ status: "error", engine: "abuse-hash-error:photodna" });
    recorded.length = 0;
    expect(await createCompositeScanner(inner, abuse("clean")).scan(input("image/jpeg"))).toEqual({ status: "clean", engine: "fake-av" });
    expect(Buffer.concat(recorded).equals(Buffer.from(image))).toBe(true);
    // Not an image: straight to the malware scanner, never to the abuse list.
    expect(await createCompositeScanner(noMalwareScanner, abuse("fail")).scan(input("application/pdf"))).toMatchObject({ status: "not_configured" });
  });
});
