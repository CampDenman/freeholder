// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// A file-level directive, unlike app/theme.ts: these are imported by client
// components, and an inline "use server" is only legal inside a Server
// Component. Every export here is therefore an action, which is what they are.
//
// Admin actions. Like the setup wizard, these go through the same services the
// REST API and MCP server call (§11) — the admin is a caller, never a
// shortcut. Next verifies the Origin header for Server Actions, so this path
// carries its own CSRF defence.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { login, logout } from "@/core/auth/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { changePassword } from "@/core/auth/service";
import { LOGIN_CHALLENGE_COOKIE } from "@/core/auth/two-factor";
import { getT } from "../i18n";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import {
  createContact,
  mergeContacts,
  undoContactMerge,
  updateContact,
} from "@/core/contacts/service";
import {
  dismissDuplicateCandidate,
  mergeDuplicateCandidate,
  scanDuplicateCandidates,
} from "@/core/contacts/duplicates";
import {
  createCustomField,
  updateCustomField,
} from "@/core/contacts/custom-fields";
import {
  createOrganization,
  deleteOrganization,
  updateOrganization,
} from "@/core/contacts/organizations";
import {
  createRelationship,
  deleteRelationship,
  updateRelationship,
} from "@/core/contacts/relationships";
import {
  createLocationService as createLocation,
  deleteLocation,
  setOpeningHours,
  setPrimaryLocation,
  setServiceArea,
  updateLocation,
} from "@/core/locations/service";
import { createApiKey, revokeApiKey } from "@/core/apikeys/service";
import {
  createWebhook,
  deleteWebhook,
  revealWebhookSecret,
  testWebhook,
  updateWebhook,
} from "@/core/webhooks/service";
import { patchBusiness } from "@/core/settings/service";
import {
  assignRole,
  createRole,
  deleteRole,
  updateRole,
} from "@/core/roles/service";
import { ServiceError } from "@/core/service";
import {
  addRetentionException,
  createDataRequest,
  denyDataRequest,
  fulfillDataRequest,
  recordConsent,
  removeRetentionException,
  startDataRequest,
  verifyDataRequest,
} from "@/core/privacy/service";
import {
  cancelJobRun,
  redriveJobDeadLetters,
  retryJobRun,
} from "@/core/jobs/service";

export interface ActionState {
  error?: string;
  saved?: boolean;
  /**
   * What the caller typed, handed back on failure.
   *
   * React resets a form after its action runs — every time, success or not —
   * so without this an owner who mistypes one field loses the whole record
   * they just filled in. `attempt` changes on each failure so the inputs
   * remount and pick the returned values up.
   */
  values?: Record<string, string>;
  attempt?: number;
  /** A fully-worded success line, built server-side (see changePasswordAction). */
  message?: string;
}

function present(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("admin action failed", error);
  return { error: "Something went wrong. Try again." };
}

function field(form: FormData, key: string, fallback = ""): string {
  const value = form.get(key);
  return typeof value === "string" ? value : fallback;
}

/** Hand a form's own text back, so a rejected save does not discard it. */
function echo(
  previous: ActionState,
  form: FormData,
): Pick<ActionState, "values" | "attempt"> {
  const values: Record<string, string> = {};
  for (const key of form.keys()) {
    // Never a password: echoing one would put it in the rendered HTML.
    if (key === "password") continue;
    values[key] = field(form, key);
  }
  return { values, attempt: (previous.attempt ?? 0) + 1 };
}

async function currentActor() {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return {
    ...actor,
    request: requestMetadataFromHeaders(await headers()),
  };
}

export async function signInAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let result: Awaited<ReturnType<typeof login.call>>;
  try {
    result = await login.call(
      { email: field(form, "email"), password: field(form, "password") },
      {
        kind: "anonymous",
        request: requestMetadataFromHeaders(await headers()),
      },
    );
  } catch (error) {
    // Same reason as the contact form: React resets the form, and retyping an
    // address after a mistyped password is a needless indignity. `echo` never
    // returns the password.
    return { ...present(error), ...echo(_previous, form) };
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  if (result.twoFactorRequired) {
    jar.set(LOGIN_CHALLENGE_COOKIE, result.challengeToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure,
      expires: new Date(Date.now() + 10 * 60 * 1000),
    });
    redirect("/login/verify");
  }
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  redirect("/admin");
}

/**
 * Change your own password.
 *
 * The session token travels from the cookie into the service so the screen the
 * owner is looking at is the one session left standing — every other device is
 * signed out, which is the point of changing a password at all.
 */
export async function changePasswordAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  try {
    const result = await changePassword.call(
      {
        currentPassword: field(form, "currentPassword"),
        newPassword: field(form, "newPassword"),
        keepSessionToken: token,
      },
      await currentActor(),
    );
    // The wording is decided here rather than handed to the client as a
    // function: a server component may not pass one across that boundary, and
    // the server is where the catalogs and the plural rules live anyway.
    const t = await getT();
    return {
      saved: true,
      message: t("settings.passwordChanged", {
        count: result.otherSessionsRevoked,
      }),
    };
  } catch (error) {
    // Neither password is echoed back: `resubmit` already refuses to return a
    // field called "password", and these are not called that.
    return { ...present(error), attempt: (previous.attempt ?? 0) + 1 };
  }
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // Through the service, so the session row is actually revoked rather than
    // just forgotten by this browser.
    await logout.call({ token }, await currentActor()).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect("/login");
}

export async function saveBusinessSettingsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locales = field(form, "enabledLocales", "en")
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);

  try {
    await patchBusiness.call(
      {
        name: field(form, "name"),
        tagline: field(form, "tagline") || undefined,
        schemaType: field(form, "schemaType"),
        country: field(form, "country"),
        baseCurrency: field(form, "baseCurrency"),
        timezone: field(form, "timezone"),
        defaultLocale: locales[0] ?? "en",
        enabledLocales: locales,
        units: field(form, "units", "metric") as "metric" | "imperial",
        firstDayOfWeek: Number(field(form, "firstDayOfWeek", "1")),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  return { saved: true };
}

const STAGES = ["lead", "prospect", "customer", "repeat"] as const;
type Stage = (typeof STAGES)[number];

function stageOf(form: FormData): Stage {
  const value = field(form, "lifecycleStage", "lead");
  return (STAGES as readonly string[]).includes(value)
    ? (value as Stage)
    : "lead";
}

function tagsOf(form: FormData): string[] {
  return field(form, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function customFieldsOf(form: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const descriptor of form.getAll("customField")) {
    if (typeof descriptor !== "string") continue;
    const [key, kind] = descriptor.split("|", 2);
    if (!key || !kind) continue;
    const raw = field(form, `custom:${key}`).trim();
    if (!raw) {
      values[key] = null;
    } else if (kind === "number") {
      const number = Number(raw);
      values[key] = Number.isFinite(number) ? number : raw;
    } else if (kind === "boolean") {
      values[key] = raw === "true" ? true : raw === "false" ? false : raw;
    } else {
      values[key] = raw;
    }
  }
  return values;
}

function optionalId(form: FormData, key: string): string | null {
  return field(form, key).trim() || null;
}

export async function createContactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const contact = await createContact.call(
      {
        name: field(form, "name"),
        email: field(form, "email") || null,
        phone: field(form, "phone") || null,
        orgId: optionalId(form, "orgId"),
        lifecycleStage: stageOf(form),
        tags: tagsOf(form),
        customFields: customFieldsOf(form),
        preferredLocale: field(form, "preferredLocale") || null,
        timezone: field(form, "timezone") || null,
        country: field(form, "country") || null,
        ownerNotes: field(form, "ownerNotes") || null,
        source: "admin",
      },
      await currentActor(),
    );
    id = contact.id;
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  redirect(`/admin/contacts/${id}`);
}

export async function updateContactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateContact.call(
      {
        id: field(form, "id"),
        name: field(form, "name"),
        email: field(form, "email") || null,
        phone: field(form, "phone") || null,
        orgId: optionalId(form, "orgId"),
        lifecycleStage: stageOf(form),
        tags: tagsOf(form),
        customFields: customFieldsOf(form),
        preferredLocale: field(form, "preferredLocale") || null,
        timezone: field(form, "timezone") || null,
        country: field(form, "country") || null,
        ownerNotes: field(form, "ownerNotes") || null,
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  return { saved: true };
}

/**
 * Fold a duplicate into the contact being viewed. Owner-only at the service,
 * so a staff member who reaches this form still gets a clean refusal.
 */
export async function mergeContactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const survivingId = field(form, "survivingId");
  try {
    await mergeContacts.call(
      { survivingId, duplicateId: field(form, "duplicateId") },
      await currentActor(),
    );
  } catch (error) {
    return present(error);
  }
  redirect(`/admin/contacts/${survivingId}`);
}

/** One action boundary for every deliberate decision in the duplicate desk. */
export async function duplicateReviewAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const intent = field(form, "intent");
  let messageKey: string;
  try {
    const actor = await currentActor();
    switch (intent) {
      case "scan":
        await scanDuplicateCandidates.call({}, actor);
        messageKey = "contacts.duplicates.scanComplete";
        break;
      case "dismiss":
        await dismissDuplicateCandidate.call(
          { id: field(form, "candidateId") },
          actor,
        );
        messageKey = "contacts.duplicates.dismissed";
        break;
      case "merge":
        await mergeDuplicateCandidate.call(
          {
            candidateId: field(form, "candidateId"),
            survivingId: field(form, "survivingId"),
            duplicateId: field(form, "duplicateId"),
          },
          actor,
        );
        messageKey = "contacts.duplicates.merged";
        break;
      case "undo":
        await undoContactMerge.call(
          { operationId: field(form, "operationId") },
          actor,
        );
        messageKey = "contacts.duplicates.undoneMessage";
        break;
      default:
        throw new ServiceError("validation", "Choose a duplicate-review action.");
    }
  } catch (error) {
    return present(error);
  }
  revalidatePath("/admin/contacts");
  revalidatePath("/admin/contacts/duplicates");
  const t = await getT();
  return { saved: true, message: t(messageKey) };
}

/* --------------------------------------------- privacy rights (C1.08) */

function correctionFrom(form: FormData) {
  const name = field(form, "name").trim();
  const email = field(form, "email").trim();
  const phone = field(form, "phone").trim();
  const preferredLocale = field(form, "preferredLocale").trim();
  const timezone = field(form, "timezone").trim();
  const country = field(form, "country").trim();
  return {
    name: name || undefined,
    email: field(form, "clearEmail") === "on" ? null : email || undefined,
    phone: field(form, "clearPhone") === "on" ? null : phone || undefined,
    preferredLocale: preferredLocale || undefined,
    timezone: timezone || undefined,
    country: country || undefined,
  };
}

/** One auditable boundary for the privacy desk's explicit human decisions. */
export async function privacyDeskAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const intent = field(form, "intent");
  let messageKey: string;
  try {
    const actor = await currentActor();
    switch (intent) {
      case "consent":
        await recordConsent.call(
          {
            contactId: field(form, "contactId"),
            purpose: field(form, "purpose") as
              | "marketing"
              | "analytics"
              | "data_processing",
            channel: (field(form, "channel") || null) as
              | "email"
              | "sms"
              | "push"
              | "web"
              | null,
            state: field(form, "state") as "granted" | "denied" | "withdrawn",
            method: field(form, "method") as
              | "form"
              | "preference_center"
              | "double_opt_in"
              | "verbal"
              | "written"
              | "contract"
              | "import"
              | "system",
            termsVersion: field(form, "termsVersion") || null,
            sourceUrl: field(form, "sourceUrl") || null,
            expiresAt: field(form, "expiresAt")
              ? new Date(field(form, "expiresAt")).toISOString()
              : null,
            evidence: field(form, "evidenceNote")
              ? { note: field(form, "evidenceNote") }
              : {},
          },
          actor,
        );
        messageKey = "privacy.message.consentRecorded";
        break;
      case "create": {
        const kind = field(form, "kind") as
          | "access"
          | "export"
          | "correction"
          | "erasure";
        const note = field(form, "note") || undefined;
        await createDataRequest.call(
          {
            contactId: field(form, "contactId"),
            jurisdiction: field(form, "jurisdiction") || null,
            request:
              kind === "correction"
                ? { kind, note, changes: correctionFrom(form) }
                : { kind, note },
          },
          actor,
        );
        messageKey = "privacy.message.requestCreated";
        break;
      }
      case "verify":
        await verifyDataRequest.call(
          { id: field(form, "requestId"), method: field(form, "method") },
          actor,
        );
        messageKey = "privacy.message.verified";
        break;
      case "start":
        await startDataRequest.call({ id: field(form, "requestId") }, actor);
        messageKey = "privacy.message.started";
        break;
      case "retain":
        await addRetentionException.call(
          {
            dataRequestId: field(form, "requestId"),
            scope: field(form, "scope"),
            reason: field(form, "reason") as
              | "legal_obligation"
              | "legal_claim"
              | "contractual_obligation"
              | "accounting_tax"
              | "security_fraud",
            legalBasis: field(form, "legalBasis"),
            notes: field(form, "notes") || null,
            expiresAt: field(form, "expiresAt")
              ? new Date(field(form, "expiresAt")).toISOString()
              : null,
          },
          actor,
        );
        messageKey = "privacy.message.exceptionSaved";
        break;
      case "remove-retention":
        await removeRetentionException.call(
          { id: field(form, "exceptionId") },
          actor,
        );
        messageKey = "privacy.message.exceptionRemoved";
        break;
      case "fulfill":
        await fulfillDataRequest.call(
          {
            id: field(form, "requestId"),
            confirmation: field(form, "confirmation") || undefined,
          },
          actor,
        );
        messageKey = "privacy.message.fulfilled";
        break;
      case "deny":
        await denyDataRequest.call(
          {
            id: field(form, "requestId"),
            resolution: field(form, "resolution"),
          },
          actor,
        );
        messageKey = "privacy.message.denied";
        break;
      default:
        throw new ServiceError("validation", "Choose a privacy-desk action.");
    }
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  revalidatePath("/admin/contacts");
  revalidatePath("/admin/contacts/privacy");
  const requestId = field(form, "requestId");
  if (requestId) revalidatePath(`/admin/contacts/privacy/${requestId}`);
  const t = await getT();
  return { saved: true, message: t(messageKey) };
}

/** High-risk queue recovery stays behind one step-up-protected service boundary. */
export async function jobControlAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const intent = field(form, "intent");
  const name = field(form, "name");
  const id = field(form, "id");
  let messageKey: string;
  try {
    const actor = await currentActor();
    switch (intent) {
      case "cancel":
        await cancelJobRun.call(
          { name, id, confirm: field(form, "confirmation") },
          actor,
        );
        messageKey = "jobs.message.cancelled";
        break;
      case "retry":
        await retryJobRun.call(
          { name, id, confirm: field(form, "confirmation") },
          actor,
        );
        messageKey = "jobs.message.retried";
        break;
      case "redrive":
        await redriveJobDeadLetters.call(
          {
            sourceName: field(form, "sourceName") || undefined,
            limit: 1,
            confirm: field(form, "confirmation"),
          },
          actor,
        );
        messageKey = "jobs.message.redriven";
        break;
      default:
        throw new ServiceError("validation", "Choose a background-work action.");
    }
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  revalidatePath("/admin");
  revalidatePath("/admin/jobs");
  if (name && id) revalidatePath(`/admin/jobs/${name}/${id}`);
  const t = await getT();
  return { saved: true, message: t(messageKey) };
}

/* --------------------------------------------- contact data depth (C1.06) */

function optionsOf(form: FormData): string[] {
  return field(form, "options")
    .split(/[\n,]/)
    .map((option) => option.trim())
    .filter(Boolean);
}

export async function createOrganizationAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const organization = await createOrganization.call(
      {
        name: field(form, "name"),
        domain: field(form, "domain") || null,
        customFields: customFieldsOf(form),
      },
      await currentActor(),
    );
    id = organization.id;
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  redirect(`/admin/contacts/organizations/${id}`);
}

export async function updateOrganizationAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateOrganization.call(
      {
        id: field(form, "id"),
        name: field(form, "name"),
        domain: field(form, "domain") || null,
        customFields: customFieldsOf(form),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  return { saved: true };
}

export async function deleteOrganizationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await deleteOrganization.call({ id: field(form, "id") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  redirect("/admin/contacts/organizations");
}

const FIELD_KINDS = ["text", "number", "boolean", "date", "select"] as const;
const FIELD_ENTITIES = ["contact", "organization"] as const;

export async function createCustomFieldAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const kind = field(form, "kind");
  const entity = field(form, "entity");
  try {
    await createCustomField.call(
      {
        entity: FIELD_ENTITIES.includes(entity as (typeof FIELD_ENTITIES)[number])
          ? (entity as (typeof FIELD_ENTITIES)[number])
          : "contact",
        key: field(form, "key"),
        label: field(form, "label"),
        kind: FIELD_KINDS.includes(kind as (typeof FIELD_KINDS)[number])
          ? (kind as (typeof FIELD_KINDS)[number])
          : "text",
        helpText: field(form, "helpText") || null,
        options: optionsOf(form),
        position: Number(field(form, "position", "0")) || 0,
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  redirect("/admin/contacts/fields");
}

export async function updateCustomFieldAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateCustomField.call(
      {
        id: field(form, "id"),
        label: field(form, "label"),
        helpText: field(form, "helpText") || null,
        ...(field(form, "kind") === "select" ? { options: optionsOf(form) } : {}),
        position: Number(field(form, "position", "0")) || 0,
        active: field(form, "active") === "true",
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  redirect("/admin/contacts/fields");
}

const RELATIONSHIP_KINDS = [
  "household",
  "employer",
  "referred_by",
  "partner",
  "guardian",
] as const;

function relationshipKindOf(form: FormData): (typeof RELATIONSHIP_KINDS)[number] {
  const value = field(form, "kind");
  return RELATIONSHIP_KINDS.includes(value as (typeof RELATIONSHIP_KINDS)[number])
    ? (value as (typeof RELATIONSHIP_KINDS)[number])
    : "household";
}

export async function createRelationshipAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const contactId = field(form, "contactId");
  try {
    await createRelationship.call(
      {
        fromContactId: contactId,
        toContactId: field(form, "otherContactId"),
        kind: relationshipKindOf(form),
        since: field(form, "since") || null,
        notes: field(form, "notes") || null,
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  redirect(`/admin/contacts/${contactId}`);
}

export async function updateRelationshipAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const contactId = field(form, "contactId");
  try {
    await updateRelationship.call(
      {
        id: field(form, "id"),
        fromContactId: contactId,
        toContactId: field(form, "otherContactId"),
        kind: relationshipKindOf(form),
        since: field(form, "since") || null,
        notes: field(form, "notes") || null,
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  redirect(`/admin/contacts/${contactId}`);
}

export async function deleteRelationshipAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const contactId = field(form, "contactId");
  try {
    await deleteRelationship.call({ id: field(form, "id") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  revalidatePath(`/admin/contacts/${contactId}`);
  redirect(`/admin/contacts/${contactId}`);
}

/* ------------------------------------------------------------- locations */

/** A number field that may legitimately be blank — coordinates, a radius. */
function optionalNumber(form: FormData, key: string): number | undefined {
  const raw = field(form, key).trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** A text field where blank means "clear it", not "leave it alone". */
function nullable(form: FormData, key: string): string | null {
  return field(form, key).trim() || null;
}

/**
 * Create or change a location (§4.10).
 *
 * One action for both, because the form is the same form: a location being
 * added and a location being edited differ only in whether an id came with
 * it, and two nearly identical actions is how the create path quietly loses a
 * field the edit path gained.
 */
export async function saveLocationAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  const shared = {
    name: field(form, "name"),
    slug: field(form, "slug"),
    street: nullable(form, "street"),
    unit: nullable(form, "unit"),
    city: nullable(form, "city"),
    region: nullable(form, "region"),
    postalCode: nullable(form, "postalCode"),
    country: field(form, "country"),
    latitude: optionalNumber(form, "latitude") ?? null,
    longitude: optionalNumber(form, "longitude") ?? null,
    phone: nullable(form, "phone"),
    email: nullable(form, "email"),
    googleBusinessProfileUrl: nullable(form, "googleBusinessProfileUrl"),
    priceRange: nullable(form, "priceRange"),
    schemaType: nullable(form, "schemaType"),
    status: field(form, "status") === "hidden" ? ("hidden" as const) : ("visible" as const),
    sameAs: field(form, "sameAs")
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter(Boolean),
  };

  // The redirect is deliberately outside the try: `redirect` works by throwing
  // a signal Next catches, so calling it inside would hand every successful
  // create to the error branch and show an owner a failure for a location that
  // saved perfectly. Same shape as mergeContactAction above.
  let createdId: string | null = null;
  try {
    const actor = await currentActor();
    if (id) {
      await updateLocation.call({ id, ...shared }, actor);
    } else {
      createdId = (await createLocation.call(shared, actor)).id;
    }
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  if (createdId) redirect(`/admin/locations/${createdId}`);
  return { saved: true };
}

/** §4.10's primary: the location whose NAP is the business's own. */
export async function setPrimaryLocationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await setPrimaryLocation.call({ id: field(form, "id") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  return { saved: true };
}

export async function deleteLocationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await deleteLocation.call({ id: field(form, "id") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  redirect("/admin/locations");
}

/**
 * A whole week of hours in one save.
 *
 * The form posts seven rows whatever the owner filled in, and a row with no
 * times and no closed box is a day nobody has said anything about — dropped
 * here rather than sent as a half-filled entry the service would reject.
 */
export async function saveOpeningHoursAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const entries: Array<{
    weekday: number;
    opens?: string;
    closes?: string;
    closed: boolean;
  }> = [];

  for (let weekday = 0; weekday < 7; weekday++) {
    const closed = form.get(`closed-${weekday}`) === "on";
    const opens = field(form, `opens-${weekday}`).trim();
    const closes = field(form, `closes-${weekday}`).trim();
    if (closed) {
      entries.push({ weekday, closed: true });
    } else if (opens && closes) {
      entries.push({ weekday, opens, closes, closed: false });
    }
  }

  try {
    await setOpeningHours.call(
      { locationId: field(form, "locationId"), entries },
      await currentActor(),
    );
  } catch (error) {
    return present(error);
  }
  return { saved: true };
}

/** Where the business will travel to, or nowhere (§4.10's ServiceArea). */
export async function saveServiceAreaAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const kind = field(form, "kind");
  const regions = field(form, "regions")
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
  const latitude = optionalNumber(form, "centerLatitude");
  const longitude = optionalNumber(form, "centerLongitude");
  const radiusKm = optionalNumber(form, "radiusKm");

  let area:
    | { kind: "radius"; centerLatitude: number; centerLongitude: number; radiusKm: number }
    | { kind: "regions"; regions: string[] }
    | null = null;
  if (kind === "radius" && latitude !== undefined && longitude !== undefined && radiusKm) {
    area = { kind: "radius", centerLatitude: latitude, centerLongitude: longitude, radiusKm };
  } else if (kind === "regions" && regions.length > 0) {
    area = { kind: "regions", regions };
  }

  try {
    await setServiceArea.call(
      { locationId: field(form, "locationId"), area },
      await currentActor(),
    );
  } catch (error) {
    return present(error);
  }
  return { saved: true };
}

/* -------------------------------------------------------------- api keys */

/**
 * Mint a key (§26).
 *
 * The token comes back in the action state because it is the only moment it
 * exists outside the database — only its hash was stored, so a caller who
 * loses it has to mint another. It is deliberately *not* redirected through,
 * which would put a credential in a URL.
 */
export async function createApiKeyAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  // Each area contributes one value: "none", "read", or "full". The read case
  // expands to the query services of that area, so least privilege is a
  // one-click choice rather than a checklist somebody skips.
  const scopes: string[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("access-") || typeof value !== "string") continue;
    const area = key.slice("access-".length);
    if (value === "full") {
      scopes.push(`${area}.*`);
    } else if (value === "read") {
      const reads = field(form, `reads-${area}`)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      scopes.push(...reads);
    }
  }

  try {
    const days = Number(field(form, "expiresInDays", ""));
    const key = await createApiKey.call(
      {
        name: field(form, "name"),
        scopes,
        expiresInDays: Number.isFinite(days) && days > 0 ? days : undefined,
      },
      await currentActor(),
    );
    // Without this the server component behind this card re-renders from its
    // cached result, and an owner who has just minted a key reads "No keys
    // yet" directly underneath the key they are holding.
    revalidatePath("/admin/settings");
    return { saved: true, message: key.token };
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
}

export async function revokeApiKeyAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await revokeApiKey.call({ id: field(form, "id") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  revalidatePath("/admin/settings");
  return { saved: true };
}

/* --------------------------------------------------------- roles & grants */

function grantsOf(form: FormData) {
  const grants: Array<{
    module: string;
    access: "view" | "manage";
  }> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("grant-") || (value !== "view" && value !== "manage")) {
      continue;
    }
    grants.push({ module: key.slice("grant-".length), access: value });
  }
  return grants;
}

export async function createRoleAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await createRole.call(
      {
        name: field(form, "name"),
        description: field(form, "description"),
        grants: grantsOf(form),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  revalidatePath("/admin/roles");
  return { saved: true };
}

export async function updateRoleAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateRole.call(
      {
        key: field(form, "key"),
        name: field(form, "name"),
        description: field(form, "description"),
        grants: grantsOf(form),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  revalidatePath("/admin/roles");
  return { saved: true };
}

export async function deleteRoleAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await deleteRole.call({ key: field(form, "key") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  revalidatePath("/admin/roles");
  return { saved: true };
}

export async function assignRoleAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await assignRole.call(
      { userId: field(form, "userId"), roleKey: field(form, "roleKey") },
      await currentActor(),
    );
  } catch (error) {
    return present(error);
  }
  revalidatePath("/admin/roles");
  return { saved: true };
}

/* -------------------------------------------------------------- webhooks */

/** Comma- or newline-separated event patterns, as the form collects them. */
function patternsOf(form: FormData): string[] {
  return field(form, "events")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function createWebhookAction(
  previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await createWebhook.call(
      {
        name: field(form, "name"),
        url: field(form, "url"),
        events: patternsOf(form),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(previous, form) };
  }
  revalidatePath("/admin/settings");
  return { saved: true };
}

/**
 * Pause, resume, test, reveal or delete — one action, because they are one
 * row's worth of controls and five near-identical actions is how one of them
 * ends up forgetting to revalidate.
 */
export async function webhookAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  const intent = field(form, "intent");
  try {
    const actor = await currentActor();
    switch (intent) {
      case "pause":
        await updateWebhook.call({ id, status: "paused" }, actor);
        break;
      case "resume":
        await updateWebhook.call({ id, status: "active" }, actor);
        break;
      case "test":
        await testWebhook.call({ id }, actor);
        break;
      case "remove":
        await deleteWebhook.call({ id }, actor);
        break;
      case "reveal": {
        const { secret } = await revealWebhookSecret.call({ id }, actor);
        revalidatePath("/admin/settings");
        return { saved: true, message: secret };
      }
      default:
        return { error: "Unknown action." };
    }
  } catch (error) {
    return present(error);
  }
  revalidatePath("/admin/settings");
  return { saved: true };
}
