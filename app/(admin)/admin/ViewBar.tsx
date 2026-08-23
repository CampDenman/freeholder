// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved views on a list (C7.06, MASTER.md §4.14).
//
// One component for every list, because a view is a named URL and that is the
// same shape everywhere. Each saved view renders as an ordinary link to the
// parameters it stands for, so opening one *is* navigating — the address bar
// changes, the back button works, and the result can be copied to a colleague.
// Nothing here holds state.
//
// The "keep this" form carries the current parameters as hidden inputs rather
// than re-deriving them server-side, so what gets saved is exactly what the
// person is looking at.
import { Button, Pill } from "@/ui/primitives";
import {
  listViews,
  toQueryString,
  viewEntity,
  type ViewEntity,
} from "@/core/views/service";
import type { Actor } from "@/core/service";
import { getT } from "../../i18n";
import { domainOrNull } from "../read-helpers";
import { removeViewAction, saveViewAction, setDefaultViewAction } from "../view-actions";

export async function ViewBar({
  actor,
  entity: entityKey,
  params,
}: {
  actor: Actor;
  entity: string;
  /** What the list is currently filtered by. The saved view is exactly this. */
  params: Record<string, string>;
}) {
  const entity: ViewEntity | undefined = viewEntity(entityKey);
  if (!entity) return null;
  const [t, views] = await Promise.all([
    getT(),
    domainOrNull(listViews.call({ entity: entityKey }, actor)),
  ]);
  if (views === null) return null;

  const filtered = Object.keys(params).length > 0;
  const hidden = Object.entries(params);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <a
        href={entity.path}
        className={filtered ? "underline" : "font-medium"}
      >
        {t("views.all")}
      </a>
      {views.map((view) => {
        // Columns ride in the query string too, derived from the stored choice
        // rather than kept beside it: the URL stays the one description of what
        // is on screen, so a link carries the columns as faithfully as the
        // filters.
        const query = toQueryString(
          view.columns.length > 0
            ? { ...view.filters, columns: view.columns.join(",") }
            : view.filters,
        );
        return (
          <span key={view.id} className="flex items-center gap-1">
            {/* An ordinary link: opening a view is navigating to it. */}
            <a href={query ? `${entity.path}?${query}` : entity.path} className="underline">
              {view.name}
            </a>
            {view.isDefault ? <Pill tone="accent">{t("views.default")}</Pill> : null}
            {view.mine ? null : <Pill tone="neutral">{t("views.shared")}</Pill>}
          </span>
        );
      })}

      <details className="ms-auto">
        <summary className="cursor-pointer text-ink-muted">{t("views.keep")}</summary>
        <div className="mt-2 grid gap-2 rounded-md border border-rule p-3">
          <form action={saveViewAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="entity" value={entityKey} />
            <input type="hidden" name="path" value={entity.path} />
            {hidden.map(([key, value]) => (
              <span key={key} className="contents">
                <input type="hidden" name="filterKey" value={key} />
                <input type="hidden" name="filterValue" value={value} />
              </span>
            ))}
            <label className="grid gap-1">
              <span className="text-ink-muted">{t("views.field.name")}</span>
              <input
                name="name"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            {/* Only where there are columns to pick. A picker over a card
                layout is a control with nothing to control. */}
            {entity.columns.length > 0 ? (
              <fieldset className="flex flex-wrap items-center gap-3 border-0 p-0">
                <legend className="sr-only">{t("views.field.columns")}</legend>
                {entity.columns.map((column) => (
                  <label key={column.key} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      name="columns"
                      value={column.key}
                      defaultChecked={entity.defaultColumns.includes(column.key)}
                      disabled={column.fixed}
                    />
                    <span className="text-ink-muted">{column.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <label className="flex items-center gap-2">
              <input type="checkbox" name="shared" />
              <span className="text-ink-muted">{t("views.field.shared")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isDefault" />
              <span className="text-ink-muted">{t("views.field.default")}</span>
            </label>
            <Button type="submit" variant="quiet">
              {t("views.action.keep")}
            </Button>
          </form>
          {/* Sharing makes a view visible, never editable — so the only things
              offered here for somebody else's view are "open it first" and
              nothing. */}
          <p className="max-w-prose text-ink-muted">{t("views.hint")}</p>
          {views.length > 0 ? (
            <ul className="grid list-none gap-1 p-0">
              {views.map((view) => (
                <li key={view.id} className="flex flex-wrap items-center gap-2">
                  <span>{view.name}</span>
                  <form action={setDefaultViewAction}>
                    <input type="hidden" name="entity" value={entityKey} />
                    <input type="hidden" name="path" value={entity.path} />
                    <input type="hidden" name="id" value={view.isDefault ? "" : view.id} />
                    <Button type="submit" variant="quiet">
                      {view.isDefault ? t("views.action.unsetDefault") : t("views.action.setDefault")}
                    </Button>
                  </form>
                  {view.mine ? (
                    <form action={removeViewAction}>
                      <input type="hidden" name="id" value={view.id} />
                      <input type="hidden" name="path" value={entity.path} />
                      <Button type="submit" variant="quiet">
                        {t("views.action.forget")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </div>
  );
}
