// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A public gift list (C9.35 / §34). The URL is the credential.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { wishlistByShareToken } from "@/modules/catalog/service";
import { getT } from "../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("catalog.registry.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function RegistryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [t, list] = await Promise.all([
    getT(),
    wishlistByShareToken.call({ token }, { kind: "anonymous" }),
  ]);
  if (!list) notFound();

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{list.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("catalog.registry.intro")}</p>
        </div>
        <Card>
          <CardHeader title={t("catalog.registry.items")} />
          <CardBody>
            {list.items.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("catalog.registry.empty")}</p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {list.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    {item.href ? (
                      <a href={item.href} className="font-medium underline">
                        {item.productName}
                      </a>
                    ) : (
                      <span className="font-medium">{item.productName}</span>
                    )}
                    <span className="font-mono text-ink-muted">{item.sku}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
