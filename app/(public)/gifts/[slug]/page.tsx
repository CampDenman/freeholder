// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getGiftRegistryBySlug } from "../../../../plugins/gift-registry/service";
import { ServiceError } from "@/core/service";
import { getT } from "../../../i18n";
import { contributeGiftAction } from "../../gift-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const page = await getGiftRegistryBySlug.call({ slug }, { kind: "anonymous" });
    return { title: page.registry.title };
  } catch {
    return { title: "Gift registry" };
  }
}

export default async function PublicGiftRegistryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const t = await getT();
  let page;
  try {
    page = await getGiftRegistryBySlug.call({ slug }, { kind: "anonymous" });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{page.registry.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("gifts.public.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("gifts.public.thanks")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {page.items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("gifts.public.empty")}</p>
      ) : (
        <ul className="grid list-none gap-4 p-0">
          {page.items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardHeader title={item.title} />
                <CardBody>
                  <Pill tone={item.status === "invoiced" ? "success" : "neutral"}>
                    {t(`gifts.status.${item.status}`)}
                  </Pill>
                  {item.status === "open" || item.status === "failed" ? (
                    <form action={contributeGiftAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <Field label={t("gifts.public.name")} htmlFor={`gift-name-${item.id}`}>
                        <Input id={`gift-name-${item.id}`} name="name" required autoComplete="name" />
                      </Field>
                      <Field label={t("gifts.public.email")} htmlFor={`gift-email-${item.id}`}>
                        <Input
                          id={`gift-email-${item.id}`}
                          name="email"
                          type="email"
                          required
                          autoComplete="email"
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Button type="submit">{t("gifts.public.submit")}</Button>
                      </div>
                    </form>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
