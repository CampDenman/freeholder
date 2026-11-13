// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact JSON provider facts, separate from the full physical SQL receipt hash.
import { createHash } from "node:crypto";
function canonical(value:unknown):string {
 if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
export function controlledSubscriptionFactsDigest(raw:Record<string,unknown>):string {
 return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(raw)))).digest("hex");
}
