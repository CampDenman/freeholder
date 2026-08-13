// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// §13 step 1: the owner account. Public by necessity — nobody can be signed in
// on a fresh install — and once-only by database constraint, not by obscurity.
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { getT } from "../i18n";
import { Steps } from "./Steps";
import { OwnerForm } from "./OwnerForm";

export const dynamic = "force-dynamic";

export default async function SetupOwnerPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  // A seeded demo has a complete business but deliberately no owner. It must
  // still be claimable through the ordinary first-owner screen; otherwise a
  // fresh development instance serves a useful public site but leaves its
  // admin reachable only through the raw API used by CI.
  if (state.hasOwner) {
    if (state.completed) redirect("/");
    redirect("/setup/business");
  }

  const t = await getT();

  return (
    <>
      <Steps current={0} />
      <h1 className="text-2xl font-bold tracking-tight">
        {t("setup.owner.title")}
      </h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-muted">
        {t("setup.owner.intro")}
      </p>
      <OwnerForm
        labels={{
          email: t("setup.owner.email"),
          emailHint: t("setup.owner.emailHint"),
          emailPlaceholder: t("setup.owner.emailPlaceholder"),
          password: t("setup.owner.password"),
          passwordHint: t("setup.owner.passwordHint"),
          submit: t("setup.owner.submit"),
          pending: t("setup.owner.pending"),
        }}
      />
    </>
  );
}
