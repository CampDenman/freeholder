// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { usePathname } from "next/navigation";
import {
  FileText,
  Gauge,
  Image as ImageIcon,
  Layout,
  MapPin,
  ChartLine,
  Envelope,
  Stethoscope,
  SlidersHorizontal,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface AdminNavLabels {
  region: string;
  overview: string;
  pages: string;
  sections: string;
  media: string;
  forms: string;
  contacts: string;
  locations: string;
  traffic: string;
  health: string;
  settings: string;
}

// Only what exists. A nav advertising screens that are not built is a promise
// the interface cannot keep; entries arrive with their modules.
const LINKS = [
  { href: "/admin", key: "overview", Icon: Gauge },
  { href: "/admin/pages", key: "pages", Icon: FileText },
  { href: "/admin/sections", key: "sections", Icon: Layout },
  { href: "/admin/media", key: "media", Icon: ImageIcon },
  { href: "/admin/forms", key: "forms", Icon: Envelope },
  { href: "/admin/contacts", key: "contacts", Icon: UsersThree },
  { href: "/admin/locations", key: "locations", Icon: MapPin },
  { href: "/admin/traffic", key: "traffic", Icon: ChartLine },
  { href: "/admin/settings", key: "settings", Icon: SlidersHorizontal },
  { href: "/admin/health", key: "health", Icon: Stethoscope },
] as const;

export function AdminNav({ labels }: { labels: AdminNavLabels }) {
  const pathname = usePathname();
  return (
    <nav aria-label={labels.region}>
      <ul className="-mb-px flex list-none gap-1 p-0">
        {LINKS.map(({ href, key, Icon }) => {
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
                {labels[key]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
