// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: a local Message-ID alone is not a positive SMTP submission response.
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: transport.send }) }));
import { createSmtpMail } from "@/adapters/mail/smtp";
const message = { to: "fictional@example.test", subject: "Fictional receipt", text: "Fictional body" };
describe("SMTP positive submission proof (C3.31)", () => {
  beforeEach(() => transport.send.mockReset());
  for (const response of [
    { messageId: "locally-generated-only" },
    { messageId: "local-id", accepted: [], rejected: [message.to], response: "550 recipient refused" },
    { messageId: "local-id", accepted: ["another@example.test"], rejected: [], response: "250 queued another recipient" },
  ]) it(`refuses incomplete or mismatched acceptance ${JSON.stringify(response)}`, async () => {
    transport.send.mockResolvedValue(response);
    await expect(createSmtpMail({ host: "smtp.example.test", port: 587, from: "sender@example.test" }).send(message)).rejects.toThrow();
  });
  it("accepts a final positive server response for the exact recipient", async () => {
    transport.send.mockResolvedValue({ messageId: "original-message-id", accepted: [message.to], rejected: [], response: "250 2.0.0 queued original message" });
    await expect(createSmtpMail({ host: "smtp.example.test", port: 587, from: "sender@example.test" }).send(message)).resolves.toHaveProperty("providerRef", "original-message-id");
  });
});
