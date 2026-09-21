// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.31: the app requests a bounded operation through a private Unix socket.
import { request } from "node:http";
import { z } from "zod";
import { env } from "@/core/env";
import { defineOrchestratedService, ServiceError } from "@/core/service";

const status = z.object({
  status: z.string(), id: z.string().optional(), image: z.string().optional(),
  error: z.string().optional(), automatic: z.boolean().optional(),
  channel: z.string().optional(), utcHour: z.number().optional(),
});

async function hostRequest(path: "/status" | "/apply"): Promise<unknown> {
  const socketPath = env().FREEHOLDER_UPDATE_SOCKET;
  if (!socketPath || env().FREEHOLDER_PLAYGROUND === "1") {
    throw new ServiceError("conflict", "The host updater is not configured.");
  }
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ServiceError("conflict", "The host updater is unavailable. Check its host service."));
    const req = request({ socketPath, path, method: path === "/apply" ? "POST" : "GET",
      headers: path === "/apply" ? { "Content-Type": "application/json", "Content-Length": "2" } : {},
    }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 16_384) req.destroy(new Error("Oversized response"));
      });
      res.on("error", fail);
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 300) return fail();
        try { resolve(JSON.parse(body)); } catch { fail(); }
      });
    });
    req.setTimeout(5_000, () => req.destroy(new Error("Host timeout")));
    req.on("error", fail);
    req.end(path === "/apply" ? "{}" : undefined);
  });
}

export const getHostUpdateStatus = defineOrchestratedService({
  name: "platform.getHostUpdateStatus", summary: "Read the independent Docker host updater status.",
  kind: "query", permission: "scoped", external: false,
  input: z.object({}), output: status,
  handler: async () => status.parse(await hostRequest("/status")),
});

export const requestHostUpdate = defineOrchestratedService({
  name: "platform.requestHostUpdate", summary: "Request a verified Docker update with unchanged database schema.",
  kind: "mutation", permission: "scoped", external: false, agentCallable: false, stepUp: true,
  input: z.object({}), output: status,
  handler: async (_input, actor) => {
    if (actor.kind !== "user" || actor.role !== "owner" || !actor.security?.stepUpValid) {
      throw new ServiceError("step_up_required", "An owner must confirm their identity with two-factor authentication.");
    }
    return status.parse(await hostRequest("/apply"));
  },
});
