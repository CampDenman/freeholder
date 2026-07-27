// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// §13: the wizard locks once this is confirmed, so it cannot be replayed
// against a live site.
import { redirect } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { getBusiness, setupState } from "@/core/settings/service";
import { Callout } from "@/ui/primitives";
import { Steps } from "../Steps";
import { DoneForm } from "./DoneForm";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function SetupDonePage() {
  const state = await setupState.call({}, ANONYMOUS);
  if (state.completed) redirect("/");
  if (!state.hasOwner) redirect("/setup");
  if (!state.hasBusiness) redirect("/setup/business");

  const business = await getBusiness.call({}, ANONYMOUS);

  return (
    <>
      <Steps current={2} />
      <h1 className="text-2xl font-bold tracking-tight">
        {business?.name} is ready
      </h1>
      <p className="mt-2 mb-6 max-w-prose text-ink-muted">
        Finishing locks this wizard, so nobody can walk through it again on a
        live site. Your settings stay editable from the admin.
      </p>
      <div className="mb-8">
        <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
          Publishing in {business?.enabledLocales.join(", ")}, charging in{" "}
          {business?.baseCurrency}, showing times in {business?.timezone}.
        </Callout>
      </div>
      <DoneForm />
    </>
  );
}
