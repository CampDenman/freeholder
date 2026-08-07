// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The site chrome, as data (MASTER.md §32: "menus are rows, not JSX").
import { Layout } from "@phosphor-icons/react/dist/ssr";
import { listSections } from "@/modules/cms/service";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function SectionsPage() {
  const actor = await requireStaffActor();
  const [sections, t] = await Promise.all([
    listSections.call({}, actor),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("cms.sections.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("cms.sections.intro")}</p>
      </div>
      <Card>
        {sections.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <Layout size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">{t("cms.sections.empty")}</p>
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {sections.map((section) => (
              <li
                key={section.id}
                className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <a
                  href={`/admin/sections/${section.key}`}
                  className="font-medium underline decoration-rule underline-offset-2"
                >
                  {section.name}
                </a>
                <span className="font-mono text-xs text-ink-muted">
                  {section.key}
                </span>
                <Pill tone={section.kind === "chrome" ? "accent" : "neutral"}>
                  {t(`cms.sectionKind.${section.kind}`)}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
