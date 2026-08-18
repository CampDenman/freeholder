// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import { ingestContribution } from "@/core/contribute/service";
import { getLocale } from "../i18n";

const ANONYMOUS = { kind: "anonymous" } as const;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitPublicContribution(form: FormData): Promise<void> {
  const locale = await getLocale();
  try {
    await ingestContribution.call(
      {
        kind: text(form, "kind") as
          | "bug"
          | "feature"
          | "patch"
          | "docs"
          | "question",
        title: text(form, "title"),
        body: text(form, "body"),
        email: text(form, "email") || undefined,
        name: text(form, "name") || undefined,
        externalUrl: text(form, "externalUrl") || undefined,
        dcoAttested: form.get("dcoAttested") === "on",
        dcoSigner: text(form, "dcoSigner") || undefined,
        locale,
        source: "public_form",
      },
      ANONYMOUS,
    );
    redirect("/contribute?sent=1");
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error) throw error;
    if (error instanceof ServiceError && error.code === "not_found") {
      redirect("/contribute?closed=1");
    }
    redirect("/contribute?error=1");
  }
}
