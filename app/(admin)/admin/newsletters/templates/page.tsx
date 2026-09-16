// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Message templates: one model for every kind (C9.05, MASTER.md §30).
//
// Under `/admin/newsletters` because the newsletters module owns the table,
// and because `/admin/templates` is already C2.13's page for *content*
// templates — page, post and product layouts. Two different things that both
// want the word "template", kept apart so neither has to explain itself in a
// heading.
//
// Grouped by kind rather than listed flat: an owner comes here to change one
// thing — the receipt, this month's newsletter — and a flat list of every
// template the platform ships buries it.
import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getTemplate, listTemplates, templateSlots } from "@/modules/newsletters/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { resetTemplateAction, saveTemplateAction } from "../../../template-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KINDS = ["transactional", "campaign", "newsletter", "automation", "sms"] as const;

/** The first paragraph of a block tree, for the interim textarea. */
function bodyText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const node = block as { type?: unknown; props?: { body?: unknown } };
    if (node.type === "text" && typeof node.props?.body === "string") return node.props.body;
  }
  return "";
}

export default async function MessageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("newsletters", "manage");
  const query = await searchParams;
  const [t, business, all, slots] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listTemplates.call({}, actor)),
    domainOrNull(templateSlots.call({}, actor)),
  ]);

  const chosen = query.template
    ? await domainOrNull(getTemplate.call({ id: query.template }, actor))
    : null;

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const declared = new Set(
    Array.isArray(chosen?.template.variables)
      ? (chosen.template.variables as unknown[]).filter(
          (each): each is string => typeof each === "string",
        )
      : [],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/newsletters" className="text-sm underline">
          {t("templates.back")}
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{t("templates.title")}</h1>
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{t("templates.intro")}</p>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("templates.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {(all ?? []).length === 0 ? (
        <Callout tone="neutral">{t("templates.empty")}</Callout>
      ) : null}

      {KINDS.map((kind) => {
        const rows = (all ?? []).filter((each) => each.kind === kind);
        if (rows.length === 0) return null;
        return (
          <Card key={kind}>
            <CardHeader title={t(`templates.kind.${kind}`)} />
            <CardBody>
              <ul className="grid list-none gap-2 p-0">
                {rows.map((template) => (
                  <li
                    key={template.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                  >
                    <form method="get">
                      <input type="hidden" name="template" value={template.id} />
                      <Button type="submit" variant="quiet">
                        {template.name}
                      </Button>
                    </form>
                    {template.slug ? (
                      <code className="font-mono text-xs">{template.slug}</code>
                    ) : null}
                    <Pill tone={template.status === "active" ? "success" : "neutral"}>
                      {t(`templates.status.${template.status}`)}
                    </Pill>
                    {/* Compared against what shipped rather than flagged, so it
                        cannot go stale when an edit path forgets to set it. */}
                    {template.customised ? (
                      <Pill tone="accent">{t("templates.customised")}</Pill>
                    ) : null}
                    <span className="ms-auto text-ink-muted">{when(template.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader
          title={
            chosen ? t("templates.editing", { name: chosen.template.name }) : t("templates.new")
          }
        />
        <CardBody>
          {chosen && chosen.locales.length > 0 ? (
            <p className="mb-3 text-sm text-ink-muted">
              {t("templates.translatedInto", { locales: chosen.locales.join(", ") })}
            </p>
          ) : null}

          <form action={saveTemplateAction} className="grid gap-3">
            {chosen ? <input type="hidden" name="id" value={chosen.template.id} /> : null}
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={t("templates.field.name")} htmlFor="name">
                <Input id="name" name="name" defaultValue={chosen?.template.name ?? ""} required />
              </Field>
              <Field label={t("templates.field.kind")} htmlFor="kind">
                <Select
                  id="kind"
                  name="kind"
                  defaultValue={chosen?.template.kind ?? "transactional"}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`templates.kind.${kind}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("templates.field.status")} htmlFor="status">
                <Select id="status" name="status" defaultValue={chosen?.template.status ?? "draft"}>
                  <option value="draft">{t("templates.status.draft")}</option>
                  <option value="active">{t("templates.status.active")}</option>
                  <option value="archived">{t("templates.status.archived")}</option>
                </Select>
              </Field>
              <Field
                label={t("templates.field.slug")}
                htmlFor="slug"
                hint={t("templates.field.slugHint")}
              >
                <Input id="slug" name="slug" defaultValue={chosen?.template.slug ?? ""} />
              </Field>
              <Field
                label={t("templates.field.subject")}
                htmlFor="subject"
                hint={t("templates.field.subjectHint")}
              >
                <Input id="subject" name="subject" defaultValue={chosen?.template.subject ?? ""} />
              </Field>
            </div>

            <Field
              label={t("templates.field.body")}
              htmlFor="body"
              hint={t("templates.field.bodyHint")}
            >
              <textarea
                id="body"
                name="body"
                rows={8}
                defaultValue={bodyText(chosen?.template.blocks)}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
              />
            </Field>

            <fieldset className="grid gap-2 rounded-md border border-rule p-3">
              <legend className="px-1 font-mono text-xs text-ink-muted">
                {t("templates.field.variables")}
              </legend>
              {/* Declared rather than inferred from the body: the promise runs
                  from template to sender, and rendering refuses when one of
                  these has no value. */}
              <p className="text-xs text-ink-muted">{t("templates.field.variablesHint")}</p>
              <div className="flex flex-wrap gap-3">
                {(slots ?? []).map((slot) => (
                  <label key={slot.slot} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="variables"
                      value={slot.slot}
                      defaultChecked={declared.has(slot.slot)}
                    />
                    <code className="font-mono text-xs">{`{{${slot.slot}}}`}</code>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">{t("templates.action.save")}</Button>
            </div>
          </form>

          {/* §30's escape hatch, offered only where there is something to go
              back to. A reset on an owner's own template would blank it. */}
          {chosen?.template.customised ? (
            <form action={resetTemplateAction} className="mt-3">
              <input type="hidden" name="id" value={chosen.template.id} />
              <Button type="submit" variant="quiet">
                {t("templates.action.reset")}
              </Button>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
