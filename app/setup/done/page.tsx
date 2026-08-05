// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// §13: the wizard locks once this is confirmed, so it cannot be replayed
// against a live site.
import { redirect } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { getBusiness, setupState } from "@/core/settings/service";
import { Callout } from "@/ui/primitives";
import { getT } from "../../i18n";
import { Steps } from "../Steps";
import { DoneForm } from "./DoneForm";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function SetupDonePage() {
  const state = await setupState.call({}, ANONYMOUS);
  if (state.completed) redirect("/");
  if (!state.hasOwner) redirect("/setup");
  if (!state.hasBusiness) redirect("/setup/business");

  const [business, t] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    getT(),
  ]);

  return (
    <>
      <Steps current={3} />
      <h1 className="text-2xl font-bold tracking-tight">
        {t("setup.done.title", { name: business?.name ?? "" })}
      </h1>
      <p className="mt-2 mb-6 max-w-prose text-ink-muted">
        {t("setup.done.intro")}
      </p>
      <div className="mb-8">
        <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
          {t("setup.done.summary", {
            locales: business?.enabledLocales.join(", ") ?? "",
            currency: business?.baseCurrency ?? "",
            timezone: business?.timezone ?? "",
          })}
        </Callout>
      </div>
      <DoneForm
        labels={{
          submit: t("setup.done.submit"),
          pending: t("setup.done.pending"),
        }}
      />
    </>
  );
}
