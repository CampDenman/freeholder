// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { Newspaper, Plus } from "@phosphor-icons/react/dist/ssr";
import { listNewsletters } from "@/modules/newsletters/service";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { newsletterAction } from "../../newsletter-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function NewslettersPage() {
  const actor = await requireStaffActor("newsletters");
  const [rows, t] = await Promise.all([listNewsletters.call({}, actor), getT()]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Newspaper size={22} weight="duotone" className="text-accent" />
          {t("newsletters.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("newsletters.intro")}</p>
      </div>

      {/* The two screens that live under this one. The nav (§43's admin shell)
          carries top-level sections only, so a page nobody links to is a page
          nobody finds — which is exactly what happened to templates until a
          campaign needed one. */}
      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link href="/admin/newsletters/broadcasts" className="underline">
          {t("broadcasts.title")}
        </Link>
        <Link href="/admin/newsletters/templates" className="underline">
          {t("templates.title")}
        </Link>
      </nav>

      <Card>
        <CardHeader title={t("newsletters.add")} />
        <CardBody>
          <form action={newsletterAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <Field label={t("newsletters.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={200} />
            </Field>
            <Field label={t("newsletters.slug")} htmlFor="slug">
              <Input id="slug" name="slug" required maxLength={180} className="font-mono" />
            </Field>
            <Field label={t("newsletters.description")} htmlFor="description">
              <Input id="description" name="description" maxLength={2000} />
            </Field>
            <div className="self-end">
              <Button type="submit">
                <Plus size={16} weight="bold" />
                {t("newsletters.add")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <ul className="grid list-none gap-3 p-0">
        {rows.length === 0 ? <li className="text-sm text-ink-muted">{t("newsletters.empty")}</li> : null}
        {rows.map((newsletter) => (
          <li key={newsletter.id} className="rounded-lg border border-rule bg-surface px-4 py-3">
            <a href={`/admin/newsletters/${newsletter.id}`} className="font-semibold text-ink">
              {newsletter.name}
            </a>
            <p className="mt-1 text-sm text-ink-muted">{t(`newsletters.status.${newsletter.status}`)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
