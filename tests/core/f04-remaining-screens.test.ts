// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Remaining C11.09 F04 holes: the screens exist, they are reachable, and they
// call the services rather than inventing a second path.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalogKeys } from "@/core/i18n";

const NAV = "app/(admin)/admin/AdminNav.tsx";
const LAYOUT = "app/(admin)/admin/layout.tsx";
const SETTINGS = "app/(admin)/admin/settings/page.tsx";
const SETTINGS_ACTIONS = "app/(admin)/settings-module-actions.ts";
const PLUGINS = "app/(admin)/admin/plugins/page.tsx";
const PLUGIN_ACTIONS = "app/(admin)/plugin-actions.ts";
const PLUGIN_FORMS = "app/(admin)/admin/plugins/PluginForms.tsx";
const WEBHOOKS = "app/(admin)/admin/settings/WebhooksCard.tsx";
const ACTIONS = "app/(admin)/actions.ts";
const REDIRECTS = "app/(admin)/admin/redirects/page.tsx";
const SEO_ACTIONS = "app/(admin)/seo-actions.ts";
const PAGES = "app/(admin)/admin/pages/page.tsx";
const PAGE_EDIT = "app/(admin)/admin/pages/[id]/page.tsx";
const CMS_ACTIONS = "app/(admin)/cms-actions.ts";
const INVOICE = "app/(admin)/admin/invoices/[id]/page.tsx";
const INVOICE_NEW = "app/(admin)/admin/invoices/new/page.tsx";
const MONEY_ACTIONS = "app/(admin)/advanced-money-actions.ts";
const PAYMENTS = "app/(admin)/admin/payments/page.tsx";
const SEGMENTS = "app/(admin)/admin/segments/page.tsx";
const SEGMENT_ACTIONS = "app/(admin)/segment-actions.ts";
const AUTOMATION = "app/(admin)/admin/automations/[id]/page.tsx";
const AUTOMATION_ACTIONS = "app/(admin)/automation-actions.ts";
const UPDATES = "app/(admin)/admin/updates/page.tsx";
const MESSAGING = "app/(admin)/admin/messaging/page.tsx";
const MESSAGING_ACTIONS = "app/(admin)/messaging-actions.ts";
const EVENTS = "app/(admin)/admin/events/[id]/page.tsx";
const EVENT_ACTIONS = "app/(admin)/event-actions.ts";
const NEWSLETTERS = "app/(admin)/admin/newsletters/[id]/page.tsx";
const NEWSLETTER_ACTIONS = "app/(admin)/newsletter-actions.ts";
const PIPELINE = "app/(admin)/admin/pipeline/page.tsx";
const PIPELINE_ACTIONS = "app/(admin)/pipeline-actions.ts";
const GALLERY = "app/(admin)/admin/galleries/[id]/page.tsx";
const GALLERY_ACTIONS = "app/(admin)/gallery-actions.ts";
const PRODUCT = "app/(admin)/admin/products/[id]/page.tsx";
const CATALOG_ACTIONS = "app/(admin)/catalog-actions.ts";
const ORDERS = "app/(admin)/admin/orders/[id]/page.tsx";
const INVENTORY = "app/(admin)/admin/inventory/page.tsx";
const IMPORT_FORMS = "app/(admin)/admin/imports/ImportForms.tsx";
const IMPORT_ACTIONS = "app/(admin)/import-actions.ts";
const LOCALES = ["en", "es", "fr"] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("settings module on/off (C11.09 F04)", () => {
  it("lists boot modules and calls setModuleEnabled", () => {
    expect(read(SETTINGS)).toContain("listModules.call");
    expect(read(SETTINGS)).toContain("setModuleEnabledAction");
    expect(read(SETTINGS)).toContain("settings.modules.readOnly");
    expect(read(SETTINGS)).toContain("settings.modules.alwaysOn");
    expect(read(SETTINGS_ACTIONS)).toContain("setModuleEnabled.call");
  });
});

describe("plugins update, rollback and catalogue (C11.09 F04)", () => {
  it("calls update, rollback, catalogue and addRegistry", () => {
    expect(read(PLUGINS)).toContain("listPluginCatalog.call");
    expect(read(PLUGIN_FORMS)).toContain("updatePluginAction");
    expect(read(PLUGIN_FORMS)).toContain("rollbackPluginAction");
    expect(read(PLUGIN_FORMS)).toContain("addPluginRegistryAction");
    expect(read(PLUGIN_ACTIONS)).toContain("updatePlugin.call");
    expect(read(PLUGIN_ACTIONS)).toContain("rollbackPlugin.call");
    expect(read(PLUGIN_ACTIONS)).toContain("addPluginRegistry.call");
  });
});

describe("webhooks inspect and replay (C11.09 F04)", () => {
  it("inspects a delivery on the settings screen and replays through the service", () => {
    expect(read(SETTINGS)).toContain("inspectDelivery.call");
    expect(read(WEBHOOKS)).toContain("replayWebhookDeliveryAction");
    expect(read(ACTIONS)).toContain("replayDelivery.call");
  });
});

describe("seo redirects (C11.09 F04)", () => {
  it("is reachable and calls list/record/delete", () => {
    expect(read(NAV)).toContain('href: "/admin/redirects"');
    expect(read(LAYOUT)).toContain('redirects: t("seo.redirects.title")');
    expect(read(REDIRECTS)).toContain('requireStaffActor("seo")');
    expect(read(REDIRECTS)).toContain("listRedirects.call");
    expect(read(REDIRECTS)).toContain("seo.redirects.empty");
    expect(read(REDIRECTS)).toContain("seo.redirects.unavailable");
    expect(read(SEO_ACTIONS)).toContain("recordRedirect.call");
    expect(read(SEO_ACTIONS)).toContain("deleteRedirect.call");
  });
});

describe("help-centre authoring (C11.09 F04)", () => {
  it("authors through the CMS rather than a second editor", () => {
    expect(read(PAGES)).toContain("helpCategoryList.call");
    expect(read(PAGES)).toContain("saveHelpCategoryAction");
    expect(read(PAGE_EDIT)).toContain("fileHelpArticleAction");
    expect(read(CMS_ACTIONS)).toContain("saveHelpCategory.call");
    expect(read(CMS_ACTIONS)).toContain("fileHelpArticle.call");
    expect(read(CMS_ACTIONS)).toContain("deleteHelpCategory.call");
  });
});

describe("invoicing advanced money (C11.09 F04)", () => {
  it("calls payment plans, late fees, deposit/balance and payouts", () => {
    expect(read(INVOICE)).toContain("getPaymentPlan.call");
    expect(read(INVOICE)).toContain("createPaymentPlanAction");
    expect(read(INVOICE)).toContain("assessLateFeeAction");
    expect(read(INVOICE_NEW)).toContain("createDepositBalanceAction");
    expect(read(PAYMENTS)).toContain("listProviderPayouts.call");
    expect(read(MONEY_ACTIONS)).toContain("createPaymentPlan.call");
    expect(read(MONEY_ACTIONS)).toContain("assessLateFee.call");
    expect(read(MONEY_ACTIONS)).toContain("createDepositAndBalanceInvoices.call");
    expect(read(MONEY_ACTIONS)).toContain("cancelPaymentPlan.call");
  });
});

describe("segments preview, automation runs, update rollback, messaging (C11.09 F04)", () => {
  it("previews a segment through the compiler", () => {
    expect(read(SEGMENTS)).toContain("previewSegmentAction");
    expect(read(SEGMENT_ACTIONS)).toContain("previewSegment.call");
  });

  it("lists and kills automation runs", () => {
    expect(read(AUTOMATION)).toContain("listRuns.call");
    expect(read(AUTOMATION)).toContain("killRunAction");
    expect(read(AUTOMATION_ACTIONS)).toContain("killRun.call");
  });

  it("rolls back an update from the admin screen", () => {
    expect(read(UPDATES)).toContain('intent="rollback"');
    expect(read(ACTIONS)).toContain("rollbackUpdate.call");
  });

  it("owns keyword rules, quiet hours and compliance events", () => {
    expect(read(MESSAGING)).toContain("listKeywordRules.call");
    expect(read(MESSAGING)).toContain("listMessagingWindows.call");
    expect(read(MESSAGING)).toContain("listSmsComplianceEvents.call");
    expect(read(MESSAGING_ACTIONS)).toContain("createKeywordRule.call");
    expect(read(MESSAGING_ACTIONS)).toContain("setMessagingWindow.call");
  });
});

describe("leftover F04 holes (C11.09)", () => {
  it("updates events and newsletters through the real services", () => {
    expect(read(EVENTS)).toContain('name="intent" value="update"');
    expect(read(EVENTS)).toContain("events.update");
    expect(read(EVENT_ACTIONS)).toContain("updateEvent.call");
    expect(read(NEWSLETTERS)).toContain('name="intent" value="update"');
    expect(read(NEWSLETTER_ACTIONS)).toContain("updateNewsletter.call");
  });

  it("edits a deal on the pipeline board", () => {
    expect(read(PIPELINE)).toContain("updateDealAction");
    expect(read(PIPELINE_ACTIONS)).toContain("updateDeal.call");
  });

  it("offers gallery prints through the catalog variant list", () => {
    expect(read(GALLERY)).toContain("listGalleryPriceSheet.call");
    expect(read(GALLERY)).toContain("addGalleryPriceSheetItemAction");
    expect(read(GALLERY_ACTIONS)).toContain("addGalleryPriceSheetItem.call");
    expect(read(GALLERY_ACTIONS)).toContain("removeGalleryPriceSheetItem.call");
  });

  it("publishes a product, grants digital downloads, and releases stock holds", () => {
    expect(read(PRODUCT)).toContain('name="intent" value="publish"');
    expect(read(CATALOG_ACTIONS)).toContain("publishProduct.call");
    expect(read(ORDERS)).toContain('name="intent" value="grantDigital"');
    expect(read(CATALOG_ACTIONS)).toContain("grantDigitalFulfillment.call");
    expect(read(INVENTORY)).toContain("listReservations.call");
    expect(read(CATALOG_ACTIONS)).toContain("releaseReservation.call");
  });

  it("maps an import and records conflict decisions before commit", () => {
    expect(read(IMPORT_FORMS)).toContain("mapImportAction");
    expect(read(IMPORT_FORMS)).toContain("reviewImportConflictsAction");
    expect(read(IMPORT_ACTIONS)).toContain("mapImport.call");
    expect(read(IMPORT_ACTIONS)).toContain("reviewImportConflicts.call");
  });
});

describe("remaining-screen catalogs", () => {
  it("covers the new copy in every locale", () => {
    for (const locale of LOCALES) {
      const keys = catalogKeys(locale);
      for (const key of [
        "settings.modules.title",
        "settings.modules.readOnly",
        "plugins.update",
        "plugins.rollback",
        "plugins.catalog",
        "webhooks.inspect",
        "webhooks.replay",
        "seo.redirects.title",
        "seo.redirects.empty",
        "help.admin.file",
        "help.admin.categoriesEmpty",
        "invoices.plan.title",
        "invoices.lateFee.title",
        "invoices.deposit.title",
        "payments.payouts.title",
        "segments.preview",
        "automations.runs",
        "automations.kill",
        "updates.action.rollback",
        "messaging.keywords.title",
        "messaging.windows.title",
        "messaging.compliance.title",
        "events.update",
        "newsletters.update",
        "pipeline.action.edit",
        "galleries.priceSheet",
        "catalog.publish",
        "catalog.fulfill.grantDigital",
        "catalog.inventory.releaseHold",
        "imports.map",
        "imports.review",
      ]) {
        expect(keys, `${locale} missing ${key}`).toContain(key);
      }
    }
  });
});
