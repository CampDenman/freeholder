// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending one message to many people (MASTER.md §30, §4.14, C9.06).
//
// The tests worth reading first are the ones about a send that does not go
// cleanly: a suppressed address must not halt a campaign to nine thousand
// other people, and a paused send must resume exactly where it stopped rather
// than starting again. Both would look fine in a happy-path test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { mailDeliveries, mailSuppressions, mailSenders } from "@/core/mail/schema";
import { resetMailForTests } from "@/adapters/mail";
import { resetEnvForTests } from "@/core/env";
import { recordMailProviderEvent } from "@/core/mail/service";
import { outboxEvents } from "@/core/events/schema";
import {
  broadcastRecipients,
  broadcasts,
} from "@/modules/newsletters/broadcast-schema";
import {
  broadcastRecipientList,
  broadcastStats,
  listBroadcasts,
  onMailDeliveryUpdated,
  pauseBroadcast,
  resumeBroadcast,
  saveBroadcast,
  saveTemplate,
  sendNext,
  startBroadcast,
  tick,
} from "@/modules/newsletters/service";
import { saveSegment } from "@/core/segments/service";
import { recordConsent } from "@/core/privacy/service";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { flushQueuedMail } from "../helpers/mail";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const body = (text: string) => [{ type: "text", props: { body: text } }];

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

/**
 * A bulk sender that works, and a provider that answers.
 *
 * Without this every send in this file refuses — `sendMail` insists on a
 * verified default bulk sender, and rightly so — and the tests would pass
 * while proving only that nothing was sent. The provider is stubbed at the
 * fetch boundary rather than by mocking `sendMail`, so the delivery rows,
 * the provider references and the suppression check are all the real ones.
 */
async function bulkSendingWorks(): Promise<void> {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ id: `resend-${crypto.randomUUID()}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  environment({
    MAIL_BULK_ADAPTER: "resend",
    MAIL_BULK_FROM: "news@example.test",
    RESEND_API_KEY: "test-key",
    RESEND_WEBHOOK_SECRET: "whsec_test",
  });
  await db().insert(mailSenders).values({
    purpose: "bulk",
    provider: "resend",
    email: "news@example.test",
    verificationStatus: "verified",
    status: "active",
    isDefault: true,
    createdBy: OWNER.userId,
  });
}

async function audience(howMany: number) {
  const people = [];
  for (let n = 0; n < howMany; n += 1) {
    const { contact } = await resolveContact.call(
      { email: `person${n}@example.com`, name: `Person ${n}` },
      OWNER,
    );
    // People a campaign may lawfully reach. In life this is a confirmed
    // newsletter subscription, which records exactly this evidence; recorded
    // directly here so these tests are about sending rather than signing up.
    await recordConsent.call(
      {
        contactId: contact.id,
        purpose: "marketing",
        channel: "email",
        state: "granted",
        method: "double_opt_in",
      },
      OWNER,
    );
    people.push(contact);
  }
  // Everyone with an email — which is what a broadcast audience means anyway,
  // and a real definition rather than a contrived one.
  const segment = await saveSegment.call(
    {
      name: `Reachable ${Math.random().toString(36).slice(2, 7)}`,
      definition: { match: "all", rules: [{ field: "contact.email", op: "isSet" }] },
    },
    OWNER,
  );
  return { people, segment };
}

async function ready_(name = "Hello") {
  const template = await saveTemplate.call(
    {
      kind: "campaign",
      name,
      subject: "A subject",
      blocks: body("Hello {{contact.first_name}}."),
      status: "active",
    },
    OWNER,
  );
  return template;
}

describe.runIf(hasDatabase)("broadcasts", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    // Segments and broadcasts both record who made them, so the owner needs a
    // row to point at once the spine has been emptied.
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(BUSINESS, OWNER);
    await bulkSendingWorks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    resetMailForTests();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("freezes the audience when it starts", async () => {
    // §30's segments are dynamic. A send that re-read one mid-flight would
    // mail people who joined after it began and skip people who left, and
    // could never answer "who did this go to".
    const { people, segment } = await audience(3);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "March", templateId: template.id, segmentId: segment.id },
      OWNER,
    );

    const started = await startBroadcast.call({ id: saved.id }, OWNER);
    expect(started.audience).toBe(3);

    // Somebody joining now is not on this send.
    await resolveContact.call({ email: "latecomer@example.com", name: "Late" }, OWNER);
    const recipients = await broadcastRecipientList.call({ id: saved.id }, OWNER);
    expect(recipients).toHaveLength(3);
    expect(recipients.map((each) => each.email).sort()).toEqual(
      people.map((each) => each.email).sort(),
    );
  });

  it("records the address as it was, not as it becomes", async () => {
    const { people, segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Frozen", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);

    const [row] = await db()
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.contactId, people[0]!.id));
    expect(row!.email).toBe("person0@example.com");
  });

  /* -------------------------------------------------------------- sending */

  it("sends a batch and counts what happened", async () => {
    const { segment } = await audience(3);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Counted", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);

    const result = await sendNext.call({ id: saved.id }, { kind: "system" });
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);

    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.audience).toBe(3);
    expect(stats.pending).toBe(0);

    // Finished when nothing is left, without anybody having to say so.
    const [row] = await db().select().from(broadcasts).where(eq(broadcasts.id, saved.id));
    expect(row!.status).toBe("sent");
    expect(row!.finishedAt).not.toBeNull();
  });

  it("does not let one suppressed address halt the campaign", async () => {
    // The failure this design exists for. `sendMail` throws on a suppressed
    // address, and one unsubscribed customer must not stop a send to everybody
    // else — so a refusal is a recorded outcome rather than an exception.
    const { segment } = await audience(3);
    // An owner marking somebody do-not-email: the schema insists reason and
    // provider agree, so a manual suppression names itself as one.
    await db().insert(mailSuppressions).values({
      email: "person1@example.com",
      reason: "manual",
      provider: "manual",
    });
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Resilient", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await sendNext.call({ id: saved.id }, { kind: "system" });

    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.suppressed).toBe(1);
    // The other two still went — the campaign carried on.
    expect(stats.sent).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.audience).toBe(3);

    const refused = await broadcastRecipientList.call(
      { id: saved.id, state: "suppressed" },
      OWNER,
    );
    expect(refused[0]!.email).toBe("person1@example.com");
    // And it says why, rather than leaving an owner to guess.
    expect(refused[0]!.detail).toMatch(/suppressed/i);
  });

  it("sends in batches, and the next call carries on", async () => {
    // A campaign to ten thousand is not one transaction. Each batch commits,
    // so a crash costs the batch rather than the campaign.
    const { segment } = await audience(5);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Batched", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);

    const first = await sendNext.call({ id: saved.id, size: 2 }, { kind: "system" });
    expect(first.remaining).toBe(3);

    const second = await sendNext.call({ id: saved.id, size: 2 }, { kind: "system" });
    expect(second.remaining).toBe(1);

    await sendNext.call({ id: saved.id, size: 2 }, { kind: "system" });
    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.pending).toBe(0);
  });

  it("never sends twice, even if start is called again", async () => {
    const { segment } = await audience(2);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Once", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    // Starting again is refused outright, and the recipient rows are unique
    // per person anyway — belt and braces, because a doubled campaign is the
    // kind of mistake customers remember.
    await expect(startBroadcast.call({ id: saved.id }, OWNER)).rejects.toThrow(
      /already started/i,
    );
    expect(await broadcastRecipientList.call({ id: saved.id }, OWNER)).toHaveLength(2);
  });

  /* --------------------------------------------------------- pause/resume */

  it("pauses part-way and resumes where it stopped", async () => {
    const { segment } = await audience(4);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Interrupted", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await sendNext.call({ id: saved.id, size: 2 }, { kind: "system" });

    await pauseBroadcast.call({ id: saved.id }, OWNER);
    // A paused send does nothing, even when asked.
    const whilePaused = await sendNext.call({ id: saved.id }, { kind: "system" });
    expect(whilePaused.sent).toBe(0);

    const resumed = await resumeBroadcast.call({ id: saved.id }, OWNER);
    expect(resumed.remaining).toBe(2);

    await sendNext.call({ id: saved.id }, { kind: "system" });
    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.pending).toBe(0);
    // What was sent stayed sent: nobody was mailed twice.
    expect(stats.sent + stats.failed + stats.suppressed).toBe(4);
  });

  it("refuses to resume something that is not paused", async () => {
    const { segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Running", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await expect(resumeBroadcast.call({ id: saved.id }, OWNER)).rejects.toThrow(/not paused/i);
  });

  /* ------------------------------------------------------------ scheduling */

  it("starts a scheduled broadcast when its moment arrives", async () => {
    const { segment } = await audience(2);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      {
        name: "Later",
        templateId: template.id,
        segmentId: segment.id,
        scheduledAt: new Date(Date.now() + 3_600_000),
      },
      OWNER,
    );
    expect(saved.status).toBe("scheduled");

    // Nothing is due yet.
    expect((await tick.call({}, { kind: "system" })).started).toBe(0);

    await db()
      .update(broadcasts)
      .set({ scheduledAt: new Date(Date.now() - 1000) })
      .where(eq(broadcasts.id, saved.id));

    const swept = await tick.call({}, { kind: "system" });
    expect(swept.started).toBe(1);
    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.audience).toBe(2);
  });

  it("refuses a send time already in the past", async () => {
    const { segment } = await audience(1);
    const template = await ready_();
    await expect(
      saveBroadcast.call(
        {
          name: "Yesterday",
          templateId: template.id,
          segmentId: segment.id,
          scheduledAt: new Date(Date.now() - 60_000),
        },
        OWNER,
      ),
    ).rejects.toThrow(/already in the past/i);
  });

  /* ---------------------------------------------------------------- edits */

  it("refuses to edit a broadcast that has started", async () => {
    // Half the list getting one wording and half another, with nothing to say
    // which, is worse than refusing the edit.
    const { segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Started", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await expect(
      saveBroadcast.call(
        { id: saved.id, name: "Renamed", templateId: template.id, segmentId: segment.id },
        OWNER,
      ),
    ).rejects.toThrow(/already started/i);
  });

  it("refuses to send to an audience with no email addresses", async () => {
    // A segment nobody is in: an impossible email, rather than an empty rule
    // list the validator would reject.
    const segment = await saveSegment.call(
      {
        name: "Nobody",
        definition: {
          match: "all",
          rules: [{ field: "contact.email", op: "is", value: "nobody@nowhere.invalid" }],
        },
      },
      OWNER,
    );
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Empty", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await expect(startBroadcast.call({ id: saved.id }, OWNER)).rejects.toThrow(
      /nobody in that audience/i,
    );
  });

  /* ---------------------------------------------- bounces and complaints */

  it("records a bounce against the copy that bounced, not the address", async () => {
    // The reason `broadcast_recipients` keeps a delivery id at all. Provider
    // feedback arrives late and names an address; the same person is usually
    // on more than one campaign, and crediting a bounce to whichever campaign
    // mailed them most recently would make both numbers wrong.
    const { segment } = await audience(1);
    const template = await ready_();

    const first = await saveBroadcast.call(
      { name: "January", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: first.id }, OWNER);
    await sendNext.call({ id: first.id }, { kind: "system" });

    const second = await saveBroadcast.call(
      { name: "February", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: second.id }, OWNER);
    await sendNext.call({ id: second.id }, { kind: "system" });

    const [januaryCopy] = await db()
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, first.id));
    expect(januaryCopy!.deliveryId).not.toBeNull();

    await onMailDeliveryUpdated({
      deliveryId: januaryCopy!.deliveryId,
      type: "hard_bounce",
      recipient: januaryCopy!.email,
    });

    expect((await broadcastStats.call({ id: first.id }, OWNER)).bounced).toBe(1);
    // February sent to the same person and did not bounce.
    expect((await broadcastStats.call({ id: second.id }, OWNER)).bounced).toBe(0);
    expect((await broadcastStats.call({ id: second.id }, OWNER)).sent).toBe(1);
  });

  it("records a complaint as a complaint", async () => {
    const { segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Complained about", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await sendNext.call({ id: saved.id }, { kind: "system" });

    const [copy] = await db()
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, saved.id));
    await onMailDeliveryUpdated({
      deliveryId: copy!.deliveryId,
      type: "complaint",
      recipient: copy!.email,
    });

    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.complained).toBe(1);
    expect(stats.bounced).toBe(0);
  });

  it("ignores feedback about a copy that never went out", async () => {
    // Delivered, opened and delayed are not outcomes this table records, and a
    // recipient still pending cannot have bounced.
    const { segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Untouched", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);

    await onMailDeliveryUpdated({
      deliveryId: crypto.randomUUID(),
      type: "delivered",
      recipient: "person0@example.com",
    });
    expect((await broadcastStats.call({ id: saved.id }, OWNER)).pending).toBe(1);
  });

  it("marks a copy bounced from a real provider webhook, end to end", async () => {
    // The whole chain, not the handler alone: a provider event arrives naming
    // a provider reference, `core/mail` matches it to a delivery, emits
    // `mail.deliveryUpdated`, and the campaign's own record follows. The
    // listener reads `deliveryId` and `type` off a payload written in another
    // module, and nothing but this would notice if either were renamed — the
    // handler would simply stop matching and every bounce would go unrecorded.
    const { segment } = await audience(1);
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Bounced", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await sendNext.call({ id: saved.id }, { kind: "system" });
    await flushQueuedMail();

    const [copy] = await db()
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, saved.id));
    const [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, copy!.deliveryId!));

    await recordMailProviderEvent.call(
      {
        provider: "resend",
        externalEventId: `evt-${crypto.randomUUID()}`,
        providerRef: delivery!.providerRef!,
        recipient: copy!.email,
        eventType: "hard_bounce",
        rawDigest: "a".repeat(64),
        occurredAt: new Date().toISOString(),
      },
      { kind: "system" },
    );

    const [event] = await db()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventName, "mail.deliveryUpdated"));
    expect(Object.keys(event!.payload as Record<string, unknown>).sort()).toEqual([
      "deliveryId",
      "eventId",
      "recipient",
      "type",
    ]);
    expect((await broadcastStats.call({ id: saved.id }, OWNER)).bounced).toBe(1);
  });

  it("does not send to somebody who has said no", async () => {
    // Email marketing consent here is the newsletter subscription plus the
    // suppression list (§2096), so no evidence is the ordinary case and is not
    // a refusal. Somebody who actually answered "no" is another matter: no
    // segment definition should be able to talk over them.
    const { people, segment } = await audience(2);
    await recordConsent.call(
      {
        contactId: people[1]!.id,
        purpose: "marketing",
        channel: "email",
        state: "withdrawn",
        method: "preference_center",
      },
      OWNER,
    );
    const template = await ready_();
    const saved = await saveBroadcast.call(
      { name: "Respectful", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: saved.id }, OWNER);
    await sendNext.call({ id: saved.id }, { kind: "system" });

    const stats = await broadcastStats.call({ id: saved.id }, OWNER);
    expect(stats.sent).toBe(1);
    expect(stats.suppressed).toBe(1);
    const refused = await broadcastRecipientList.call(
      { id: saved.id, state: "suppressed" },
      OWNER,
    );
    expect(refused[0]!.email).toBe("person1@example.com");
    expect(refused[0]!.detail).toMatch(/consent/i);
  });

  it("refuses to send wording that was archived", async () => {
    const { segment } = await audience(1);
    const template = await saveTemplate.call(
      {
        kind: "campaign",
        name: "Retired",
        subject: "Old",
        blocks: body("Old wording."),
        status: "archived",
      },
      OWNER,
    );
    const saved = await saveBroadcast.call(
      { name: "Archived wording", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await expect(startBroadcast.call({ id: saved.id }, OWNER)).rejects.toThrow(/archived/i);
  });

  it("lists broadcasts by status", async () => {
    const { segment } = await audience(1);
    const template = await ready_();
    await saveBroadcast.call(
      { name: "A draft", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    expect(await listBroadcasts.call({ status: "draft" }, OWNER)).toHaveLength(1);
    expect(await listBroadcasts.call({ status: "sent" }, OWNER)).toHaveLength(0);
  });
});
