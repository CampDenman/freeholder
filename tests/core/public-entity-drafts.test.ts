// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Working drafts must not mutate live public products, events or issues (C2.01).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { updateBusiness } from "@/core/settings/service";
import {
  activateProduct,
  createProduct,
  publishProduct,
  resolveVisibleProduct,
  updateProduct,
  updateProductDescription,
} from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import {
  createEvent,
  publishEvent,
  resolvePublicEvent,
  updateEvent,
} from "@/modules/events/service";
import {
  createIssue,
  createNewsletter,
  publishIssue,
  resolvePublicIssue,
  updateIssue,
} from "@/modules/newsletters/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("public entities keep a working draft", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("lets an active product change its working copy without changing the storefront", async () => {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const created = await createProduct.call(
      {
        name: "Print set",
        slug: "print-set",
        kind: "physical",
        subtitle: "Coastal",
        taxCategoryId: tax.id,
        description: [{ id: "h", type: "heading", props: { text: "Prints", level: 2 } }],
      },
      OWNER,
    );
    const active = await activateProduct.call(
      { id: created.id, expectedVersion: created.version },
      OWNER,
    );
    const edited = await updateProduct.call(
      { id: active.id, expectedVersion: active.version, name: "Print folio", subtitle: "Draft copy" },
      OWNER,
    );
    expect(edited.name).toBe("Print set");
    expect(edited.workingName).toBe("Print folio");
    expect((await resolveVisibleProduct.call({ slug: "print-set" }, ANONYMOUS))?.name).toBe(
      "Print set",
    );

    const described = await updateProductDescription.call(
      {
        id: edited.id,
        expectedVersion: edited.version,
        description: [{ id: "h", type: "heading", props: { text: "Folio", level: 2 } }],
      },
      OWNER,
    );
    expect(
      (described.description as unknown as { props: { text: string } }[])[0]?.props.text,
    ).toBe("Prints");
    expect(
      (described.workingDescription as unknown as { props: { text: string } }[])[0]?.props.text,
    ).toBe("Folio");

    const published = await publishProduct.call(
      { id: described.id, expectedVersion: described.version },
      OWNER,
    );
    expect(published.name).toBe("Print folio");
    expect((await resolveVisibleProduct.call({ slug: "print-set" }, ANONYMOUS))?.name).toBe(
      "Print folio",
    );
  });

  it("lets a published event change its working copy without changing the public page", async () => {
    const created = await createEvent.call(
      { name: "Coast workshop", slug: "coast-workshop", summary: "A morning on the shore." },
      OWNER,
    );
    const live = await publishEvent.call({ id: created.id, expectedVersion: created.version }, OWNER);
    const edited = await updateEvent.call(
      {
        id: live.id,
        expectedVersion: live.version,
        name: "Harbour workshop",
        summary: "Draft copy",
      },
      OWNER,
    );
    expect(edited.name).toBe("Coast workshop");
    expect(edited.workingName).toBe("Harbour workshop");
    expect((await resolvePublicEvent.call({ slug: "coast-workshop" }, ANONYMOUS))?.name).toBe(
      "Coast workshop",
    );

    const published = await publishEvent.call(
      { id: edited.id, expectedVersion: edited.version },
      OWNER,
    );
    expect(published.name).toBe("Harbour workshop");
    expect((await resolvePublicEvent.call({ slug: "coast-workshop" }, ANONYMOUS))?.name).toBe(
      "Harbour workshop",
    );
  });

  it("lets a published issue change its working copy without changing the archive", async () => {
    const newsletter = await createNewsletter.call({ name: "Coast notes", slug: "coast-notes" }, OWNER);
    const draft = await createIssue.call(
      {
        newsletterId: newsletter.id,
        slug: "august-light",
        title: "August light",
        excerpt: "What the fog did.",
        body: "The strait was silver.",
      },
      OWNER,
    );
    const live = await publishIssue.call({ id: draft.id, expectedVersion: draft.version }, OWNER);
    const edited = await updateIssue.call(
      {
        id: live.id,
        expectedVersion: live.version,
        title: "September light",
        body: "Draft copy",
      },
      OWNER,
    );
    expect(edited.title).toBe("August light");
    expect(edited.workingTitle).toBe("September light");
    expect((await resolvePublicIssue.call({ slug: "august-light" }, ANONYMOUS))?.title).toBe(
      "August light",
    );

    const published = await publishIssue.call(
      { id: edited.id, expectedVersion: edited.version },
      OWNER,
    );
    expect(published.title).toBe("September light");
    expect((await resolvePublicIssue.call({ slug: "august-light" }, ANONYMOUS))?.title).toBe(
      "September light",
    );
  });
});
