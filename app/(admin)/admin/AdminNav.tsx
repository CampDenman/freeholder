// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { usePathname } from "next/navigation";
import {
  Gauge,
  SlidersHorizontal,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

// Only what exists. A nav advertising screens that are not built is a promise
// the interface cannot keep; entries arrive with their modules.
const LINKS = [
  { href: "/admin", label: "Overview", Icon: Gauge },
  { href: "/admin/contacts", label: "Contacts", Icon: UsersThree },
  { href: "/admin/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections">
      <ul className="-mb-px flex list-none gap-1 p-0">
        {LINKS.map(({ href, label, Icon }) => {
          const active =
            href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <a
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm",
                  active
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent text-ink-muted",
                )}
              >
                <Icon size={16} weight={active ? "fill" : "regular"} />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
