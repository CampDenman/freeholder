// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved views (C7.06, MASTER.md §4.14).
//
// §4.14: "`SavedView` — a filter someone actually uses, kept. Per user,
// shareable."
//
// The design claim under test is that a view is **a named URL**, not a second
// filtering mechanism. Every admin list already filters by reading
// `searchParams` from a GET form, so saving one captures the parameters that
// are already there and opening one navigates back to them — which is what
// makes C7.06's "durable URL/state semantics" a property of the design rather
// than a feature bolted on.
//
// Four rules:
//
//   1. **Shared means visible, never editable.** A saved filter a colleague can
//      quietly redefine answers a different question the next time it opens.
//   2. **A default is per person.** Two people want different first screens.
//   3. **An unknown filter is ignored, not refused**, so a view outlives a
//      renamed parameter.
//   4. **A list nothing declares cannot have a view**, so no dead entries.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import { savedViews } from "@/core/views/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  defaultView,
  listViewEntities,
  listViews,
  meaningfulParams,
  removeView,
  saveView,
  setDefaultView,
  toQueryString,
  viewEntity,
} from "@/core/views/service";
import { closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

describe("what a view keeps of a URL", () => {
  // Flash markers and paging are not part of what a list *is*; a view carrying
  // them would say "Done." every time anybody opened it, on page four.
  it("drops the parameters that are about this visit rather than this list", () => {
    expect(
      meaningfulParams({
        stage: "customer",
        search: "rae",
        saved: "view",
        error: "nope",
        view: "abc",
        offset: "40",
        empty: "",
      }),
    ).toEqual({ stage: "customer", search: "rae" });
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(meaningfulParams({ stage: ["customer", "lead"] })).toEqual({ stage: "customer" });
  });

  // Sorted, so the same view is always the same URL — which is what makes it
  // bookmarkable and comparable.
  it("writes a stable query string", () => {
    expect(toQueryString({ stage: "customer", search: "rae" })).toBe(
      "search=rae&stage=customer",
    );
    expect(toQueryString({})).toBe("");
  });
});

describe("what lists can be saved", () => {
  it("knows core's own", () => {
    expect(viewEntity("contacts")?.path).toBe("/admin/contacts");
    expect(viewEntity("tasks")?.columns).toEqual([]);
  });

  it("knows one a module declared", async () => {
    // Registered from inside the quotes module, so switching it off takes its
    // views with it rather than leaving a dead entry.
    await import("@/modules/quotes/service");
    expect(viewEntity("quotes")?.module).toBe("quotes");
  });

  it("keeps the name column fixed, because it carries the link", () => {
    const name = viewEntity("contacts")?.columns.find((column) => column.key === "name");
    expect(name?.fixed).toBe(true);
  });
});

describe.runIf(hasDatabase)("saved views", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: STAFF.userId, email: "staff@example.test", role: "staff" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function view(overrides: Record<string, unknown> = {}, actor = OWNER) {
    return saveView.call(
      {
        entity: "contacts",
        name: "Ontario customers",
        filters: { stage: "customer", search: "ontario" },
        ...overrides,
      },
      actor,
    );
  }

  it("keeps a list by name", async () => {
    const kept = await view();
    expect(kept).toMatchObject({
      entity: "contacts",
      name: "Ontario customers",
      filters: { stage: "customer", search: "ontario" },
      shared: false,
      isDefault: false,
      ownerUserId: OWNER.userId,
    });
  });

  it("refuses a view of a list nothing declares", async () => {
    const refused = await failure(view({ entity: "unicorns" }));
    // A view of a list nothing can render leaves a dead entry forever.
    expect(refused.message).toContain("not a list");
  });

  it("drops a column this list does not have", async () => {
    const kept = await view({ columns: ["name", "email", "favourite_colour"] });
    expect(kept.columns).toEqual(["name", "email"]);
  });

  it("shows a colleague only what was shared", async () => {
    await view({ name: "Mine alone" });
    await view({ name: "For everybody", shared: true });

    const colleague = await listViews.call({ entity: "contacts" }, STAFF);
    expect(colleague.map((one) => one.name)).toEqual(["For everybody"]);
    // And it is marked as somebody else's, so nothing offers to edit it.
    expect(colleague[0]!.mine).toBe(false);

    const owner = await listViews.call({ entity: "contacts" }, OWNER);
    expect(owner.map((one) => one.name).sort()).toEqual(["For everybody", "Mine alone"]);
    expect(owner.every((one) => one.mine)).toBe(true);
  });

  // Shared makes a view visible; it never makes it theirs.
  it("refuses to let a colleague redefine a shared view", async () => {
    const shared = await view({ name: "For everybody", shared: true });
    const refused = await failure(
      saveView.call(
        { id: shared.id, entity: "contacts", name: "Hijacked", filters: {} },
        STAFF,
      ),
    );
    expect(refused.message).toContain("not here");
  });

  it("refuses to let a colleague forget a shared view", async () => {
    const shared = await view({ name: "For everybody", shared: true });
    const refused = await failure(removeView.call({ id: shared.id }, STAFF));
    expect(refused.message).toContain("not here");
    expect(await db().select().from(savedViews)).toHaveLength(1);
  });

  it("keeps one default per person, not per business", async () => {
    const first = await view({ name: "First", isDefault: true });
    const second = await view({ name: "Second", isDefault: true });

    // The second replaces the first rather than colliding with the index.
    const mine = await defaultView.call({ entity: "contacts" }, OWNER);
    expect(mine?.id).toBe(second.id);
    expect(mine?.name).toBe("Second");
    void first;

    // And a colleague's default is their own business.
    expect(await defaultView.call({ entity: "contacts" }, STAFF)).toBeNull();
  });

  it("lets somebody drop their default without deleting the view", async () => {
    const kept = await view({ isDefault: true });
    await setDefaultView.call({ entity: "contacts", id: null }, OWNER);
    expect(await defaultView.call({ entity: "contacts" }, OWNER)).toBeNull();
    expect(await db().select().from(savedViews)).toHaveLength(1);
    void kept;
  });

  // Making somebody else's shared view your default cannot write to their row.
  it("copies a colleague's shared view when it becomes somebody's default", async () => {
    const shared = await view({ name: "For everybody", shared: true });
    await setDefaultView.call({ entity: "contacts", id: shared.id }, STAFF);

    const theirs = await defaultView.call({ entity: "contacts" }, STAFF);
    expect(theirs).toMatchObject({
      name: "For everybody",
      ownerUserId: STAFF.userId,
      // Their copy, so the original owner's later edits do not silently change
      // what opens for them — and their copy is not itself re-shared.
      shared: false,
      isDefault: true,
    });
    expect(theirs!.id).not.toBe(shared.id);
    // The owner's own view is untouched, and still not their default.
    expect(await defaultView.call({ entity: "contacts" }, OWNER)).toBeNull();
  });

  it("refuses to make a colleague's private view anybody's default", async () => {
    const mine = await view({ name: "Mine alone" });
    const refused = await failure(
      setDefaultView.call({ entity: "contacts", id: mine.id }, STAFF),
    );
    expect(refused.message).toContain("not here");
  });

  it("changes a view somebody owns", async () => {
    const kept = await view();
    const changed = await saveView.call(
      {
        id: kept.id,
        entity: "contacts",
        name: "Ontario leads",
        filters: { stage: "lead" },
        shared: true,
      },
      OWNER,
    );
    expect(changed).toMatchObject({ name: "Ontario leads", filters: { stage: "lead" }, shared: true });
  });

  it("forgets a view its owner asks it to", async () => {
    const kept = await view();
    await removeView.call({ id: kept.id }, OWNER);
    expect(await db().select().from(savedViews)).toHaveLength(0);
  });

  // A view saved before a filter was renamed still opens; it filters by less.
  it("keeps a filter this list no longer understands", async () => {
    const kept = await view({ filters: { stage: "customer", gone: "yes" } });
    expect(kept.filters).toEqual({ stage: "customer", gone: "yes" });
    // Refusing to load it would punish somebody for a change they did not make.
    const listed = await listViews.call({ entity: "contacts" }, OWNER);
    expect(listed[0]!.filters.gone).toBe("yes");
  });

  it("only offers lists somebody may actually look at", async () => {
    const forOwner = await listViewEntities.call({}, OWNER);
    expect(forOwner.map((one) => one.key)).toContain("contacts");

    const stranger = await listViewEntities.call(
      {},
      { kind: "user", userId: STAFF.userId, role: "staff", grants: [{ module: "media", access: "view" }] },
    );
    expect(stranger.map((one) => one.key)).not.toContain("contacts");
  });
});
