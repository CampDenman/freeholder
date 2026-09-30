// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
  kind?: "image" | "video" | "doc" | "audio";
}

/** One entry the collection picker can offer — a published collection. */
export interface CollectionChoice {
  slug: string;
  title: string;
}

/** One entry the product picker can offer — an active product. */
export interface ProductChoice {
  slug: string;
  name: string;
}

/**
 * The choice lists entity-pick fields draw from. Every editor screen passes
 * what it can resolve; a missing list simply renders that field's "None"
 * entry alone, the same as an empty asset library.
 */
export interface EntityChoices {
  collections?: CollectionChoice[];
  products?: ProductChoice[];
}

function translateField(
  t: Translate,
  field: FieldDescriptor,
  assets: AssetChoice[],
  entities: EntityChoices = {},
): EditorField {
  if (field.kind === "collection") {
    return {
      name: field.name,
      kind: field.kind,
      required: field.required,
      label: label(t, `cms.field.${field.name}`, field.name),
      choices: [
        { value: "", label: t("cms.field.noCollection") },
        ...(entities.collections ?? []).map((collection) => ({
          value: collection.slug,
          label: collection.title,
        })),
      ],
    };
  }
  if (field.kind === "product") {
    return {
      name: field.name,
      kind: field.kind,
      required: field.required,
      label: label(t, `cms.field.${field.name}`, field.name),
      choices: [
        { value: "", label: t("cms.field.noProduct") },
        ...(entities.products ?? []).map((product) => ({
          value: product.slug,
          label: product.name,
        })),
      ],
    };
  }
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
            ...assets
              .filter((asset) => !field.assetKind || asset.kind === field.assetKind)
              .map((asset) => ({
                value: asset.id,
                label: asset.filename,
              })),
          ]
        : field.choices?.map((choice) => ({
            value: choice.value,
            label: label(t, choice.labelKey, choice.value),
          })),
    itemFields: field.itemFields?.map((sub) => translateField(t, sub, assets, entities)),
  };
}

export function editorBlockTypes(
  t: Translate,
  context: "page" | "chrome" | "email",
  assets: AssetChoice[] = [],
  entities: EntityChoices = {},
): EditorBlockType[] {
  return paletteFor(context).map((entry) => ({
    type: entry.type,
    label: label(t, entry.labelKey, entry.type),
    container: entry.container,
    starter: entry.starter,
    fields: entry.fields.map((field) => translateField(t, field, assets, entities)),
  }));
}

export function editorLabels(t: Translate): EditorLabels {
  return {
    preview: {
      region: t("cms.editor.preview"),
      desktop: t("cms.editor.desktop"),
      mobile: t("cms.editor.mobile"),
      replaceImage: t("cms.editor.replaceImage"),
      noImage: t("cms.editor.noImage"),
      noAssets: t("cms.editor.noAssets"),
      replaceCollection: t("cms.editor.replaceCollection"),
      noCollection: t("cms.editor.noCollection"),
      noCollections: t("cms.editor.noCollections"),
      replaceProduct: t("cms.editor.replaceProduct"),
      noProduct: t("cms.editor.noProduct"),
      noProducts: t("cms.editor.noProducts"),
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
    conflict: t("cms.editor.conflict"),
    reload: t("cms.editor.reload"),
    keepMine: t("cms.editor.keepMine"),
    slash: t("cms.editor.slash"),
    undo: t("cms.editor.undo"),
    redo: t("cms.editor.redo"),
    history: t("cms.editor.history"),
    historyCurrent: t("cms.editor.historyCurrent"),
    historyAdd: t("cms.editor.historyAdd", { label: "{label}" }),
    historyRemove: t("cms.editor.historyRemove", { label: "{label}" }),
    historyDuplicate: t("cms.editor.historyDuplicate", { label: "{label}" }),
    historyMove: t("cms.editor.historyMove", { label: "{label}" }),
    historyEdit: t("cms.editor.historyEdit", { label: "{label}" }),
    focusMode: t("cms.editor.focusMode"),
    exitFocus: t("cms.editor.exitFocus"),
    showOutlines: t("cms.editor.showOutlines"),
    hideOutlines: t("cms.editor.hideOutlines"),
    zoom: t("cms.editor.zoom"),
    chooseCollection: t("cms.editor.chooseCollection"),
    chooseProducts: t("cms.editor.chooseProducts"),
    noCollections: t("cms.editor.noCollections"),
    noProducts: t("cms.editor.noProducts"),
    pickedProducts: t("cms.editor.pickedProducts", { count: "{count}" }),
    done: t("common.done"),
    altText: t("cms.editor.altText"),
    altApply: t("cms.editor.altApply"),
    duplicate: t("cms.editor.duplicate"),
    copy: t("cms.editor.copy"),
    paste: t("cms.editor.paste"),
    bold: t("cms.editor.bold"),
    italic: t("cms.editor.italic"),
    code: t("cms.editor.code"),
    link: t("cms.editor.link"),
    bullet: t("cms.editor.bullet"),
    numbered: t("cms.editor.numbered"),
    richHint: t("cms.editor.richHint"),
    saveAsSection: t("cms.editor.saveAsSection"),
    detachSection: t("cms.editor.detachSection"),
    sectionName: t("cms.editor.sectionName"),
    live: t("cms.editor.live"),
    draft: t("cms.editor.draft"),
    publishChanges: t("cms.editor.publishChanges"),
    publishing: t("cms.editor.publishing"),
    // The placeholders survive formatting as literals — the client fills them
    // in once the moved block's new position is known (same pattern as
    // media.uploadProgress).
    movedTo: t("cms.editor.movedTo", {
      label: "{label}",
      position: "{position}",
      total: "{total}",
    }),
    a11y: {
      title: t("cms.a11y.title"),
      ok: t("cms.a11y.ok"),
      missingH1: t("cms.a11y.missingH1"),
      multipleH1: t("cms.a11y.multipleH1"),
      headingOrder: t("cms.a11y.headingOrder"),
      imageMissing: t("cms.a11y.imageMissing"),
      imageAltUnset: t("cms.a11y.imageAltUnset"),
      vagueLink: t("cms.a11y.vagueLink"),
      emptyHref: t("cms.a11y.emptyHref"),
      htmlImage: t("cms.a11y.htmlImage"),
      htmlLandmarks: t("cms.a11y.htmlLandmarks"),
      videoMissing: t("cms.a11y.videoMissing"),
      popupH1: t("cms.a11y.popupH1"),
      popupRawHtml: t("cms.a11y.popupRawHtml"),
    },
  };
}

export function sectionPaletteEntries(
  t: Translate,
  reusable: Array<{ key: string; name: string }>,
): EditorBlockType[] {
  const base = paletteFor("page").find((entry) => entry.type === "sectionInstance");
  if (!base) return [];
  return reusable.map((section) => ({
    type: "sectionInstance",
    paletteId: `section:${section.key}`,
    label: t("cms.editor.sectionEntry", { name: section.name }),
    container: false,
    starter: { ...base.starter, sectionKey: section.key },
    fields: base.fields.map((field) => translateField(t, field, [])),
  }));
}
