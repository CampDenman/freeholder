// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// §13: the wizard locks once this is confirmed, so it cannot be replayed
// against a live site.
import { redirect } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { getBusiness, setupState } from "@/core/settings/service";
import { Callout } from "@/ui/primitives";
import { getT } from "../../i18n";
import { Steps } from "../Steps";
import { DoneForm } from "./DoneForm";
import { MailReadiness } from "./MailReadiness";
import { mailConfigurationStatus } from "@/adapters/mail";
import { env } from "@/core/env";

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
      <div className="mb-8">
        <MailReadiness
          configuration={mailConfigurationStatus()}
          appUrl={env().APP_URL}
          labels={{
            title: t("setup.mail.title"),
            intro: t("setup.mail.intro"),
            account: t("setup.mail.account"),
            broadcast: t("setup.mail.broadcast"),
            configured: t("setup.mail.configured"),
            pending: t("setup.mail.pending"),
            disabled: t("setup.mail.disabled"),
            accountSmtp: t("setup.mail.accountSmtp"),
            accountOauth: t("setup.mail.accountOauth"),
            accountMissing: t("setup.mail.accountMissing"),
            accountVariables: t("setup.mail.accountVariables"),
            bulkDisabled: t("setup.mail.bulkDisabled"),
            bulkReady: t("setup.mail.bulkReady"),
            feedbackMissing: t("setup.mail.feedbackMissing"),
            webhook: t("setup.mail.webhook"),
            sesSecurity: t("setup.mail.sesSecurity"),
            next: t("setup.mail.next"),
          }}
        />
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
