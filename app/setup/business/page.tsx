// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// §13 steps 2–3: who the business is, and where it operates.
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { Steps } from "../Steps";
import { BusinessForm } from "./BusinessForm";

export const dynamic = "force-dynamic";

export default async function SetupBusinessPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  if (state.completed) redirect("/");
  if (!state.hasOwner) redirect("/setup");

  return (
    <>
      <Steps current={1} />
      <h1 className="text-2xl font-bold tracking-tight">
        Tell us about the business
      </h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-muted">
        Your country fills in the rest. Everything here appears on your public
        site, and you can change any of it later.
      </p>
      <BusinessForm />
    </>
  );
}
