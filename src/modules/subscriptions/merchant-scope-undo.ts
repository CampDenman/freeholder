// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: retain original financial identities without broad ID coercion.
import { z } from "zod";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.uuid();
// This is the existing exact original_cash_feedback identity. Parsing never
// strips its namespace, lowercases its UUID or synthesizes another owner.
const feedbackIdentity = z.string().length(101).regex(/^[a-f0-9]{64}:/)
  .refine(value => uuid.safeParse(value.slice(65)).success, "Original feedback requires its actual UUID after the exact namespace digest.");
const ordinary = z.object({ kind: z.enum(["scope", "cash", "cash_observation", "schedule_resource", "schedule_operation", "setup_fee", "commercial_terms", "commercial_amendment", "commercial_resumption", "provider_read_ticket", "provider_read_finish", "provider_read_stop", "provider_generation", "provider_invoice", "provider_invoice_line", "invoice_financial", "controlled_financial"]), id: uuid, fingerprint });
const returned = z.object({ kind: z.literal("refund_financial"), id: z.union([uuid, feedbackIdentity]), fingerprint });

export const merchantSubscriptionUndo = z.object({ movedIds: z.array(uuid).max(5000),
  originalEvidence: z.array(z.discriminatedUnion("kind", [ordinary, returned])).max(5000) });
