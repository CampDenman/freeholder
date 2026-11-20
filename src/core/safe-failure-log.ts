// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: the logging boundary never receives an untrusted error or request.
import { randomUUID } from "node:crypto";

export function logUnhandledFailure(surface: "http" | "mcp"): void {
  // Validate even the server-owned value. Client headers are never log identity.
  const requestId = randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)) {
    throw new Error("Cannot allocate an internal failure reference.");
  }
  console.error({ event: "unhandled_failure", surface: surface === "http" ? "http" : "mcp", category: "internal", code: "internal", requestId });
}
