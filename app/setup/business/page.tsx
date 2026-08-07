// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// §13 steps 2–3: who the business is, and where it operates.
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { getLocale, getT } from "../../i18n";
import { businessFormLabels, businessOptions } from "../businessLabels";
import { Steps } from "../Steps";
import { BusinessForm } from "./BusinessForm";

export const dynamic = "force-dynamic";

export default async function SetupBusinessPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  if (state.completed) redirect("/");
  if (!state.hasOwner) redirect("/setup");

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  return (
    <>
      <Steps current={1} />
      <h1 className="text-2xl font-bold tracking-tight">
        {t("setup.business.title")}
      </h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-muted">
        {t("setup.business.intro")}
      </p>
      <BusinessForm
        labels={{
          ...businessFormLabels(t),
          submit: t("setup.business.submit"),
          pending: t("common.saving"),
        }}
        options={businessOptions(locale, t)}
      />
    </>
  );
}
