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
import type { AbuseScanner } from "@/adapters/abuse-scan";
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
    // Formats PhotoDNA cannot read are not sent.
    expect(await photodna.match({ bytes: new Uint8Array([1]), contentType: "image/webp" })).toEqual({ matched: false });
    expect(calls).toHaveLength(1);
    expect(createPhotoDna({ subscriptionKey: "" }).missing()).toEqual(["PHOTODNA_SUBSCRIPTION_KEY"]);
  });

  it("treats a provider error as an error, not as clean", async () => {
    const failing: typeof fetch = async () => new Response(JSON.stringify({ Status: { Code: 3208, Description: "Image too small" } }), { status: 200 });
    const photodna = createPhotoDna({ subscriptionKey: "key", fetch: failing });
    await expect(photodna.match({ bytes: new Uint8Array([1]), contentType: "image/png" })).rejects.toThrow(/Image too small/);
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

  it("holds a match, holds when the check cannot run, and passes everything else on", async () => {
    const image = new Uint8Array([9, 9, 9]);
    const input = (contentType: string) => ({ filename: "x", contentType, bytes: image.byteLength, body: body(image) });
    expect(await createCompositeScanner(inner, abuse("match")).scan(input("image/jpeg"))).toMatchObject({ status: "infected", engine: "abuse-hash:photodna" });
    expect(await createCompositeScanner(inner, abuse("fail")).scan(input("image/jpeg"))).toMatchObject({ status: "error", engine: "abuse-hash:photodna" });
    recorded.length = 0;
    expect(await createCompositeScanner(inner, abuse("clean")).scan(input("image/jpeg"))).toEqual({ status: "clean", engine: "fake-av" });
    expect(Buffer.concat(recorded).equals(Buffer.from(image))).toBe(true);
    // Not an image: straight to the malware scanner, never to the abuse list.
    expect(await createCompositeScanner(noMalwareScanner, abuse("fail")).scan(input("application/pdf"))).toMatchObject({ status: "not_configured" });
  });
});
