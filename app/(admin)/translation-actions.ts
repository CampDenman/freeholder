// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Writing a translation (MASTER.md §4.9). Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";

export interface TranslationActionState {
  error?: string;
  saved?: boolean;
}

function ownerFacing(message: string): string {
  return message.replace(/^[a-z][\w.]*: (?:[\w.[\]]+: )?/, "");
}

/**
 * Save one page's translation into one locale.
 *
 * The form posts translated *strings*, keyed by the path each came from, and
 * the translated block tree is rebuilt here from the current source tree
 * rather than round-tripped through the browser. That is deliberate: it means
 * a translator's stale tab cannot resurrect a block the owner deleted while
 * they were typing, and it means what gets stored is always a tree the block
 * validator accepts.
 */
export async function saveTranslationAction(
  _previous: TranslationActionState,
  form: FormData,
): Promise<TranslationActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );

  // A FormData value is a string or a File, and only one of those is an id.
  const text = (key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };

  const entityId = text("entityId");
  const locale = text("locale");
  const reviewed = form.get("reviewed") !== null;

  // `t.<path>` — everything else on the form is machinery.
  const values: Record<string, string> = {};
  let title = "";
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (name === "t.title") title = value;
    else if (name.startsWith("t.")) values[name.slice(2)] = value;
  }

  try {
    const [{ getPage }, { setTranslation }, { applyTranslations }, { parseBlockTree }] =
      await Promise.all([
        import("@/modules/cms/service"),
        import("@/core/i18n/service"),
        import("@/modules/cms/translate"),
        import("@/modules/cms/blocks/registry"),
      ]);

    const page = await getPage.call({ id: entityId }, actor);
    const source = parseBlockTree(page.blocks, "page");

    await setTranslation.call(
      {
        entityType: "page",
        entityId,
        locale,
        fields: {
          ...(title.trim() ? { title: title.trim() } : {}),
          blocks: applyTranslations(source, values),
        },
        status: reviewed ? "reviewed" : "draft",
      },
      actor,
    );
  } catch (error) {
    const { ServiceError } = await import("@/core/service");
    if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
    console.error("saveTranslationAction failed", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/admin/translations", "layout");
  return { saved: true };
}
