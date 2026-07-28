// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// §13 step 1: the owner account. Public by necessity — nobody can be signed in
// on a fresh install — and once-only by database constraint, not by obscurity.
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { Steps } from "./Steps";
import { OwnerForm } from "./OwnerForm";

export const dynamic = "force-dynamic";

export default async function SetupOwnerPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  if (state.completed) redirect("/");
  if (state.hasOwner) redirect("/setup/business");

  return (
    <>
      <Steps current={0} />
      <h1 className="text-2xl font-bold tracking-tight">
        Create your owner account
      </h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-muted">
        This is the account that owns the site. It can only be created once, so
        keep the details somewhere safe.
      </p>
      <OwnerForm />
    </>
  );
}
