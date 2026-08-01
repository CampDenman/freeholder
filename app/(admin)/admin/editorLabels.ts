// Copyright (C) 2026 Camp Denman Society
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

/** Translate, or fall back to the key's last segment as a readable name. */
function label(t: Translate, key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function translateField(t: Translate, field: FieldDescriptor): EditorField {
  return {
    name: field.name,
    kind: field.kind,
    required: field.required,
    label: label(t, `cms.field.${field.name}`, field.name),
    choices: field.choices?.map((choice) => ({
      value: choice.value,
      label: label(t, choice.labelKey, choice.value),
    })),
    itemFields: field.itemFields?.map((sub) => translateField(t, sub)),
  };
}

export function editorBlockTypes(
  t: Translate,
  context: "page" | "chrome",
): EditorBlockType[] {
  return paletteFor(context).map((entry) => ({
    type: entry.type,
    label: label(t, entry.labelKey, entry.type),
    container: entry.container,
    starter: entry.starter,
    fields: entry.fields.map((field) => translateField(t, field)),
  }));
}

export function editorLabels(t: Translate): EditorLabels {
  return {
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
