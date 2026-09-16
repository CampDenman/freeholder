// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's message templates. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { resetTemplate, saveTemplate } from "@/modules/newsletters/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

function done(id: string | null, error?: unknown): never {
  const base = id ? `/admin/newsletters/templates?template=${id}` : "/admin/newsletters/templates";
  if (error instanceof ServiceError) {
    redirect(`${base}${id ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("template action failed");
  redirect(`${base}${id ? "&" : "?"}saved=1`);
}

/**
 * The body, as one paragraph.
 *
 * §30 wants these edited in the drag-and-drop block editor, and that editor is
 * a page-scale surface this screen does not embed. A textarea that produces a
 * single `text` block is the honest interim: it writes a real block tree the
 * real renderer understands, so nothing has to be migrated when the editor
 * arrives — the same tree simply gains more blocks.
 */
function bodyBlocks(value: string): Array<Record<string, unknown>> {
  return value.length > 0 ? [{ type: "text", props: { body: value } }] : [];
}

export async function saveTemplateAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = optional(form, "id");
  const slots = form
    .getAll("variables")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  try {
    const saved = await saveTemplate.call(
      {
        ...(id ? { id } : {}),
        kind: text(form, "kind") as
          | "transactional"
          | "campaign"
          | "newsletter"
          | "automation"
          | "sms",
        name: text(form, "name"),
        slug: optional(form, "slug"),
        subject: text(form, "subject"),
        blocks: bodyBlocks(text(form, "body")),
        variables: slots as never,
        status: (text(form, "status") || "draft") as "draft" | "active" | "archived",
      },
      caller,
    );
    revalidatePath("/admin/newsletters/templates");
    done(saved.id);
  } catch (error) {
    done(id, error);
  }
}

export async function resetTemplateAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await resetTemplate.call({ id }, caller);
  } catch (error) {
    done(id, error);
  }
  revalidatePath("/admin/newsletters/templates");
  done(id);
}
