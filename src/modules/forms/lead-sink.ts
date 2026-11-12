// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copying accepted submissions to the configured lead sink (C3.34).
//
// An outbox listener on `forms.submitted`, which only fires for submissions
// that passed quarantine, and which runs after the submission has committed.
// Only submissions sealed by a site form are copied: those are the ones whose
// sender saw the notice naming the provider. Owner entries, API and MCP
// submissions are never copied, and neither is a submission an owner later
// rescues from the spam queue: rescue emits no `forms.submitted`.
//
// Ambiguous failures stop physical replay until verified review. The outbox retries with backoff and, after its last
// attempt, dead-letters the delivery, which the owner sees under Jobs →
// Outbox and can replay once the cause is fixed. A lead is never dropped
// silently, and the submission itself is already kept here either way.
import { paradiseSite } from "@/adapters/paradise/config";
import { paradiseRequest, ParadiseRequestError } from "@/adapters/paradise/http";
import { ServiceError } from "@/core/service";
import { claimLeadCopy, finishLeadCopy } from "./lead-copy-state";
import { leadSink, type LeadCopy } from "@/adapters/lead-sink";
import { env } from "@/core/env";
import { emailFrom, messageFrom, nameFrom, type FormField } from "./fields";

// Form return addresses can contain reusable appointment or sign-in access.
// Only a public page path is useful attribution; credentials never are.
const PRIVATE_LEAD_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:admin|portal|account|security|login|sign-in|reset|preview-access|setup|playground|messages|call|m|feed|community|join|orders|checkout|cart|buy|book|gifts|memberships|member-files|member-blobs)(?:\/|$)/i;
function leadPageUrl(sourceUrl: string): string | undefined {
  const origin = new URL(env().APP_URL).origin;
  try {
    const page = new URL(sourceUrl, origin);
    if (page.origin !== origin) return `${origin}/`;
    page.username = ""; page.password = ""; page.search = ""; page.hash = "";
    let path = page.pathname;
    for (let depth = 0; depth < 3; depth++) {
      const decoded = decodeURIComponent(path).replaceAll("\\", "/").replace(/\/+/g, "/");
      if (decoded === path) break;
      path = decoded;
    }
    if (PRIVATE_LEAD_PATH.test(new URL(path, origin).pathname)) return `${origin}/`;
    return page.href;
  } catch {
    return `${origin}/`;
  }
}

/** What is copied for one submission: the fields the privacy notice lists. */
export function leadCopy(
  form: { slug: string; fields: FormField[] },
  submission: { id: string; data: Record<string, unknown>; sourceUrl: string | null },
): LeadCopy {
  const { fields } = form;
  const data = submission.data;
  const email = emailFrom(fields, data);
  const phoneField = fields.find((field) => field.kind === "tel");
  const phone = phoneField ? data[phoneField.key] : undefined;
  const message = messageFrom(fields, data);
  const answers = Object.fromEntries(
    fields
      .filter((field) => data[field.key] !== undefined && data[field.key] !== "")
      .map((field) => [field.label, data[field.key]]),
  );
  const pageUrl = submission.sourceUrl ? leadPageUrl(submission.sourceUrl) : undefined;
  return {
    submissionId: submission.id,
    formSlug: form.slug,
    name: nameFrom(fields, data, email),
    ...(email ? { email } : {}),
    ...(typeof phone === "string" && phone ? { phone } : {}),
    ...(message ? { message } : {}),
    answers,
    ...(pageUrl ? { pageUrl } : {}),
  };
}

export async function copySubmissionToLeadSink(payload: unknown): Promise<void> {
  const event = (payload ?? {}) as { submissionId?: string; fromSiteForm?: boolean; leadRequested?: boolean; leadCopyId?: string };
  if (event.leadRequested === false || event.fromSiteForm === false) return;
  if (!event.leadCopyId) {
    if (event.fromSiteForm) throw new ServiceError("conflict", "This legacy lead event has no original notice or destination evidence. Review it; today's account cannot replace it.");
    return;
  }
  if (!leadSink()) throw new ServiceError("conflict", "The evidenced original lead destination is unavailable. Keep the enquiry and restore its original configuration.");
  const site = paradiseSite(), claim = await claimLeadCopy(event.leadCopyId, site);
  if (!claim) return;
  let positive: { providerRef: string; response: unknown; httpStatus: number } | undefined;
  try {
    const response = await paradiseRequest<{ accepted?: boolean; id?: string | number }>("/api/collect/lead", { body: claim.body, site });
    if (response.body.accepted !== true || !(typeof response.body.id === "string" ? response.body.id.trim().length > 0 && response.body.id.length <= 2000 : typeof response.body.id === "number" && Number.isSafeInteger(response.body.id) && response.body.id > 0)) throw new ParadiseRequestError("The original provider did not identify an accepted lead copy.", response.status, false, "invalid_lead_ack");
    positive = { providerRef: String(response.body.id), response, httpStatus: response.status };
    await finishLeadCopy(claim.id, claim.operationId, { observed: "copied", ...positive });
  } catch (error) {
    if (positive) {
      // Preserve the original positive reply independently if ordinary apply
      // failed. No provider call occurs in this second recording phase.
      await finishLeadCopy(claim.id, claim.operationId, { observed: "copied", ...positive });
      throw new ServiceError("conflict", "The original positive lead reply was retained; local completion needs review.");
    }
    const status = error instanceof ParadiseRequestError ? error.status : undefined;
    const refused = Boolean(status && [400, 401, 403, 404, 405, 413, 422, 429].includes(status));
    await finishLeadCopy(claim.id, claim.operationId, { observed: refused ? "not_copied" : "unknown", ...(status ? { httpStatus: status } : {}), retry: status === 429 });
    if (status === 429) throw new ServiceError("conflict", "The original provider refused this request under its rate limit; its frozen request will retry.");
    if (refused) { console.warn(`[forms] Original lead copy refused (HTTP ${status}); the enquiry remains in Freeholder.`); return; }
    throw new ServiceError("conflict", "The original lead-copy outcome is unknown. Verify that provider operation and stop its caller before any replacement.");
  }
}
