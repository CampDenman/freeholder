// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The form block (MASTER.md §11, §32, §36).
//
// This is the module contract's central claim being tested for real: forms
// reaches the public surface **without a route of its own**. An owner drags a
// form onto a page, the catch-all renders the block tree, and this turns a row
// in `forms` into markup. No file added to app/, no deploy.
//
// Everything here is server-rendered. There is no client component and no
// hydration boundary on the public surface, which is the property §5 and the
// SEO gate both rest on — so the submission result travels back in the URL and
// is rendered, rather than being held in client state.
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";
import { submitPublicForm } from "../../../app/(public)/form-actions";
import { HONEYPOT_FIELD, issueStamp, STAMP_FIELD } from "./antispam";
import type { FormField } from "./fields";

interface Resolved {
  slug: string;
  name: string;
  fields: FormField[];
  submitLabel: string | null;
  successMessage: string | null;
  stamp: string;
}

export const formBlock = defineBlock({
  type: "form",
  labelKey: "cms.block.form",
  contexts: ["page"],
  schema: z.object({
    /** The form's slug, so renaming a form's *name* never breaks a page. */
    formSlug: z.string().min(1),
  }),
  starter: () => ({ formSlug: "contact" }),
  resolve: async (props): Promise<Resolved | null> => {
    // Imported lazily so the block library does not drag the forms module into
    // every bundle that only needs a heading.
    const { getForm } = await import("./service");
    const form = await getForm.call(
      { slug: props.formSlug },
      { kind: "anonymous" },
    );
    if (!form || form.status === "closed") return null;
    return {
      slug: form.slug,
      name: form.name,
      fields: form.fields as FormField[],
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      // Issued per render: the trap measures the gap between this page being
      // built and the answer arriving, so a stamp reused across renders would
      // measure nothing.
      stamp: issueStamp(),
    };
  },
  render: ({ resolved, ctx }) => {
    // A block pointing at a deleted or closed form renders nothing rather than
    // an error. A page must not break because a form was retired.
    if (!resolved) return null;

    if (ctx.query?.sent === resolved.slug) {
      return (
        <p
          role="status"
          className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success"
        >
          {resolved.successMessage ?? "Thank you — your message has been sent."}
        </p>
      );
    }

    return (
      <RenderedForm
        form={resolved}
        failed={ctx.query?.formError === resolved.slug}
      />
    );
  },
});

function RenderedForm({ form, failed }: { form: Resolved; failed: boolean }) {
  return (
    <form action={submitPublicForm} className="grid max-w-prose gap-4">
      <input type="hidden" name="form_slug" value={form.slug} />
      <input type="hidden" name={STAMP_FIELD} value={form.stamp} />

      {failed ? (
        <p
          role="alert"
          className="rounded-md border border-rule bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          That did not go through. Check the fields below and try again.
        </p>
      ) : null}

      {/*
        The honeypot: hidden from layout *and* from the accessibility tree,
        autocomplete off so a browser does not helpfully fill it in and frame
        the visitor, and out of the keyboard path.
      */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor={`${form.slug}-${HONEYPOT_FIELD}`}>
          Leave this field empty
        </label>
        <input
          id={`${form.slug}-${HONEYPOT_FIELD}`}
          type="text"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {form.fields.map((field) => (
        <Field key={field.key} slug={form.slug} field={field} />
      ))}

      <button
        type="submit"
        className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
      >
        {form.submitLabel ?? "Send"}
      </button>
    </form>
  );
}

function Field({ slug, field }: { slug: string; field: FormField }) {
  const id = `${slug}-${field.key}`;
  const describedBy = field.help ? `${id}-help` : undefined;
  const control =
    "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink";

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {field.label}
        {/*
          Decorative: `required` is what a screen reader announces, so the
          asterisk is hidden rather than read out after every label.
        */}
        {field.required ? (
          <span aria-hidden="true" className="text-ink-muted">
            {" *"}
          </span>
        ) : null}
      </label>

      {field.kind === "multiline" ? (
        <textarea
          id={id}
          name={field.key}
          required={field.required}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          rows={5}
          maxLength={field.maxLength ?? 2000}
          className={control}
        />
      ) : field.kind === "select" ? (
        <select
          id={id}
          name={field.key}
          required={field.required}
          aria-describedby={describedBy}
          defaultValue=""
          className={control}
        >
          <option value="" disabled>
            Choose one
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "checkbox" ? (
        <input
          id={id}
          name={field.key}
          required={field.required}
          aria-describedby={describedBy}
          type="checkbox"
          className="size-4 rounded border-rule"
        />
      ) : (
        <input
          id={id}
          name={field.key}
          required={field.required}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          type={inputType(field.kind)}
          maxLength={field.maxLength}
          // Which keyboard a phone shows, and whether the browser can fill it
          // in — the difference between a typed address and an abandoned form.
          autoComplete={autoCompleteFor(field)}
          className={control}
        />
      )}

      {field.help ? (
        <p id={describedBy} className="text-xs text-ink-muted">
          {field.help}
        </p>
      ) : null}
    </div>
  );
}

function inputType(kind: FormField["kind"]): string {
  if (kind === "email") return "email";
  if (kind === "tel") return "tel";
  if (kind === "number") return "number";
  return "text";
}

function autoCompleteFor(field: FormField): string | undefined {
  if (field.kind === "email") return "email";
  if (field.kind === "tel") return "tel";
  if (field.key.includes("name")) return "name";
  return undefined;
}
