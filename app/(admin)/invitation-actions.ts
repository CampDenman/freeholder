// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Browser actions for the staff invitation lifecycle (MASTER.md §43 C1.02).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "@/core/auth/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import {
  acceptInvitation,
  createInvitation,
  resendInvitation,
  revokeInvitation,
} from "@/core/invitations/service";
import { ServiceError } from "@/core/service";
import { revalidatePath } from "next/cache";

export interface InvitationActionState {
  error?: string;
  saved?: boolean;
  delivery?: "sent" | "logged";
  values?: { email?: string; roleKey?: string; expiresInDays?: string };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function present(error: unknown): InvitationActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("invitation action failed", error);
  return { error: "Something went wrong. Try again." };
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function createInvitationAction(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  const values = {
    email: field(form, "email"),
    roleKey: field(form, "roleKey"),
    expiresInDays: field(form, "expiresInDays"),
  };
  try {
    const result = await createInvitation.call(
      {
        email: values.email,
        roleKey: values.roleKey,
        expiresInDays: Number(values.expiresInDays),
      },
      await currentActor(),
    );
    revalidatePath("/admin/invitations");
    return { saved: true, delivery: result.delivery };
  } catch (error) {
    return { ...present(error), values };
  }
}

export async function resendInvitationAction(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  try {
    const result = await resendInvitation.call(
      { id: field(form, "id") },
      await currentActor(),
    );
    revalidatePath("/admin/invitations");
    return { saved: true, delivery: result.delivery };
  } catch (error) {
    return present(error);
  }
}

export async function revokeInvitationAction(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  try {
    await revokeInvitation.call(
      { id: field(form, "id") },
      await currentActor(),
    );
    revalidatePath("/admin/invitations");
    return { saved: true };
  } catch (error) {
    return present(error);
  }
}

export async function acceptInvitationAction(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  const password = field(form, "password");
  if (password !== field(form, "passwordConfirm")) {
    return { error: "The passwords do not match." };
  }

  let session: Awaited<ReturnType<typeof login.call>>;
  try {
    const accepted = await acceptInvitation.call(
      { token: field(form, "token"), password },
      { kind: "anonymous" },
    );
    session = await login.call(
      { email: accepted.email, password },
      { kind: "anonymous" },
    );
  } catch (error) {
    return present(error);
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: session.expiresAt,
  });
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: session.expiresAt,
  });
  redirect("/admin");
}
