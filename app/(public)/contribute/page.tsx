// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public hub form (C1.31). Hidden when this instance is not a hub.
import type { Metadata } from "next";
import { getT } from "../../i18n";
import { contributeHubStatus } from "@/core/contribute/service";
import { submitPublicContribution } from "../contribute-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("contribute.public.title") };
}

export default async function PublicContributePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; closed?: string }>;
}) {
  const [t, settings, params] = await Promise.all([
    getT(),
    contributeHubStatus.call({}, { kind: "anonymous" }),
    searchParams,
  ]);

  if (params.sent) {
    return (
      <div className="grid gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("contribute.public.title")}
        </h1>
        <p className="max-w-prose text-ink">{t("contribute.public.thanks")}</p>
      </div>
    );
  }

  if (!settings.hubEnabled) {
    return (
      <div className="grid gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("contribute.public.title")}
        </h1>
        <p className="max-w-prose text-ink-muted">{t("contribute.public.closed")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("contribute.public.title")}
        </h1>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          {t("contribute.public.intro")}
        </p>
      </div>
      {params.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {t("contribute.public.error")}
        </p>
      ) : null}
      {params.closed ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {t("contribute.public.closed")}
        </p>
      ) : null}
      <form action={submitPublicContribution} className="grid max-w-xl gap-4">
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.kind")}
          </span>
          <select
            name="kind"
            defaultValue="bug"
            required
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          >
            <option value="bug">{t("contribute.kind.bug")}</option>
            <option value="feature">{t("contribute.kind.feature")}</option>
            <option value="patch">{t("contribute.kind.patch")}</option>
            <option value="docs">{t("contribute.kind.docs")}</option>
            <option value="question">{t("contribute.kind.question")}</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.field.title")}
          </span>
          <input
            name="title"
            required
            maxLength={200}
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.field.body")}
          </span>
          <textarea
            name="body"
            required
            maxLength={20_000}
            rows={8}
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.field.email")}
          </span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.field.name")}
          </span>
          <input
            name="name"
            autoComplete="name"
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input name="dcoAttested" type="checkbox" className="mt-1" />
          <span>{t("contribute.field.dco")}</span>
        </label>
        <label className="grid gap-1.5">
          <span className="font-mono text-xs font-medium text-ink-muted">
            {t("contribute.field.dcoSigner")}
          </span>
          <input
            name="dcoSigner"
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
        >
          {t("contribute.submit")}
        </button>
      </form>
    </div>
  );
}
