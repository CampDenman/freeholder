// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for saved views (C7.06). The ownership rule — shared means
// visible, never editable — and the one-default-per-person rule both live in
// `core/views`, so a view saved from a list behaves the same as one posted over
// the API.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { removeView, saveView, setDefaultView } from "@/core/views/service";
import { ownerFacing } from "./action-helpers";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Where the list this was posted from lives.
 *
 * Carried on the form rather than mapped here, because one component serves
 * every list. Anything that is not an internal path is refused, so a crafted
 * form cannot use the redirect to send somebody off the site.
 */
function listPath(form: FormData): string {
  const value = text(form, "path");
  return /^\/(?!\/)[\w\-/[\]().]*$/.test(value) ? value : "/admin";
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * The current URL's parameters, as the view's filters.
 *
 * They arrive as hidden inputs the bar rendered from what it was given, so what
 * gets saved is exactly what the person is looking at — not a re-derivation
 * that could differ by one parameter nobody noticed.
 */
function filtersFrom(form: FormData): Record<string, string> {
  const keys = form.getAll("filterKey").map(String);
  const values = form.getAll("filterValue").map(String);
  const filters: Record<string, string> = {};
  keys.forEach((key, index) => {
    const value = values[index];
    if (key && typeof value === "string" && value.length > 0) filters[key] = value;
  });
  return filters;
}

export async function saveViewAction(form: FormData): Promise<void> {
  const path = listPath(form);
  const filters = filtersFrom(form);
  try {
    await saveView.call(
      {
        entity: text(form, "entity"),
        name: text(form, "name"),
        filters,
        columns: form
          .getAll("columns")
          .filter((value): value is string => typeof value === "string" && value.length > 0),
        shared: text(form, "shared") === "on",
        isDefault: text(form, "isDefault") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That view could not be kept.");
  }
  revalidatePath(path);
  // Straight back to the list they were looking at, with it still applied.
  const query = new URLSearchParams(filters);
  query.set("saved", "view");
  redirect(`${path}?${query.toString()}`);
}

export async function removeViewAction(form: FormData): Promise<void> {
  const path = listPath(form);
  try {
    await removeView.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, path, "That view could not be forgotten.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=view`);
}

export async function setDefaultViewAction(form: FormData): Promise<void> {
  const path = listPath(form);
  try {
    await setDefaultView.call(
      { entity: text(form, "entity"), id: text(form, "id") || null },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That could not be made the default.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=view`);
}
