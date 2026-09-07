// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import { joinCommunityBySlug } from "../../plugins/community/service";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function joinCommunityPublicAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  const path = `/community/${encodeURIComponent(slug)}`;
  try {
    await joinCommunityBySlug.call(
      {
        slug,
        email: text(form, "email"),
        name: text(form, "name"),
      },
      { kind: "anonymous" },
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      redirect(`${path}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  redirect(`${path}?saved=1`);
}
