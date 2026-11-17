// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact JSON provider facts, separate from the full physical SQL receipt hash.
import { createHash } from "node:crypto";
import { CONTROLLED_PROJECTION_KEY } from "./merchant-controlled-safe-response-contract";
function canonical(value:unknown):string {
 if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).filter(([key])=>key!==CONTROLLED_PROJECTION_KEY).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
export function controlledSubscriptionFactsDigest(raw:Record<string,unknown>):string {
 return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(raw)))).digest("hex");
}
