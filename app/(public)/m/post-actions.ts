// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04: posting, commenting, reacting and answering tags.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { answerTag, commentOnPost, createPost, deleteComment, deletePost, reactToPost } from "@/modules/members/posts";
import { VISIBILITIES, type Visibility } from "@/modules/members/visibility";
import { pinPost } from "@/modules/members/profile";

const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Return only to the feed or a post page, never to a supplied URL. */
function back(form: FormData): string {
  const to = text(form, "back");
  return /^\/(feed|p\/[0-9a-f-]{36})$/.test(to) ? to : "/feed";
}

async function run(form: FormData, work: (actor: Awaited<ReturnType<typeof actorFromToken>>) => Promise<unknown>, done = back(form)): Promise<never> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await work(actor);
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${back(form)}?error=${error.code}`);
    throw error;
  }
  redirect(done);
}

export async function createPostAction(form: FormData): Promise<void> {
  const visibility = text(form, "visibility");
  await run(form, (actor) =>
    createPost.call(
      {
        body: text(form, "body"),
        visibility: (VISIBILITIES as readonly string[]).includes(visibility) ? (visibility as Visibility) : undefined,
        repostOf: text(form, "repostOf") || undefined,
        adult: form.get("adult") === "yes",
        tag: text(form, "tag").split(/[\s,]+/).map((h) => h.replace(/^@/, "")).filter(Boolean),
      },
      actor,
    ),
  );
}

export async function pinPostAction(form: FormData): Promise<void> {
  await run(form, (actor) => pinPost.call({ postId: text(form, "id"), pinned: true }, actor));
}

export async function deletePostAction(form: FormData): Promise<void> {
  await run(form, (actor) => deletePost.call({ id: text(form, "id") }, actor), "/feed");
}

export async function commentAction(form: FormData): Promise<void> {
  await run(form, (actor) =>
    commentOnPost.call({ postId: text(form, "postId"), parentId: text(form, "parentId") || undefined, body: text(form, "body") }, actor),
  );
}

export async function deleteCommentAction(form: FormData): Promise<void> {
  await run(form, (actor) => deleteComment.call({ id: text(form, "id") }, actor));
}

export async function reactAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  await run(form, (actor) =>
    reactToPost.call(
      { postId: text(form, "postId"), kind: (REACTIONS as readonly string[]).includes(kind) ? (kind as (typeof REACTIONS)[number]) : null },
      actor,
    ),
  );
}

export async function answerTagAction(form: FormData): Promise<void> {
  await run(form, (actor) => answerTag.call({ mentionId: text(form, "mentionId"), approve: text(form, "approve") === "yes" }, actor));
}
