// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Authored alt text and generated proposals are deliberately separate forms.
// Generation cannot submit the authored field; review cannot happen without a
// visible editable proposal and an explicit accept or dismiss action.
import { useActionState } from "react";
import {
  acceptAltTextSuggestionAction,
  dismissAltTextSuggestionAction,
  generateAltTextSuggestionAction,
  setAltTextAction,
  type MediaActionState,
} from "../../media-actions";

interface Suggestion {
  id: string;
  suggestion: string;
  provider: string;
  model: string;
}

interface Labels {
  label: string;
  hint: string;
  save: string;
  generate: string;
  generating: string;
  disclosure: string;
  reviewHeading: string;
  reviewHint: string;
  accept: string;
  dismiss: string;
  unavailable: string;
}

const INITIAL: MediaActionState = {};

export function AltTextForm({
  id,
  value,
  available,
  unavailableReason,
  suggestion,
  labels,
}: {
  id: string;
  value: string;
  available: boolean;
  unavailableReason: string | null;
  suggestion: Suggestion | null;
  labels: Labels;
}) {
  const [generateState, generateAction, generating] = useActionState<
    MediaActionState,
    FormData
  >(generateAltTextSuggestionAction, INITIAL);
  const [acceptState, acceptAction, accepting] = useActionState<
    MediaActionState,
    FormData
  >(acceptAltTextSuggestionAction, INITIAL);
  const [dismissState, dismissAction, dismissing] = useActionState<
    MediaActionState,
    FormData
  >(dismissAltTextSuggestionAction, INITIAL);
  const error = generateState.error ?? acceptState.error ?? dismissState.error;

  return (
    <div className="grid gap-3">
      <form action={setAltTextAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="grid min-w-52 flex-1 gap-1.5">
          <label
            htmlFor={`alt-${id}`}
            className="font-mono text-xs font-medium text-ink-muted"
          >
            {labels.label}
          </label>
          <input
            id={`alt-${id}`}
            name="altText"
            defaultValue={value}
            maxLength={500}
            placeholder={labels.hint}
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:border-accent"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-rule px-3 py-2 text-sm font-medium text-ink"
        >
          {labels.save}
        </button>
      </form>

      {suggestion ? (
        <div className="grid gap-2 rounded-md border border-accent/30 bg-accent-soft p-3">
          <div>
            <p className="text-xs font-semibold text-ink">{labels.reviewHeading}</p>
            <p className="mt-1 text-xs text-ink-muted">{labels.reviewHint}</p>
          </div>
          <form action={acceptAction} className="grid gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <textarea
              name="altText"
              required
              maxLength={500}
              defaultValue={suggestion.suggestion}
              aria-label={labels.reviewHeading}
              className="min-h-20 rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={accepting || dismissing}
                className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
              >
                {labels.accept}
              </button>
              <span className="font-mono text-[11px] text-ink-muted">
                {suggestion.provider} / {suggestion.model}
              </span>
            </div>
          </form>
          <form action={dismissAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <button
              type="submit"
              disabled={accepting || dismissing}
              className="text-xs font-semibold text-ink-muted underline underline-offset-2 disabled:opacity-50"
            >
              {labels.dismiss}
            </button>
          </form>
        </div>
      ) : (
        <form action={generateAction} className="grid justify-items-start gap-1.5">
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={!available || generating}
            className="rounded-md border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:border-rule disabled:text-ink-muted disabled:opacity-60"
          >
            {generating ? labels.generating : labels.generate}
          </button>
          <p className="text-xs leading-relaxed text-ink-muted">
            {available ? labels.disclosure : `${labels.unavailable} ${unavailableReason ?? ""}`}
          </p>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
