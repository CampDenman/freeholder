// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: prove the public identity can edit content but cannot gain authority,
// that the disposable playground is separated from a production database by
// construction, and that the hourly reset recovers a clean, signed-out,
// reseeded playground.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { closeDb, db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { validateSession } from "@/core/auth/sessions";
import { resetEnvForTests } from "@/core/env";
import { enterPlayground, initializePlayground, markPlaygroundBaseline } from "@/core/demo/playground";
import {
  PLAYGROUND_MANAGE,
  PLAYGROUND_CLIENT_LIMITS,
  PLAYGROUND_PUBLIC,
  PLAYGROUND_PUBLIC_CONTACT_CAP,
  PLAYGROUND_PUBLIC_REFUSED,
  PLAYGROUND_SUBMISSION_BYTES,
  PLAYGROUND_ROW_CAPS,
  PLAYGROUND_VIEW,
  playgroundAllows,
  playgroundScreenIsReadOnly,
} from "@/core/demo/playground-policy";
import { ready } from "@/core/runtime";
import { listServices, permits } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { createForm, submitForm } from "@/modules/forms/service";
import { formSubmissions } from "@/modules/forms/schema";
import { createNewsletter, subscribeToNewsletter } from "@/modules/newsletters/service";
import { addEventSession, addEventTicket, createEvent, publishEvent, registerForEvent } from "@/modules/events/service";
import {
  addCartItem,
  applyVariantMatrix,
  createPriceList,
  createProduct,
  getOrCreateCart,
  getProductVariants,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { submitQuoteRequest } from "@/modules/cms/inbound";
import { beginCustomerCheckout } from "@/modules/invoicing/customer-service";
import { requestCustomerMagicLink } from "@/core/auth/magic-links/service";
import { updateBusiness } from "@/core/settings/service";
import { createPage, updatePage, getPage, publishPage } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { seedDemoIfRequested } from "@/modules/seed/boot";
import { touchEditLease, releaseEditLease } from "@/modules/cms/lifecycle";
import { heartbeatPresence, leavePresence, listPresence } from "@/modules/cms/collaboration";
import { createRole } from "@/core/roles/service";
import { requestHostUpdate } from "@/core/update/host";
import { createInvitation } from "@/core/invitations/service";
import { beginUpload } from "@/core/media/service";
import { sendMail, deliverQueuedMail, testMailSender } from "@/core/mail/service";
import { sendSms } from "@/core/messaging/sms";
import { mailDeliveries, mailOutbox } from "@/core/mail/schema";
import { webhookDeliveries, webhookSubscriptions } from "@/core/webhooks/schema";
import { deliverDue } from "@/core/webhooks/deliver";
import { login, logout } from "@/core/auth/service";
import { setModuleEnabled } from "@/core/settings/service";
import { createDepositAndBalanceInvoices } from "@/modules/invoicing/advanced-money-service";
import { createContact } from "@/core/contacts/service";
import { ANONYMOUS, OWNER, closeDb as closeSpineDb, hasDatabase, truncateSpine } from "../helpers/spine";

it("requires explicit opt-in for each editing action", () => {
  for (const name of ["cms.testSendEmail", "cms.sendSmsTemplate", "cms.futurePrivilege", "auth.login", "auth.requestMagicLink", "roles.create", "platform.requestHostUpdate", "media.upload", "contacts.fulfillDataRequest", "analytics.track"]) {
    expect(playgroundAllows(name, "mutation")).toBe(false);
  }
  expect(playgroundAllows("cms.updatePage", "mutation")).toBe(true);
});

it("treats only the content modules as editable admin screens", () => {
  // Editable: the screens whose saves the mutation allow-list accepts.
  for (const path of ["/admin", "/admin/pages", "/admin/pages/new", "/admin/forms/abc", "/admin/contacts", "/admin/products/new"]) {
    expect(playgroundScreenIsReadOnly(path), path).toBe(false);
  }
  // A read-only tour stop: the admin shell says so above the form.
  for (const path of ["/admin/promotions", "/admin/events", "/admin/invoices", "/admin/inbox", "/admin/design", "/admin/pagesx"]) {
    expect(playgroundScreenIsReadOnly(path), path).toBe(true);
  }
});

describe("playground public-site policy (2026-10-22)", () => {
  it("lets the public site's own actions through and keeps credential and provider flows out", () => {
    for (const name of ["forms.submit", "newsletters.subscribe", "events.register", "catalog.addCartItem", "catalog.shopperCheckout", "cms.submitSiteChat", "share.shareVia", "popups.capture", "reviews.submit"]) {
      expect(playgroundAllows(name, "mutation"), name).toBe(true);
    }
    for (const name of ["auth.requestCustomerMagicLink", "portal.requestSignIn", "invoicing.beginCustomerCheckout", "invoicing.claimCustomerCheckout", "assistant.answer", "media.signUploadClaim"]) {
      expect(playgroundAllows(name, "mutation"), name).toBe(false);
    }
  });

  it("classifies every public mutation exactly once, so a new public verb is a decision", async () => {
    await ready();
    const publicMutations = [...listServices().values()]
      .filter((service) => service.def.kind === "mutation" && service.def.permission === "public")
      .map((service) => service.def.name);
    const allowed = new Set<string>(PLAYGROUND_PUBLIC);
    const unclassified = publicMutations.filter(
      (name) => !allowed.has(name) && !(name in PLAYGROUND_PUBLIC_REFUSED) && name !== "playground.enter",
    );
    expect(unclassified).toEqual([]);
    for (const name of PLAYGROUND_PUBLIC) {
      expect(name in PLAYGROUND_PUBLIC_REFUSED, name).toBe(false);
      // Named services must exist and be public mutations; a rename fails here.
      expect(publicMutations, name).toContain(name);
    }
    // Public verbs that add a row of their own carry a cap; the community
    // join (a member row per email) was missed once.
    for (const name of ["forms.submit", "events.register", "community.joinBySlug", "catalog.getOrCreateCart", "reviews.submit"]) {
      expect(PLAYGROUND_ROW_CAPS[name], name).toBeDefined();
    }
    // Every capped public surface is one the policy actually allows.
    for (const name of Object.keys(PLAYGROUND_ROW_CAPS)) {
      expect(playgroundAllows(name, "mutation"), name).toBe(true);
    }
  });
});

describe.runIf(hasDatabase)("playground row caps name real tables", () => {
  afterAll(closeDb);
  it("every capped surface resolves to a table the schema actually has", async () => {
    for (const cap of Object.values(PLAYGROUND_ROW_CAPS)) {
      const rows = await db().execute<{ count: number }>(sqlRawCount(cap.table));
      expect(Number(rows[0]?.count ?? -1)).toBeGreaterThanOrEqual(0);
    }
  });
});

function sqlRawCount(table: string) {
  // The registry names tables as strings (importing schemas into the policy
  // closes a static cycle); this count is the test-side proof each name is
  // the real physical table.
  return sql.raw(`select count(*)::int as count from "${table.replaceAll('"', '""')}"`);
}

describe.runIf(hasDatabase)("disposable playground", () => {
  beforeEach(async () => {
    await truncateSpine();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
  afterAll(closeDb);

  it("does not convert a database containing real accounts", async () => {
    await db().insert(users).values({ email: "owner@example.test", role: "owner" });
    await expect(initializePlayground()).rejects.toThrow("disposable database");
    expect(await db().select().from(users)).toHaveLength(1);
  });

  it("issues only a restricted visitor session and supports a real page edit", async () => {
    await initializePlayground();
    await initializePlayground();
    const issued = await enterPlayground.call({}, ANONYMOUS);
    const session = await db().transaction((tx) => validateSession(tx, issued.token));
    expect(session?.role).toBe("playground");
    expect(session?.security.twoFactorRequired).toBe(false);
    if (!session) throw new Error("No session");
    const actor = { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants };
    const page = await createPage.call({ slug: "visitor-page", title: "Before" }, actor);
    // The editor mounts these services before rendering the block controls.
    expect((await touchEditLease.call({ id: page.id }, actor)).mine).toBe(true);
    await heartbeatPresence.call({ pageId: page.id, editing: true }, actor);
    expect(await listPresence.call({ pageId: page.id }, actor)).toHaveLength(1);
    await updatePage.call({ id: page.id, title: "After", blocks: [
      { id: "heading", type: "heading", props: { text: "After", level: 1 } },
    ] }, actor);
    expect((await getPage.call({ id: page.id }, actor))?.title).toBe("After");
    expect((await publishPage.call({ id: page.id, published: true }, actor)).status).toBe("published");
    await leavePresence.call({ pageId: page.id }, actor);
    await releaseEditLease.call({ id: page.id }, actor);
    expect(await listPresence.call({ pageId: page.id }, actor)).toHaveLength(0);
    await expect(createRole.call({ name: "Escalation", grants: [{ module: "*", access: "manage" }] }, actor)).rejects.toMatchObject({ code: "permission" });
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "permission" });
    expect((await db().select().from(users)).every((user) => !user.passwordHash)).toBe(true);
  });

  async function visitorActor() {
    const issued = await enterPlayground.call({}, ANONYMOUS);
    const session = await db().transaction((tx) => validateSession(tx, issued.token));
    if (!session) throw new Error("No session");
    return { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants, token: issued.token };
  }

  it("bounds the visitor session to content grants with no escalation path", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    expect(actor.role).toBe("playground");
    const allowed = new Set<string>([...PLAYGROUND_MANAGE, ...PLAYGROUND_VIEW]);
    for (const grant of actor.grants) {
      expect(allowed.has(grant.module)).toBe(true);
      if (grant.access === "manage") {
        expect(PLAYGROUND_MANAGE).toContain(grant.module);
      }
    }
    // No grant names staff, owner, money, messaging or platform machinery.
    expect(actor.grants.map((grant) => grant.module)).not.toContain("platform");
    // Even the visitor's own session cannot start a credential flow.
    await expect(
      login.call({ email: "visitor@playground.invalid", password: "guess" }, actor),
    ).rejects.toMatchObject({ code: "permission" });
  });

  it("refuses privileged operations server-side as the playground principal", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    const unavailable = { code: "permission", message: "This action is unavailable in the public playground." };
    await expect(createInvitation.call({ email: "friend@example.test", roleKey: "staff" }, actor)).rejects.toMatchObject(unavailable);
    await expect(testMailSender.call({}, actor)).rejects.toMatchObject(unavailable);
    await expect(
      beginUpload.call(
        { filename: "probe.png", contentType: "image/png", bytes: 1024, provenance: {}, metadata: {} },
        actor,
      ),
    ).rejects.toMatchObject(unavailable);
    await expect(sendSms.call({ to: "+15555550100", body: "hello", idempotencyKey: "pg-1" }, actor)).rejects.toMatchObject(unavailable);
    await expect(createDepositAndBalanceInvoices.call({}, actor)).rejects.toMatchObject(unavailable);
    await expect(setModuleEnabled.call({ module: "cms", enabled: false }, actor)).rejects.toMatchObject(unavailable);
  });

  it("blocks external mail delivery even from background paths", async () => {
    await initializePlayground();
    const queued = await db().transaction((tx) =>
      sendMail(tx, { to: "person@example.test", subject: "Playground", text: "queued by a reminder job" }),
    );
    // Playground on: refused with the playground reason, before any provider
    // contact, and not retried.
    await expect(deliverQueuedMail(queued.id)).resolves.toEqual({ status: "failed" });
    const [blocked] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, queued.id));
    expect(blocked?.status).toBe("failed");
    expect(blocked?.lastError).toBe("External mail delivery is disabled in the public playground.");
    expect(await db().select().from(mailOutbox)).toHaveLength(0);
    // Playground off: the same call fails for the ordinary local-sink reason,
    // proving the guard above is what fired.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const control = await db().transaction((tx) =>
      sendMail(tx, { to: "person@example.test", subject: "Control", text: "ordinary queue" }),
    );
    await expect(deliverQueuedMail(control.id)).resolves.toEqual({ status: "failed" });
    const [ordinary] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, control.id));
    expect(ordinary?.lastError).not.toBe("External mail delivery is disabled in the public playground.");
  });

  it("blocks external SMS and webhook delivery even from system work", async () => {
    await initializePlayground();
    // SMS: system callers (reminder/compliance jobs) reach the service without
    // a person, and the playground refusal still fires.
    await expect(
      sendSms.call({ to: "+15555550100", body: "reminder", idempotencyKey: "pg-sms-1" }, { kind: "system" }),
    ).rejects.toMatchObject({
      code: "permission",
      message: "Text message delivery is disabled in the public playground.",
    });
    // Webhooks: a delivery enqueued by an event fan-out fails closed with no
    // attempt burned; the control run below shows the ordinary network path.
    const [subscription] = await db()
      .insert(webhookSubscriptions)
      .values({ name: "playground probe", url: "http://127.0.0.1:9/hook", events: ["*"], secret: "probe-secret", status: "active" })
      .returning({ id: webhookSubscriptions.id });
    const [delivery] = await db()
      .insert(webhookDeliveries)
      .values({ subscriptionId: subscription!.id, eventName: "contact.created", payload: {}, status: "pending", nextAttemptAt: new Date(Date.now() - 60_000) })
      .returning({ id: webhookDeliveries.id });
    await expect(deliverDue(5)).resolves.toBe(1);
    const [blocked] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery!.id));
    expect(blocked).toMatchObject({
      status: "failed",
      attempts: 0,
      error: "External webhook delivery is disabled in the public playground.",
    });
    // Playground off: the same delivery is attempted over the network and
    // lands on the ordinary retry path instead.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await db().update(webhookDeliveries).set({ status: "pending", error: null, completedAt: null }).where(eq(webhookDeliveries.id, delivery!.id));
    await expect(deliverDue(5)).resolves.toBe(1);
    const [attempted] = await db().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery!.id));
    expect(attempted?.error).not.toBe("External webhook delivery is disabled in the public playground.");
    expect(attempted?.attempts).toBe(1);
  });

  it("caps rows on each writable surface", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    const cap = PLAYGROUND_ROW_CAPS["contacts.create"]!.limit;
    for (let index = 0; index < cap; index += 1) {
      await createContact.call({ name: `Sample ${index}` }, actor);
    }
    await expect(createContact.call({ name: "One too many" }, actor)).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(createContact.call({ name: "One too many" }, actor)).rejects.toThrow(/surface is full/);
    // The bound is per surface: pages still take edits while contacts are full.
    const page = await createPage.call({ slug: "still-room", title: "Still room" }, actor);
    expect((await getPage.call({ id: page.id }, actor))?.title).toBe("Still room");
  });

  it("throttles all visitor mutations together at the playground bound", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    // Entry consumed one mutation of the shared 300-per-minute budget; count
    // exactly how many more pass before the wall, then prove the next one is
    // refused. The accounting is the bound.
    let allowed = 0;
    let refusal: { code?: string; message?: string } | undefined;
    for (let index = 0; index < 400 && !refusal; index += 1) {
      await logout.call({ token: `playground-hammer-${index}` }, actor).then(
        () => {
          allowed += 1;
        },
        (error: unknown) => {
          refusal = error as { code?: string; message?: string };
        },
      );
    }
    expect(allowed).toBe(299);
    expect(refusal).toMatchObject({
      code: "rate_limited",
      message: "The shared playground is busy. Please try again shortly.",
    });
    // The budget is shared, not per service: a different mutation is refused too.
    await expect(createContact.call({ name: "Over budget" }, actor)).rejects.toMatchObject({
      code: "rate_limited",
      message: "The shared playground is busy. Please try again shortly.",
    });
  });

  it("accepts the public site's visitor actions without letting them reach the outside world", async () => {
    await initializePlayground();
    // Fixtures as an ordinary install would hold them: the playground policy
    // rightly refuses this setup to every non-system caller.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await updateBusiness.call({ name: "Aurora Coast Photography", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver" }, OWNER);
    await createForm.call({
      slug: "contact",
      name: "Enquiry",
      fields: [
        { key: "name", label: "Your name", kind: "text", required: true },
        { key: "email", label: "Email", kind: "email", required: true },
        { key: "message", label: "Message", kind: "multiline", required: true },
      ],
    }, OWNER);
    const newsletter = await createNewsletter.call({ name: "Letter", slug: "letter" }, OWNER);
    const event = await createEvent.call({ name: "Coast walk", slug: "coast-walk" }, OWNER);
    const session = await addEventSession.call({
      eventId: event.id,
      startsAt: new Date(Date.now() + 7 * 86_400_000),
      endsAt: new Date(Date.now() + 7 * 86_400_000 + 7_200_000),
      timezone: "America/Vancouver",
      capacity: 10,
      waitlistEnabled: false,
    }, OWNER);
    const ticket = await addEventTicket.call({ eventId: event.id, name: "Free", priceMinor: 0, currency: "CAD" }, OWNER);
    const published = await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
    const product = await createProduct.call({ name: "Print", slug: "print", kind: "physical" }, OWNER);
    const matrix = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: matrix.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "40.00" }, OWNER);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();

    // Signed out, as a visitor to the demo's public site.
    const sent = await submitForm.call({
      slug: "contact",
      values: { name: "Ada", email: "ada@example.test", message: "Do you shoot in October?" },
      sourceUrl: "/contact",
    }, ANONYMOUS);
    expect(sent.ok).toBe(true);
    const subscribed = await subscribeToNewsletter.call({ newsletterId: newsletter.id, email: "ada@example.test" }, ANONYMOUS);
    expect(subscribed.status).toBe("pending");
    const registered = await registerForEvent.call({
      eventId: published.id, sessionId: session.id, ticketId: ticket.id, email: "ada@example.test", name: "Ada",
    }, ANONYMOUS);
    expect(registered.registration.status).toBe("confirmed");
    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    const filled = await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token, variantId: variant.id, quantity: 1 }, ANONYMOUS);
    expect(filled.lines).toHaveLength(1);
    await submitQuoteRequest.call({ name: "Ada", email: "ada@example.test", message: "A quote for prints, please." }, ANONYMOUS);

    // The same actions as the signed-in playground visitor browsing the site.
    const visitor = await visitorActor();
    expect((await submitForm.call({
      slug: "contact",
      values: { name: "Grace", email: "grace@example.test", message: "Hello from the playground." },
    }, visitor)).ok).toBe(true);

    // Nothing they did can leave the box: the subscription's confirmation
    // was queued like any other mail and fails closed at delivery.
    const queued = await db().select().from(mailDeliveries);
    expect(queued.length).toBeGreaterThan(0);
    for (const delivery of queued) {
      await expect(deliverQueuedMail(delivery.id)).resolves.toEqual({ status: "failed" });
    }
    expect(
      (await db().select({ lastError: mailDeliveries.lastError }).from(mailDeliveries))
        .every((row) => row.lastError === "External mail delivery is disabled in the public playground."),
    ).toBe(true);
    // Credential and payment-provider flows stay refused, signed out or not.
    const unavailable = { code: "permission", message: "This action is unavailable in the public playground." };
    await expect(requestCustomerMagicLink.call({ email: "ada@example.test" }, ANONYMOUS)).rejects.toMatchObject(unavailable);
    await expect(
      beginCustomerCheckout.call({ id: "00000000-0000-4000-8000-000000000009", token: "x".repeat(43) }, ANONYMOUS),
    ).rejects.toMatchObject(unavailable);
  }, 60_000);

  it("caps the public contact form like every other writable surface", async () => {
    await initializePlayground();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const form = await createForm.call({
      slug: "contact",
      name: "Enquiry",
      fields: [{ key: "message", label: "Message", kind: "multiline", required: true }],
      destination: "none",
    }, OWNER);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    const cap = PLAYGROUND_ROW_CAPS["forms.submit"]!.limit;
    await db().insert(formSubmissions).values(
      Array.from({ length: cap }, (_, index) => ({ formId: form.id, data: { message: `filler ${index}` }, status: "received" as const })),
    );
    await expect(
      submitForm.call({ slug: "contact", values: { message: "one too many" } }, ANONYMOUS),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("queues transactional mail to the playground sink where an ordinary install without a provider refuses", async () => {
    await initializePlayground();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const newsletter = await createNewsletter.call({ name: "Letter", slug: "letter" }, OWNER);
    // No delivering provider: an ordinary install refuses before queuing.
    await expect(
      subscribeToNewsletter.call({ newsletterId: newsletter.id, email: "ada@example.test" }, ANONYMOUS),
    ).rejects.toThrow(/delivering mail provider|delivering mail adapter/);
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
    // The playground queues it to the sink, and the sink never delivers.
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    const subscribed = await subscribeToNewsletter.call({ newsletterId: newsletter.id, email: "ada@example.test" }, ANONYMOUS);
    expect(subscribed.status).toBe("pending");
    const [queued] = await db().select().from(mailDeliveries);
    expect(queued?.status).toBe("queued");
    await expect(deliverQueuedMail(queued!.id)).resolves.toEqual({ status: "failed" });
    const [after] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, queued!.id));
    expect(after?.lastError).toBe("External mail delivery is disabled in the public playground.");
  });

  it("bounds one public submission's size, tighter in the playground", async () => {
    await initializePlayground();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await createForm.call({
      slug: "long",
      name: "Long answers",
      destination: "none",
      fields: [
        { key: "a", label: "A", kind: "multiline", maxLength: 5_000 },
        { key: "b", label: "B", kind: "multiline", maxLength: 5_000 },
      ],
    }, OWNER);
    const long = { a: "x".repeat(4_500), b: "y".repeat(4_500) };
    expect(JSON.stringify(long).length).toBeGreaterThan(PLAYGROUND_SUBMISSION_BYTES);
    // An ordinary install takes it: under the global ceiling.
    expect((await submitForm.call({ slug: "long", values: long }, ANONYMOUS)).ok).toBe(true);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    await expect(submitForm.call({ slug: "long", values: long }, ANONYMOUS)).rejects.toMatchObject({ code: "validation" });
    await expect(submitForm.call({ slug: "long", values: long }, ANONYMOUS)).rejects.toThrow(/too long/);
    expect((await submitForm.call({ slug: "long", values: { a: "short" } }, ANONYMOUS)).ok).toBe(true);
  });

  it("caps the contacts every public verb grows behind its own cap", async () => {
    await initializePlayground();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await createForm.call({
      slug: "contact",
      name: "Enquiry",
      destination: "none",
      fields: [{ key: "message", label: "Message", kind: "multiline", required: true }],
    }, OWNER);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    await db().insert(contacts).values(
      Array.from({ length: PLAYGROUND_PUBLIC_CONTACT_CAP.limit }, (_, index) => ({
        name: `Filler ${index}`,
        email: `filler-${index}@example.test`,
      })),
    );
    // forms.submit's own cap has room; the shared contacts cap does not.
    await expect(
      submitForm.call({ slug: "contact", values: { message: "hello" } }, ANONYMOUS),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("counts caps from the seeded sample, so a large seed never closes the public site", async () => {
    await initializePlayground();
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const form = await createForm.call({
      slug: "contact",
      name: "Enquiry",
      destination: "none",
      fields: [{ key: "message", label: "Message", kind: "multiline", required: true }],
    }, OWNER);
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    // A seed bigger than either cap: contacts and form submissions alike.
    const seededContacts = PLAYGROUND_PUBLIC_CONTACT_CAP.limit + 50;
    const seededSubmissions = PLAYGROUND_ROW_CAPS["forms.submit"]!.limit + 50;
    await db().insert(contacts).values(
      Array.from({ length: seededContacts }, (_, index) => ({ name: `Seed ${index}`, email: `seed-${index}@example.test` })),
    );
    await db().insert(formSubmissions).values(
      Array.from({ length: seededSubmissions }, (_, index) => ({ formId: form.id, data: { message: `seed ${index}` }, status: "received" as const })),
    );
    // Without a baseline the seed alone would fill both caps…
    await expect(submitForm.call({ slug: "contact", values: { message: "hello" } }, ANONYMOUS)).rejects.toMatchObject({ code: "rate_limited" });
    // …with the boot-time baseline, visitors keep their whole allowance.
    await markPlaygroundBaseline();
    expect((await submitForm.call({ slug: "contact", values: { message: "hello" } }, ANONYMOUS)).ok).toBe(true);
    // A restart mid-hour re-runs boot; it must not re-baseline visitor rows.
    await submitForm.call({ slug: "contact", values: { message: "before restart" } }, ANONYMOUS);
    await markPlaygroundBaseline();
    const [stored] = await db().execute<{ baseline: Record<string, number> }>(
      sql`select config->'baseline' as baseline from module_settings where module = 'playground'`,
    );
    expect(stored?.baseline.form_submissions).toBe(seededSubmissions);
    // And the cap still bites on what visitors add past the seed.
    await db().insert(formSubmissions).values(
      Array.from({ length: PLAYGROUND_ROW_CAPS["forms.submit"]!.limit }, (_, index) => ({ formId: form.id, data: { message: `visitor ${index}` }, status: "received" as const })),
    );
    await expect(submitForm.call({ slug: "contact", values: { message: "one too many" } }, ANONYMOUS)).rejects.toMatchObject({ code: "rate_limited" });
  }, 120_000);

  it("spends one client's budget before the ceiling every visitor shares", async () => {
    await initializePlayground();
    const actor = await visitorActor();
    const script = { ...actor, request: { trustedIp: "203.0.113.5" } };
    const neighbour = { ...actor, request: { trustedIp: "203.0.113.6" } };
    let allowed = 0;
    let refusal: unknown;
    for (let index = 0; index < 80 && !refusal; index += 1) {
      await logout.call({ token: `client-${index}` }, script).then(
        () => { allowed += 1; },
        (error: unknown) => { refusal = error; },
      );
    }
    expect(allowed).toBe(PLAYGROUND_CLIENT_LIMITS.perMinute.limit);
    expect(refusal).toMatchObject({ code: "rate_limited" });
    expect((refusal as Error).message).toMatch(/this connection/);
    // Another visitor is unaffected: the script spent its own budget only.
    await expect(logout.call({ token: "neighbour" }, neighbour)).resolves.toBeDefined();
  });

  it("shows the visitor no secret-shaped field from any query it may read", async () => {
    vi.stubEnv("FREEHOLDER_SEED_DEMO", "1"); resetEnvForTests();
    await initializePlayground();
    await seedDemoIfRequested();
    const actor = await visitorActor();
    await ready();
    const secretShaped = /(secret|token|password|credential|private_?key|api_?key|access_?key|signing_?key|^key_?hash$|^hash$)/i;
    // Reviewed: identifiers named like secrets that are not secrets.
    const reviewed = new Set<string>([]);
    const findings: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
      else if (value && typeof value === "object" && !(value instanceof Date)) {
        for (const [key, inner] of Object.entries(value)) {
          if (secretShaped.test(key) && !reviewed.has(key) && typeof inner === "string" && inner.length > 0) {
            findings.push(`${path}.${key}`);
          }
          walk(inner, `${path}.${key}`);
        }
      }
    };
    let read = 0;
    for (const service of listServices().values()) {
      const { def } = service;
      if (def.kind !== "query" || def.permission === "public" || def.permission === "system") continue;
      if (!permits(actor, def.permission, def.name, "query")) continue;
      let output: unknown;
      try {
        output = await service.call({}, actor);
      } catch {
        continue; // needs an id or refused: nothing returned to scan
      }
      read += 1;
      walk(output, def.name);
    }
    expect(read).toBeGreaterThan(20);
    expect(findings).toEqual([]);
  }, 180_000);

  it("refuses entry on ordinary client installations", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await initializePlayground();
    await expect(enterPlayground.call({}, ANONYMOUS)).rejects.toMatchObject({ code: "not_found" });
    expect(await db().select().from(users)).toHaveLength(0);
  });

  it("requires a fresh owner factor before contacting the host", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    await expect(requestHostUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "step_up_required" });
    await expect(requestHostUpdate.call({}, { kind: "agent", keyName: "test", scopes: ["platform:write"] })).rejects.toMatchObject({ code: "permission" });
  });
});

const originalDatabaseUrl = process.env.DATABASE_URL ?? "";
const clusterAdminUrl = originalDatabaseUrl.replace(/\/[^/]+$/, "/postgres");

async function freshDatabase(name: string): Promise<string> {
  const admin = postgres(clusterAdminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = originalDatabaseUrl.replace(/\/[^/]+$/, `/${name}`);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }
  return url;
}

async function dropDatabase(name: string): Promise<void> {
  const admin = postgres(clusterAdminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.end();
  }
}

/** Point the runtime's lazy database singleton at another database. */
async function pointAt(url: string): Promise<void> {
  process.env.DATABASE_URL = url;
  await closeDb();
  resetEnvForTests();
}

async function visitorOn(databaseUrl: string) {
  await pointAt(databaseUrl);
  await initializePlayground();
  const issued = await enterPlayground.call({}, ANONYMOUS);
  const session = await db().transaction((tx) => validateSession(tx, issued.token));
  if (!session) throw new Error("No session");
  return {
    token: issued.token,
    actor: { kind: "user" as const, userId: session.userId, role: session.role, grants: session.grants },
  };
}

describe.runIf(hasDatabase)("playground separation and reset recovery", () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pointAt(originalDatabaseUrl);
    await dropDatabase("playground_sep_prod_c138");
    await dropDatabase("playground_sep_play_c138");
    await dropDatabase("playground_sep_reset_c138");
    await closeSpineDb();
  }, 120_000);

  it("runs on its own database and never converts or sees production data", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    resetEnvForTests();
    const prodUrl = await freshDatabase("playground_sep_prod_c138");
    const playUrl = await freshDatabase("playground_sep_play_c138");
    expect(playUrl).not.toBe(prodUrl);

    // A production-shaped database: a real owner account and real content.
    await pointAt(prodUrl);
    await db().insert(users).values({ email: "owner@real-client.test", role: "owner", passwordHash: "real-hash" });
    const [prodPage] = await db().insert(pages).values({ slug: "real-client-page", title: "Real client content" }).returning({ id: pages.id });
    // The playground flag fails closed against a database holding real
    // accounts: even pointed at production by mistake, it refuses to convert
    // or seed it.
    await expect(initializePlayground()).rejects.toThrow("disposable database");
    expect(await db().select().from(users)).toHaveLength(1);

    // The playground's own database holds only the synthetic pair — the
    // production owner and page are absent from it entirely.
    const visitor = await visitorOn(playUrl);
    expect(visitor.actor.role).toBe("playground");
    const playUsers = await db().select({ email: users.email, passwordHash: users.passwordHash }).from(users);
    expect(playUsers.map((user) => user.email).sort()).toEqual([
      "operator@playground.invalid",
      "visitor@playground.invalid",
    ]);
    expect(playUsers.every((user) => !user.passwordHash)).toBe(true);
    expect(
      await db().select({ id: pages.id }).from(pages).where(eq(pages.id, prodPage!.id)),
    ).toHaveLength(0);

    // Visitor work stays in the playground database: the graffiti page does
    // not exist in production, and the playground session does not exist in
    // the production session table either.
    const graffiti = await createPage.call({ slug: "visitor-graffiti", title: "Visitor graffiti" }, visitor.actor);
    await pointAt(prodUrl);
    expect(await db().select({ id: pages.id }).from(pages).where(eq(pages.id, graffiti.id))).toHaveLength(0);
    expect(await db().select({ id: pages.id }).from(pages)).toHaveLength(1);
    expect(
      await db().transaction((tx) => validateSession(tx, visitor.token)),
    ).toBeUndefined();
  }, 180_000);

  it("hourly reset recovers a clean, signed-out, reseeded playground", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1");
    vi.stubEnv("FREEHOLDER_SEED_DEMO", "1");
    resetEnvForTests();
    const playUrl = await freshDatabase("playground_sep_reset_c138");
    await pointAt(playUrl);
    await initializePlayground();
    const seeded = await seedDemoIfRequested();
    expect(seeded.status).toBe("installed");
    const seededPages = await db().select({ id: pages.id }).from(pages);
    expect(seededPages.length).toBeGreaterThan(0);

    // A visitor enters and leaves marks: a session, a page, an edit.
    const before = await visitorOn(playUrl);
    const graffiti = await createPage.call({ slug: "reset-me", title: "Graffiti" }, before.actor);
    await updatePage.call({ id: graffiti.id, title: "Edited graffiti", blocks: [
      { id: "heading", type: "heading", props: { text: "Edited graffiti", level: 1 } },
    ] }, before.actor);
    expect((await getPage.call({ id: graffiti.id }, before.actor))?.title).toBe("Edited graffiti");

    // The reset job (deploy/docker-selfhost/playground/reset.sh, hourly via
    // systemd timer) recreates the disposable database and lets the ordinary
    // boot phases re-run. Simulate that cycle against a fresh database.
    await closeDb();
    await dropDatabase("playground_sep_reset_c138");
    const resetUrl = await freshDatabase("playground_sep_reset_c138");
    await pointAt(resetUrl);
    await initializePlayground();
    const reseeded = await seedDemoIfRequested();
    expect(reseeded.status).toBe("installed");

    // Recovery: the old session no longer authorizes anyone, the visitor
    // page is gone, and the sample content is back.
    expect(await db().transaction((tx) => validateSession(tx, before.token))).toBeUndefined();
    expect(await db().select({ id: pages.id }).from(pages).where(eq(pages.id, graffiti.id))).toHaveLength(0);
    const restoredPages = await db().select({ id: pages.id }).from(pages);
    expect(restoredPages.length).toBe(seededPages.length);

    // And the playground is usable again: a new visitor enters and edits.
    const after = await visitorOn(resetUrl);
    const page = await createPage.call({ slug: "after-reset", title: "After reset" }, after.actor);
    expect((await getPage.call({ id: page.id }, after.actor))?.title).toBe("After reset");
    // The playground seeds the busy business too (C1.38), and it comes back
    // after the reset like everything else.
    expect(reseeded.status === "installed" && reseeded.busy?.crm?.contacts).toBeGreaterThanOrEqual(150);
  }, 300_000);
});
