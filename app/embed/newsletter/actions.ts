// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import { subscribeToNewsletter } from "@/modules/newsletters/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function embedSubscribeAction(form: FormData): Promise<void> {
  const id = text(form, "newsletterId");
  try {
    await subscribeToNewsletter.call(
      { newsletterId: id, email: text(form, "email") },
      { kind: "anonymous" },
    );
  } catch (error) {
    const message = error instanceof ServiceError ? error.message : "That did not work.";
    redirect(`/embed/newsletter/${encodeURIComponent(id)}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/embed/newsletter/${encodeURIComponent(id)}?saved=1`);
}
