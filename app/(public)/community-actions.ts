// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import {
  createCommunityPostBySlug,
  joinCommunityBySlug,
  reportCommunityPostBySlug,
  requestCommunityJoinBySlug,
} from "../../plugins/community/service";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function communityPath(slug: string): string {
  return `/community/${encodeURIComponent(slug)}`;
}

async function communityActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function fail(path: string, error: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
  throw error;
}

export async function joinCommunityPublicAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  const path = communityPath(slug);
  try {
    await joinCommunityBySlug.call(
      {
        slug,
        email: text(form, "email"),
        name: text(form, "name"),
      },
      await communityActor(),
    );
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?saved=1`);
}

export async function requestCommunityJoinPublicAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  const path = communityPath(slug);
  try {
    await requestCommunityJoinBySlug.call(
      {
        slug,
        email: text(form, "email"),
        name: text(form, "name"),
      },
      await communityActor(),
    );
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}?requested=1`);
}

export async function createCommunityPostPublicAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  const path = communityPath(slug);
  try {
    await createCommunityPostBySlug.call(
      {
        slug,
        roomSlug: text(form, "roomSlug"),
        body: text(form, "body"),
      },
      await communityActor(),
    );
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}${path.includes("?") ? "&" : "?"}saved=1`);
}

export async function reportCommunityPostPublicAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  const email = text(form, "email");
  const path = communityPath(slug);
  try {
    await reportCommunityPostBySlug.call(
      {
        slug,
        postId: text(form, "postId"),
        email,
        name: text(form, "name"),
      },
      await communityActor(),
    );
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}${path.includes("?") ? "&" : "?"}reported=1`);
}
