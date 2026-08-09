// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Translating the editor for the client component that renders it.
//
// The palette and its fields are *derived* from the block schemas, so the
// strings naming them cannot be written out one by one in a catalog lookup —
// they are resolved by key here, on the server, where a locale exists.
//
// A field's label falls back to its own name when no catalog entry exists.
// That matters for §24: a plugin ships a block with a field nobody has
// translated yet, and the owner sees "sku" rather than a missing-key crash or
// a blank label. `tests/core/i18n-gate.test.ts` still requires every field
// name *core* ships to have a real entry.
import type { Translate } from "@/core/i18n";
import { paletteFor } from "@/modules/cms/blocks/registry";
import type { FieldDescriptor } from "@/modules/cms/blocks/fields";
import type {
  EditorBlockType,
  EditorField,
  EditorLabels,
} from "./BlockEditor";

/**
 * Translate, or fall back to a readable name.
 *
 * Exported because a *block's* field names come from the block, so any screen
 * that names one — the editor, the translation screen — meets the same
 * problem: a plugin may declare a field core has no catalog key for, and
 * showing "cms.field.tagline" is worse than showing "tagline".
 */
export function label(t: Translate, key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

/** One entry the asset picker can offer. */
export interface AssetChoice {
  id: string;
  filename: string;
}

function translateField(
  t: Translate,
  field: FieldDescriptor,
  assets: AssetChoice[],
): EditorField {
  return {
    name: field.name,
    kind: field.kind,
    required: field.required,
    label: label(t, `cms.field.${field.name}`, field.name),
    choices:
      field.kind === "asset"
        ? // The library, as options. Empty is legitimate — a fresh instance
          // has no files, and the block simply renders nothing until it does.
          [
            { value: "", label: t("cms.field.noAsset") },
            ...assets.map((asset) => ({
              value: asset.id,
              label: asset.filename,
            })),
          ]
        : field.choices?.map((choice) => ({
            value: choice.value,
            label: label(t, choice.labelKey, choice.value),
          })),
    itemFields: field.itemFields?.map((sub) => translateField(t, sub, assets)),
  };
}

export function editorBlockTypes(
  t: Translate,
  context: "page" | "chrome",
  assets: AssetChoice[] = [],
): EditorBlockType[] {
  return paletteFor(context).map((entry) => ({
    type: entry.type,
    label: label(t, entry.labelKey, entry.type),
    container: entry.container,
    starter: entry.starter,
    fields: entry.fields.map((field) => translateField(t, field, assets)),
  }));
}

export function editorLabels(t: Translate): EditorLabels {
  return {
    preview: {
      region: t("cms.editor.preview"),
      desktop: t("cms.editor.desktop"),
      mobile: t("cms.editor.mobile"),
    },
    addBlock: t("cms.editor.addBlock"),
    cancel: t("common.cancel"),
    remove: t("cms.editor.remove"),
    moveUp: t("cms.editor.moveUp"),
    moveDown: t("cms.editor.moveDown"),
    reorder: t("cms.editor.reorder"),
    empty: t("cms.editor.empty"),
    addItem: t("cms.editor.addItem"),
    removeItem: t("cms.editor.removeItem"),
    saving: t("cms.editor.saving"),
    saved: t("cms.editor.saved"),
    unsaved: t("cms.editor.unsaved"),
    saveFailed: t("cms.editor.saveFailed"),
    retry: t("cms.editor.retry"),
  };
}
