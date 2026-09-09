// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Push registration and the spine obligations it carries (C10.14).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { deviceTokens } from "@/core/notifications/schema";
import {
  devicesForContact,
  forgetDeadToken,
  registerDevice,
  revokeDevice,
} from "@/core/notifications/devices";
import { NOTIFICATION_TOPICS } from "@/core/notifications/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("push notification topics (C10.14)", () => {
  it("carries the four moments §35 says are worth a customer's phone", () => {
    for (const topic of [
      "booking.confirmed",
      "gallery.ready",
      "invoice.due",
      "catalog.backInStock",
    ]) {
      expect(NOTIFICATION_TOPICS).toContain(topic);
    }
  });

  it("keeps them ordinary topics rather than a mobile-only system", () => {
    // §35.1: "A push that says something the platform would not have emailed
    // is a bug." They are in the same list every other channel reads, so they
    // are subject to the same per-topic preferences.
    expect(NOTIFICATION_TOPICS).toContain("briefing.ready");
    expect(new Set(NOTIFICATION_TOPICS).size).toBe(NOTIFICATION_TOPICS.length);
  });
});

describe.runIf(hasDatabase)("device registration (C10.14)", () => {
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  const register = (contactId: string, token: string, platform: "ios" | "android" = "ios") =>
    db().transaction((tx) =>
      registerDevice(tx, {
        contactId,
        token,
        platform,
        appVersion: "1.0.0",
        contractVersion: 1,
      }),
    );

  const contact = async (name: string) =>
    createContact.call({ name, email: `${name}@example.test` }, OWNER);

  it("registers an install and finds it again", async () => {
    const person = await contact("ada");
    await register(person.id, "tok-ada-1");
    const devices = await db().transaction((tx) => devicesForContact(tx, person.id));
    expect(devices).toHaveLength(1);
    expect(devices[0]!.token).toBe("tok-ada-1");
  });

  it("re-registering the same token on every launch does not pile up rows", () => {
    // §35.1: "Tokens expire and are re-registered on every launch."
    return (async () => {
      const person = await contact("bea");
      await register(person.id, "tok-bea");
      await register(person.id, "tok-bea");
      await register(person.id, "tok-bea");
      const devices = await db().transaction((tx) => devicesForContact(tx, person.id));
      expect(devices).toHaveLength(1);
    })();
  });

  it("moves a token that has changed hands rather than duplicating it", async () => {
    // A phone handed on, or a second customer signing in on the same device.
    // Inserting instead would leave the previous owner registered and push
    // somebody else's bookings to the new owner.
    const first = await contact("cal");
    const second = await contact("dee");
    await register(first.id, "tok-shared");
    const result = await register(second.id, "tok-shared");
    expect(result.moved).toBe(true);
    expect(await db().transaction((tx) => devicesForContact(tx, first.id))).toEqual([]);
    expect(await db().transaction((tx) => devicesForContact(tx, second.id))).toHaveLength(1);
  });

  it("revokes an install without forgetting it, and re-registering revives it", async () => {
    const person = await contact("eve");
    await register(person.id, "tok-eve");
    expect(await db().transaction((tx) => revokeDevice(tx, "tok-eve"))).toBe(true);
    expect(await db().transaction((tx) => devicesForContact(tx, person.id))).toEqual([]);
    // The row survives, so a device that signs back in is recognised.
    const [row] = await db().select().from(deviceTokens).where(eq(deviceTokens.token, "tok-eve"));
    expect(row).toBeDefined();

    await register(person.id, "tok-eve");
    expect(await db().transaction((tx) => devicesForContact(tx, person.id))).toHaveLength(1);
  });

  it("deletes a token the provider called dead, rather than revoking it", async () => {
    // §35.1: "retrying a dead token forever is how a push budget disappears."
    const person = await contact("fay");
    await register(person.id, "tok-fay");
    await db().transaction((tx) => forgetDeadToken(tx, "tok-fay"));
    const rows = await db().select().from(deviceTokens).where(eq(deviceTokens.token, "tok-fay"));
    expect(rows).toEqual([]);
  });

  it("reaches every phone a person carries", async () => {
    const person = await contact("gus");
    await register(person.id, "tok-gus-phone", "ios");
    await register(person.id, "tok-gus-tablet", "android");
    const devices = await db().transaction((tx) => devicesForContact(tx, person.id));
    expect(devices.map((device) => device.platform).sort()).toEqual(["android", "ios"]);
  });

  describe("the spine obligation", () => {
    it("repoints device tokens when two duplicates are merged", async () => {
      // CLAUDE.md: a module that adds a contact_id column must repoint it in
      // contacts.merge. Without this the first merge orphans every push token
      // — the silent fork the spine exists to prevent.
      const keep = await contact("keep");
      const drop = await contact("drop");
      await register(keep.id, "tok-keep");
      await register(drop.id, "tok-drop");

      await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);

      const devices = await db().transaction((tx) => devicesForContact(tx, keep.id));
      expect(devices.map((device) => device.token).sort()).toEqual(["tok-drop", "tok-keep"]);

      // Nothing left pointing at the contact that no longer exists.
      const orphans = await db()
        .select({ id: deviceTokens.id })
        .from(deviceTokens)
        .where(and(eq(deviceTokens.contactId, drop.id), isNull(deviceTokens.revokedAt)));
      expect(orphans).toEqual([]);
    });
  });
});
