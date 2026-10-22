// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// C1.38: outside its content modules the public playground is a read-only
// tour. The notice sits above the screen, before anybody fills in a form the
// service layer will refuse. A client component because the admin shell is a
// layout, which does not re-render when the screen under it changes.
import { usePathname } from "next/navigation";
import { Callout } from "@/ui/primitives";
import { playgroundScreenIsReadOnly } from "@/core/demo/playground-policy";

export function PlaygroundReadOnlyNotice({ text }: { text: string }) {
  const pathname = usePathname();
  if (!playgroundScreenIsReadOnly(pathname)) return null;
  return (
    <div className="mb-6" data-playground-read-only="">
      <Callout>{text}</Callout>
    </div>
  );
}
