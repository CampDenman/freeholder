// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { getT } from "../../../i18n";
import { ConfirmMagicLink } from "./ConfirmMagicLink";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConfirmMagicLinkPage() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">{t("portal.magic.title")}</h1>
      <p className="mt-2 mb-8 text-ink-muted">{t("portal.magic.intro")}</p>
      <ConfirmMagicLink labels={{
        confirm: t("portal.magic.confirm"),
        pending: t("portal.magic.pending"),
      }} />
    </main>
  );
}
