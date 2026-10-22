// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: where the public playground sends a visitor who follows a link into
// an area it cannot show. It used to bounce them to the overview without a
// word, which reads as a broken product rather than a deliberate boundary.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockSimple } from "@phosphor-icons/react/dist/ssr";
import { Callout } from "@/ui/primitives";
import { env } from "@/core/env";
import { PLAYGROUND_UNAVAILABLE } from "@/core/demo/playground-policy";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("playground.unavailable.title"), robots: { index: false, follow: false } };
}

export default async function PlaygroundUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string | string[] }>;
}) {
  await requireStaffActor();
  if (env().FREEHOLDER_PLAYGROUND !== "1") redirect("/admin");
  const [t, query] = await Promise.all([getT(), searchParams]);
  const requested = Array.isArray(query.module) ? query.module[0] : query.module;
  // Only a known area gets its own sentence; anything else — including a
  // hand-typed value — gets the general one, so nothing from the URL is
  // echoed onto the page.
  const known = (PLAYGROUND_UNAVAILABLE as readonly string[]).includes(requested ?? "")
    ? requested
    : undefined;

  return (
    <div className="grid max-w-prose gap-4">
      <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <LockSimple size={22} weight="duotone" className="text-accent" />
        {t("playground.unavailable.title")}
      </h1>
      <p className="text-ink-muted">
        {known
          ? t(`playground.unavailable.module.${known}`)
          : t("playground.unavailable.general")}
      </p>
      <Callout>{t("playground.unavailable.why")}</Callout>
      <div className="flex flex-wrap gap-4 text-sm">
        <a className="font-medium text-accent underline" href="/admin">
          {t("playground.unavailable.back")}
        </a>
        <a className="font-medium text-accent underline" href="https://github.com/CampDenman/freeholder">
          {t("playground.unavailable.run")}
        </a>
      </div>
    </div>
  );
}
