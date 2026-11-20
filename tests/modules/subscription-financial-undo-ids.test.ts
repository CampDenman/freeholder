// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN strict historical and namespaced undo IDs.
import { describe, expect, it } from "vitest";
import { merchantSubscriptionUndo } from "@/modules/subscriptions/merchant-scope-undo";

const original = "00000000-0000-4000-8000-000000000001", namespace = "a".repeat(64), sha = "b".repeat(64);
const parse = (id: string, kind = "refund_financial") => merchantSubscriptionUndo.parse({ movedIds: [original], originalEvidence: [{ kind, id, fingerprint: sha }] });
describe("original subscription financial undo identities", () => {
  it("preserves the whole namespace and actual feedback UUID byte-for-byte", () => {
    const identity = `${namespace}:${original}`;
    expect(parse(identity).originalEvidence[0]?.id).toBe(identity);
    expect(parse(`${"c".repeat(64)}:${original}`).originalEvidence[0]?.id).not.toBe(identity);
  });
  it("keeps historical UUID financial witnesses compatible", () => {
    expect(parse(original).originalEvidence).toEqual([{ kind: "refund_financial", id: original, fingerprint: sha }]);
  });
  it.each(["scope", "cash", "cash_observation", "schedule_resource", "schedule_operation", "setup_fee", "commercial_terms", "commercial_amendment", "commercial_resumption", "provider_read_ticket", "provider_read_finish", "provider_read_stop", "provider_generation", "provider_invoice", "provider_invoice_line", "invoice_financial"])("keeps %s identities strict UUID", kind => {
    expect(parse(original, kind).originalEvidence[0]?.id).toBe(original);
    expect(() => parse(`${namespace}:${original}`, kind)).toThrow();
  });
  it.each([`${"a".repeat(63)}:${original}`, `${"A".repeat(64)}:${original}`, `${"g".repeat(64)}:${original}`,
    `${namespace}:not-a-uuid`, `${namespace}:${original}:extra`, ` ${namespace}:${original}`, `${namespace}:${original} `,
    `${namespace}:00000000-0000-4000-0000-000000000001`, `original_cash_feedback:${original}`])("refuses malformed identity %s", identity => {
    expect(() => parse(identity)).toThrow();
  });
  it("retains both table-bound fingerprints when separate original tables share one UUID", () => {
    const evidence = [{ kind: "refund_financial", id: original, fingerprint: sha }, { kind: "refund_financial", id: original, fingerprint: "c".repeat(64) }];
    expect(merchantSubscriptionUndo.parse({ movedIds: [original], originalEvidence: evidence }).originalEvidence).toEqual(evidence);
  });
  it("refuses unknown evidence kinds and preserves the complete5000 snapshot bound", () => {
    expect(() => parse(original, "unreviewed_future_kind")).toThrow();
    const evidence = Array.from({ length: 5001 }, () => ({ kind: "refund_financial", id: original, fingerprint: sha }));
    expect(() => merchantSubscriptionUndo.parse({ movedIds: [original], originalEvidence: evidence })).toThrow();
  });
});
