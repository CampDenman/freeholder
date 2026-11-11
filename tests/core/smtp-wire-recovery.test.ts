// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: exercise the actual installed Nodemailer transport against loopback.
import { createServer, type Socket } from "node:net";
import { expect, it } from "vitest";
import { createSmtpMail } from "@/adapters/mail/smtp";

it("refuses an SMTP server without STARTTLS before sending an envelope or private body", async () => {
  const commands: string[] = [], sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.setEncoding("utf8"); socket.write("220 loopback.example.test SMTP\r\n");
    let buffer = "", readingBody = false;
    socket.on("data", chunk => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); commands.push(line);
        if (readingBody) { if (line === ".") { readingBody = false; socket.write("250 2.0.0 queued\r\n"); } continue; }
        if (/^EHLO|^HELO/.test(line)) socket.write("250-loopback.example.test\r\n250 SIZE 1000000\r\n");
        else if (/^MAIL FROM|^RCPT TO/.test(line)) socket.write("250 2.1.0 OK\r\n");
        else if (line === "DATA") { readingBody = true; socket.write("354 End with a dot\r\n"); }
        else if (line === "QUIT") socket.end("221 Goodbye\r\n");
        else socket.write("502 Command unavailable\r\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback SMTP fixture did not bind.");
  try {
    const adapter = createSmtpMail({ host: "127.0.0.1", port: address.port, secure: false, from: "sender@example.test" });
    await adapter.send({ to: "fictional@example.test", subject: "Fictional private receipt", text: "Never send this fictional private body in plaintext." }).catch(() => undefined);
    expect(commands.some(line => line.startsWith("MAIL FROM") || line === "DATA")).toBe(false);
    expect(commands.join("\n")).not.toContain("Never send this fictional private body");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 15_000);
