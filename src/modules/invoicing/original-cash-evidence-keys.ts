// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: one acyclic source of existing financial evidence key policy.
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";
export function originalCashEvidenceKeys() { const e = env(); return [...new Set([e.CREDENTIAL_KEY, e.CREDENTIAL_KEY_PREVIOUS, e.SESSION_SECRET].filter((key): key is string => Boolean(key)))]; }
export function originalCashSigningKey() { const e = env(), key = e.CREDENTIAL_KEY ?? e.SESSION_SECRET; if (!key) throw new ServiceError("conflict", "Restore the original financial evidence key."); return key; }
