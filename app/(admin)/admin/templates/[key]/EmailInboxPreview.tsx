// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { testSendEmailAction } from "../../../cms-actions";
import { Button } from "@/ui/primitives";

export function EmailInboxPreview({
  subject,
  html,
  text,
  templateKey,
  locale,
  labels,
}: {
  subject: string;
  html: string;
  text: string;
  templateKey: string;
  locale: string;
  labels: {
    inbox: string;
    from: string;
    to: string;
    subject: string;
    testSend: string;
    fromSample: string;
    toSample: string;
  };
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{labels.inbox}</h2>
        <form action={testSendEmailAction}>
          <input type="hidden" name="key" value={templateKey} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="subject" value={subject} />
          <Button type="submit" variant="quiet">
            {labels.testSend}
          </Button>
        </form>
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-ink-muted">{labels.from}</dt>
          <dd>{labels.fromSample}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-muted">{labels.to}</dt>
          <dd>{labels.toSample}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-muted">{labels.subject}</dt>
          <dd className="font-medium">{subject}</dd>
        </div>
      </dl>
      <iframe
        title={labels.inbox}
        sandbox=""
        srcDoc={html}
        className="h-80 w-full rounded-md border border-rule bg-paper"
      />
      <pre className="overflow-auto whitespace-pre-wrap text-xs text-ink-muted">{text}</pre>
    </div>
  );
}
