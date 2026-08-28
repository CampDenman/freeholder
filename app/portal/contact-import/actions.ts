// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import {
  beginSignupContactsOAuth,
  commitSignupContactImport,
  disconnectSignupContacts,
  revertSignupContactImport,
  skipSignupContactImport,
  stageDeviceContacts,
  stageSignupContactFile,
  stageSignupProviderContacts,
} from "@/core/import/signup-contact-service";
import { SIGNUP_CONTACT_IMPORT_FIELDS } from "@/core/import/contacts-schema";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";

const ROOT = "/portal/contact-import";

export interface ContactImportActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fields(form: FormData) {
  const selected = form
    .getAll("field")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => (SIGNUP_CONTACT_IMPORT_FIELDS as readonly string[]).includes(value));
  return [...new Set(["email", ...selected])] as Array<
    (typeof SIGNUP_CONTACT_IMPORT_FIELDS)[number]
  >;
}

async function actor() {
  const resolved = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return {
    ...resolved,
    request: requestMetadataFromHeaders(await headers()),
  };
}

async function href(path: string): Promise<string> {
  const [locale, business] = await Promise.all([getLocale(), currentBusiness()]);
  return localizeCustomerHref(path, locale, {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  });
}

function message(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  console.error("portal contact import action failed", error);
  return "The contact import could not be changed. Try again.";
}

export async function stageContactFileAction(form: FormData): Promise<void> {
  const file = form.get("file");
  let batch: { id: string };
  try {
    if (!(file instanceof File) || file.size === 0) {
      throw new ServiceError("validation", "Choose a file to preview.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new ServiceError("validation", "That file is larger than 5 MB.");
    }
    const source = text(form, "source");
    if (source !== "csv" && source !== "vcard") {
      throw new ServiceError("validation", "Choose CSV or vCard.");
    }
    batch = await stageSignupContactFile.call(
      { source, filename: file.name, content: await file.text(), fields: fields(form) },
      await actor(),
    );
  } catch (error) {
    redirect(`${await href(ROOT)}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(ROOT);
  redirect(await href(`${ROOT}/${batch!.id}`));
}

export async function stageDeviceContactsAction(
  _previous: ContactImportActionState,
  form: FormData,
): Promise<ContactImportActionState> {
  let contacts: unknown;
  try {
    const raw = text(form, "contacts");
    if (raw.length > 300_000) throw new ServiceError("validation", "That selection is too large.");
    contacts = JSON.parse(raw);
    const batch = await stageDeviceContacts.call(
      { contacts, fields: fields(form) },
      await actor(),
    );
    revalidatePath(ROOT);
    redirect(await href(`${ROOT}/${batch.id}`));
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
    return { error: message(error) };
  }
}

export async function beginContactsOAuthAction(form: FormData): Promise<void> {
  const provider = text(form, "provider");
  try {
    if (provider !== "google" && provider !== "microsoft") {
      throw new ServiceError("validation", "Choose Google or Microsoft.");
    }
    const result = await beginSignupContactsOAuth.call({ provider }, await actor());
    redirect(result.authorizationUrl);
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
    redirect(`${await href(ROOT)}?error=${encodeURIComponent(message(error))}`);
  }
}

export async function stageProviderContactsAction(form: FormData): Promise<void> {
  try {
    const batch = await stageSignupProviderContacts.call(
      {
        accountId: text(form, "accountId"),
        externalIds: form
          .getAll("externalId")
          .filter((value): value is string => typeof value === "string"),
      },
      await actor(),
    );
    revalidatePath(ROOT);
    redirect(await href(`${ROOT}/${batch.id}`));
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
    redirect(`${await href(ROOT)}?error=${encodeURIComponent(message(error))}`);
  }
}

export async function commitSignupImportAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    await commitSignupContactImport.call({ id }, await actor());
  } catch (error) {
    redirect(`${await href(`${ROOT}/${id}`)}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(ROOT);
  revalidatePath(`${ROOT}/${id}`);
  redirect(`${await href(`${ROOT}/${id}`)}?saved=committed`);
}

export async function revertSignupImportAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    await revertSignupContactImport.call({ id }, await actor());
  } catch (error) {
    redirect(`${await href(`${ROOT}/${id}`)}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(ROOT);
  revalidatePath(`${ROOT}/${id}`);
  redirect(`${await href(`${ROOT}/${id}`)}?saved=reverted`);
}

export async function skipSignupImportAction(form: FormData): Promise<void> {
  try {
    await skipSignupContactImport.call(
      { id: text(form, "id") || undefined },
      await actor(),
    );
  } catch (error) {
    redirect(`${await href(ROOT)}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(ROOT);
  redirect(await href("/portal/privacy"));
}

export async function disconnectSignupContactsAction(form: FormData): Promise<void> {
  try {
    await disconnectSignupContacts.call({ accountId: text(form, "accountId") }, await actor());
  } catch (error) {
    redirect(`${await href(ROOT)}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(ROOT);
  redirect(`${await href(ROOT)}?saved=disconnected`);
}
