// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { resetDesign, updateDesign } from "@/core/design/service";

export interface DesignActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function saveDesignAction(
  _previous: DesignActionState,
  form: FormData,
): Promise<DesignActionState> {
  try {
    await updateDesign.call(
      {
        colors: {
          light: {
            accent: emptyToNull(text(form, "lightAccent")) ?? undefined,
            paper: emptyToNull(text(form, "lightPaper")) ?? undefined,
            ink: emptyToNull(text(form, "lightInk")) ?? undefined,
          },
          dark: {
            accent: emptyToNull(text(form, "darkAccent")) ?? undefined,
            paper: emptyToNull(text(form, "darkPaper")) ?? undefined,
            ink: emptyToNull(text(form, "darkInk")) ?? undefined,
          },
        },
        fontSans: emptyToNull(text(form, "fontSans")),
        fontMono: emptyToNull(text(form, "fontMono")),
        radius: emptyToNull(text(form, "radius")),
        motion: emptyToNull(text(form, "motion")),
        measure: emptyToNull(text(form, "measure")),
        gutter: emptyToNull(text(form, "gutter")),
        logoAssetId: emptyToNull(text(form, "logoAssetId")),
      },
      await currentActor(),
    );
    revalidatePath("/", "layout");
    return { saved: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("design action failed", error);
    return { error: "Something went wrong. Try again." };
  }
}

export async function resetDesignAction(): Promise<void> {
  await resetDesign.call({}, await currentActor());
  revalidatePath("/", "layout");
}
