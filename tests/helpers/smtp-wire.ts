// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synthetic loopback TLS SMTP. Ephemeral fixture keys never enter the repository.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";

export async function tlsSmtpFixture(options: { dropDataReply?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "freeholder-smtp-fixture-"));
  const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const sockets = new Set<TLSSocket>(), messages: string[] = [], commands: string[] = [];
  const server = createServer({ key, cert }, socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => undefined); socket.setEncoding("utf8"); socket.write("220 loopback.example.test SMTP\r\n");
    let buffer = "", body: string[] | null = null;
    socket.on("data", chunk => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (body) {
          if (line === ".") { messages.push(body.join("\r\n")); body = null; if (options.dropDataReply) socket.destroy(); else socket.write("250 2.0.0 queued as original-fixture-message\r\n"); }
          else body.push(line);
          continue;
        }
        commands.push(line);
        if (/^EHLO|^HELO/.test(line)) socket.write("250-loopback.example.test\r\n250 SIZE 1000000\r\n");
        else if (/^MAIL FROM|^RCPT TO/.test(line)) socket.write("250 2.1.0 OK\r\n");
        else if (line === "DATA") { body = []; socket.write("354 End with a dot\r\n"); }
        else if (line === "QUIT") socket.end("221 Goodbye\r\n");
        else socket.write("502 Command unavailable\r\n");
      }
    });
  });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback TLS fixture did not bind.");
  return { port: address.port, ca: cert.toString("utf8"), messages, commands, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}
