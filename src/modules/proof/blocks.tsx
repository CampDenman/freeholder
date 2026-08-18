// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A notice block registered only through this plugin (C2.23).
import { z } from "zod";
import { cx } from "@/ui/primitives";
import { defineBlock } from "@/modules/cms/blocks/types";

export const NOTICE_TYPE = "notice";

export const notice = defineBlock({
  type: NOTICE_TYPE,
  labelKey: "cms.block.notice",
  contexts: ["page"],
  schema: z.object({
    body: z.string().trim().min(1).max(400),
    tone: z.enum(["info", "success", "warning"]).default("info"),
  }),
  starter: () => ({ body: "Write a short notice.", tone: "info" as const }),
  fieldHints: { body: { control: "multiline" } },
  render: ({ props }) => (
    <aside
      className={cx(
        "rounded-md border border-rule px-4 py-3 text-sm",
        props.tone === "success" && "bg-success-soft text-success",
        props.tone === "warning" && "bg-warning-soft text-warning",
        props.tone === "info" && "bg-accent-soft text-ink",
      )}
    >
      {props.body}
    </aside>
  ),
});

export default [notice];
