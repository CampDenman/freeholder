// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { Question } from "@phosphor-icons/react/dist/ssr";
import { usePathname } from "next/navigation";
import type { GuidanceContextView } from "@/core/guidance/service";

function pathOnly(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

export function AdminGuidanceHelp({
  contexts,
  label,
}: {
  contexts: GuidanceContextView[];
  label: string;
}) {
  const pathname = usePathname();
  const context = contexts.find((candidate) =>
    candidate.hrefs.some((href) => {
      const target = pathOnly(href);
      return target === "/admin"
        ? pathname === target
        : pathname.startsWith(target);
    }),
  ) ?? contexts.find((candidate) => candidate.audienceMatch) ?? contexts[0];
  if (!context) return null;
  return (
    <a
      href={`/admin/guidance?flow=${encodeURIComponent(context.key)}`}
      className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
    >
      <Question size={18} weight="duotone" aria-hidden="true" />
      {label}
    </a>
  );
}
