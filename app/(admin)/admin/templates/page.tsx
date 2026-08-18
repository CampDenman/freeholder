// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Page/post/product/service/email templates (C2.13).
import { Copy } from "@phosphor-icons/react/dist/ssr";
import { listTemplates } from "@/modules/cms/service";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("cms");
  const query = await searchParams;
  const [templates, t] = await Promise.all([listTemplates.call({}, actor), getT()]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("cms.templates.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("cms.templates.intro")}</p>
        {query.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {query.error}
          </p>
        ) : null}
      </div>
      <Card>
        {templates.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <Copy size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">{t("cms.templates.empty")}</p>
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-4 last:border-b-0"
              >
                <a
                  href={`/admin/templates/${encodeURIComponent(template.key)}`}
                  className="font-medium text-ink underline decoration-rule underline-offset-2"
                >
                  {template.name}
                </a>
                <span className="font-mono text-xs text-ink-muted">{template.key}</span>
                <Pill tone="neutral">{t(`cms.templates.kind.${template.kind}`)}</Pill>
                <Pill tone={template.origin === "owner" ? "accent" : "neutral"}>
                  {t(`cms.templates.origin.${template.origin}`)}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
