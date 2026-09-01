// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Saved report views. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { deleteReportView, saveReportView } from "@/modules/reporting/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function done(query: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/reports?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("report action failed");
  redirect(`/admin/reports?${query}`);
}

export async function saveReportViewAction(form: FormData): Promise<void> {
  const caller = await actor();
  // The parameters come back from the page that produced them rather than
  // being retyped, so what is saved is the question actually on screen.
  const params: Record<string, unknown> = {};
  const days = Number(text(form, "days"));
  if (Number.isFinite(days) && days > 0) params.days = days;
  const dimension = text(form, "dimension");
  if (dimension) params.dimension = dimension;

  try {
    await saveReportView.call(
      {
        name: text(form, "name"),
        key: text(form, "key") as "revenue" | "revenueBy" | "cohort" | "funnel",
        params,
      },
      caller,
    );
  } catch (error) {
    done("", error);
  }
  done("saved=1");
}

export async function deleteReportViewAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await deleteReportView.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done("", error);
  }
  done("deleted=1");
}
