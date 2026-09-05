// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Authenticated encryption and key-rotation contract for transient mail bodies.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/core/env";
import {
  decryptMailOutbox,
  encryptMailOutbox,
} from "@/core/mail/outbox-crypto";

const names = ["CREDENTIAL_KEY", "CREDENTIAL_KEY_PREVIOUS", "SESSION_SECRET"] as const;
const original = new Map<string, string | undefined>();

function configure(values: Partial<Record<(typeof names)[number], string>>): void {
  for (const name of names) {
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value;
  }
  resetEnvForTests();
}

describe("encrypted mail outbox envelopes", () => {
  beforeEach(() => {
    for (const name of names) original.set(name, process.env[name]);
  });

  afterEach(() => {
    for (const name of names) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    original.clear();
    resetEnvForTests();
  });

  it("round-trips without exposing plaintext and binds it to the delivery id", () => {
    configure({ SESSION_SECRET: "mail-outbox-test-secret-material-32-bytes" });
    const deliveryId = crypto.randomUUID();
    const plaintext = "private reset token 123";
    const envelope = encryptMailOutbox(plaintext, deliveryId);

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(plaintext);
    expect(decryptMailOutbox(envelope, deliveryId)).toBe(plaintext);
    expect(() => decryptMailOutbox(envelope, crypto.randomUUID())).toThrow(
      "cannot be decrypted",
    );
  });

  it("rejects tampering and unsupported envelopes", () => {
    configure({ SESSION_SECRET: "mail-outbox-test-secret-material-32-bytes" });
    const deliveryId = crypto.randomUUID();
    const envelope = encryptMailOutbox("message", deliveryId);
    const final = envelope.at(-1)!;
    const tampered = `${envelope.slice(0, -1)}${final === "A" ? "B" : "A"}`;

    expect(() => decryptMailOutbox(tampered, deliveryId)).toThrow(
      "cannot be decrypted",
    );
    expect(() => decryptMailOutbox(`v2${envelope.slice(2)}`, deliveryId)).toThrow(
      "unsupported envelope",
    );
  });

  it("decrypts rows written with the previous credential key during rotation", () => {
    configure({ CREDENTIAL_KEY: "old-mail-key" });
    const deliveryId = crypto.randomUUID();
    const envelope = encryptMailOutbox("queued before rotation", deliveryId);

    configure({
      CREDENTIAL_KEY: "new-mail-key",
      CREDENTIAL_KEY_PREVIOUS: "old-mail-key",
    });
    expect(decryptMailOutbox(envelope, deliveryId)).toBe("queued before rotation");
  });

  it("refuses to stage plaintext when no server secret is configured", () => {
    configure({});
    expect(() => encryptMailOutbox("message", crypto.randomUUID())).toThrow(
      "required to queue mail safely",
    );
  });
});
