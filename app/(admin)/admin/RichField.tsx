// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Edit typed rich text without storing HTML (C2.05).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fromEditorMarkup,
  parseRichDoc,
  toEditorMarkup,
} from "@/modules/cms/blocks/rich";

export function RichField({
  id,
  label,
  value,
  onChange,
  labels,
}: {
  id: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  labels: {
    bold: string;
    italic: string;
    code: string;
    link: string;
    bullet: string;
    numbered: string;
    hint: string;
  };
}) {
  const initial = useMemo(() => {
    try {
      return toEditorMarkup(parseRichDoc(value, "lenient"));
    } catch {
      return "";
    }
  }, [value]);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const committed = useRef(value);

  useEffect(() => {
    if (JSON.stringify(value) === JSON.stringify(committed.current)) return;
    try {
      setText(toEditorMarkup(parseRichDoc(value, "lenient")));
      setError(undefined);
    } catch {
      setText("");
    }
    committed.current = value;
  }, [value]);

  const commit = (next: string) => {
    setText(next);
    try {
      const doc = fromEditorMarkup(next);
      committed.current = doc;
      onChange(doc);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.hint);
    }
  };

  const wrap = (before: string, after: string) => {
    commit(`${text}${before}text${after}`);
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-mono text-xs font-medium text-ink-muted">
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        <MarkButton label={labels.bold} onClick={() => wrap("**", "**")} />
        <MarkButton label={labels.italic} onClick={() => wrap("*", "*")} />
        <MarkButton label={labels.code} onClick={() => wrap("`", "`")} />
        <MarkButton label={labels.link} onClick={() => wrap("[", "](https://)")} />
        <MarkButton label={labels.bullet} onClick={() => commit(`${text}\n\n- `)} />
        <MarkButton label={labels.numbered} onClick={() => commit(`${text}\n\n1. `)} />
      </div>
      <textarea
        id={id}
        rows={6}
        value={text}
        onChange={(event) => commit(event.target.value)}
        className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink focus-visible:border-accent"
      />
      <p className="text-xs text-ink-muted">{labels.hint}</p>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function MarkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-rule px-2 py-0.5 text-xs font-medium text-ink"
    >
      {label}
    </button>
  );
}
