// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { notFound } from "next/navigation";
import { getNewsletter } from "@/modules/newsletters/service";
import { ServiceError } from "@/core/service";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { newsletterAction } from "../../../newsletter-actions";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function NewsletterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("newsletters");
  const { id } = await params;
  const [bundle, t] = await Promise.all([
    getNewsletter.call({ id }, actor).catch((error: unknown) => {
      if (error instanceof ServiceError) notFound();
      throw error;
    }),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/newsletters" className="text-sm text-ink-muted">{t("newsletters.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{bundle.newsletter.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t(`newsletters.status.${bundle.newsletter.status}`)}</p>
      </div>

      <Card>
        <CardHeader title={t("newsletters.issueAdd")} />
        <CardBody>
          <form action={newsletterAction} className="grid gap-4">
            <input type="hidden" name="intent" value="issue" />
            <input type="hidden" name="newsletterId" value={bundle.newsletter.id} />
            <Field label={t("newsletters.issueTitle")} htmlFor="title">
              <Input id="title" name="title" required maxLength={240} />
            </Field>
            <Field label={t("newsletters.slug")} htmlFor="slug">
              <Input id="slug" name="slug" required maxLength={180} className="font-mono" />
            </Field>
            <Field label={t("newsletters.excerpt")} htmlFor="excerpt">
              <Input id="excerpt" name="excerpt" maxLength={500} />
            </Field>
            <Field label={t("newsletters.body")} htmlFor="body">
              <textarea
                id="body"
                name="body"
                rows={8}
                className="rounded-md border border-rule bg-surface px-3 py-2 text-sm"
              />
            </Field>
            <Button type="submit">{t("newsletters.issueAdd")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("newsletters.issues")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0">
            {bundle.issues.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{issue.title}</span>
                <span className="text-sm text-ink-muted">{t(`newsletters.issueStatus.${issue.status}`)}</span>
                {issue.status === "draft" ? (
                  <form action={newsletterAction}>
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="newsletterId" value={bundle.newsletter.id} />
                    <input type="hidden" name="id" value={issue.id} />
                    <input type="hidden" name="expectedVersion" value={issue.version} />
                    <Button type="submit">{t("newsletters.publish")}</Button>
                  </form>
                ) : (
                  <a href={`/newsletters/${issue.slug}`} className="text-sm font-semibold text-accent">
                    {t("newsletters.publicPath", { slug: issue.slug })}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("newsletters.subscriptions")} />
        <CardBody>
          <p className="text-sm text-ink-muted">
            {bundle.subscriptions.filter((row) => row.status === "confirmed").length}{" "}
            {t("newsletters.confirmed")} ·{" "}
            {bundle.subscriptions.filter((row) => row.status === "pending").length}{" "}
            {t("newsletters.confirmPending")}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
