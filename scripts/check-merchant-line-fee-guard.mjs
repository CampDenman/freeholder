// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: prove the appended guard preserves every pre-existing invariant.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const original = await readFile(new URL("deploy/merchant-payment-schema80.fragment.sql", root), "utf8");
const appended = await readFile(new URL("deploy/merchant-line-fee80.fragment.sql", root), "utf8");
const start = original.indexOf("CREATE FUNCTION guard_merchant_fee_refund()");
const end = original.indexOf("\n--> statement-breakpoint", start);
assert(start >= 0 && end > start);
const before = original.slice(start, end);
const replacement = appended.slice(appended.indexOf("CREATE OR REPLACE FUNCTION guard_merchant_fee_refund()")).trimEnd();
const dispatch = "  IF OLD.status='reserved' AND NEW.status='dispatching' AND NEW.target_retained_fee_minor IS DISTINCT FROM freeholder_original_line_fee_target(NEW.payment_id) THEN\n   RAISE EXCEPTION 'Restore the original bound line commission before physical fee admission.' USING ERRCODE='23514';\n  END IF;\n";
assert(replacement.includes(dispatch));
const normalized = replacement.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION").replace(dispatch, "")
  .replace(" target_fee:=freeholder_original_line_fee_target(parent.id);", " IF parent.amount_minor>0 THEN target_fee:=floor(original_fee::numeric*(parent.amount_minor-parent.refunded_minor)/parent.amount_minor)::bigint; END IF;");
assert.equal(normalized, before, "No existing capacity, currency, physical ACK, immutable evidence or unknown-state guard may be relaxed.");
assert(appended.indexOf("CREATE FUNCTION freeholder_original_line_fee_target") < appended.indexOf("CREATE OR REPLACE FUNCTION guard_merchant_fee_refund"));
assert(!/set_config|current_setting|CREATE\s+TABLE/i.test(appended), "The target is not supplied by a scalar/GUC or a new projection table.");
console.log(JSON.stringify({ preservedGuardSha256: createHash("sha256").update(before).digest("hex"), fragmentSha256: createHash("sha256").update(appended).digest("hex"), canonicalTargetAndDispatchRecheckOnly: true }));
