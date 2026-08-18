// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { BlockNode } from "@/modules/cms/blocks/types";

export function seedNoticeBlock(): BlockNode {
  return {
    id: "proof-notice",
    type: "notice",
    props: { body: "A plugin can put a notice on a page.", tone: "info" },
  };
}
