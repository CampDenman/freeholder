// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// §13 step 4: "Location / NAP — optional: address or service area, phone,
// hours → primary BusinessLocation".
//
// *Optional* is the whole design of this screen. §4.10 is explicit that "a
// purely online creator skips this and no empty local scaffolding appears", so
// skipping is a real button beside the save one rather than a link in small
// print — and skipping writes nothing at all, which is what makes the promise
// about scaffolding true.
import { redirect } from "next/navigation";
import { setupState } from "@/core/settings/service";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../i18n";
import { Steps } from "../Steps";
import { LocationStepForm } from "./LocationStepForm";

export const dynamic = "force-dynamic";

export default async function SetupLocationPage() {
  const state = await setupState.call({}, { kind: "anonymous" });
  if (state.completed) redirect("/");
  if (!state.hasOwner) redirect("/setup");
  if (!state.hasBusiness) redirect("/setup/business");

  const [t, business] = await Promise.all([getT(), currentBusiness()]);

  return (
    <>
      <Steps current={2} />
      <h1 className="text-2xl font-bold tracking-tight">
        {t("setup.location.title")}
      </h1>
      <p className="mt-2 mb-8 max-w-prose text-ink-muted">
        {t("setup.location.intro")}
      </p>
      <LocationStepForm
        defaults={{
          name: business?.name ?? "",
          country: business?.country ?? "",
        }}
        labels={{
          name: t("locations.field.name"),
          street: t("locations.field.street"),
          city: t("locations.field.city"),
          region: t("locations.field.region"),
          postalCode: t("locations.field.postalCode"),
          country: t("locations.field.country"),
          countryHint: t("locations.field.countryHint"),
          phone: t("locations.field.phone"),
          phoneHint: t("locations.field.phoneHint"),
          submit: t("setup.location.submit"),
          skip: t("setup.location.skip"),
          pending: t("common.saving"),
        }}
      />
    </>
  );
}
