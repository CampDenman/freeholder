// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Regression coverage for the client-readiness audit (C11.10).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { ANONYMOUS, OWNER, closeDb, hasDatabase, truncateSpine } from '../helpers/spine';
import { updateBusiness } from '@/core/settings/service';
import { joinWaitlist } from '@/core/scheduling/waitlist';
import { resolveContact } from '@/core/contacts/service';
import { saveProgram, issueCode, recordTouch, attributionFor, invite, acceptInvitation } from '@/modules/referrals/service';
import { consumeCustomerMagicLink } from '@/core/auth/magic-links/service';
import { createEvent, addEventSession, addEventTicket, publishEvent, registerForEvent, cancelRegistration, checkInRegistration } from '@/modules/events/service';
import { registerOwner } from '@/core/auth/service';
import { saveProgram as loyaltyProgram, enrol, adjustPoints, saveReward, redeem } from '@/modules/loyalty/service';
import { pointsLedger } from '@/modules/loyalty/schema';
import { applyUpdate, takeSnapshot } from '@/core/update/apply';
import { resetEnvForTests } from '@/core/env';
import { eventTickets, eventRegistrations } from '@/modules/events/schema';


describe.runIf(hasDatabase)("client readiness security regressions", { timeout: 60_000 }, () => {
beforeAll(async () => {
  await truncateSpine();
  await updateBusiness.call({ name: 'Audit', country: 'CA', baseCurrency: 'CAD', timezone: 'America/Vancouver' }, OWNER);
}, 120_000);
afterAll(closeDb);

it('requires the deployment secret before creating the first owner', async () => {
  vi.stubEnv('BOOTSTRAP_SECRET', 'regression-operator-secret-at-least-32-chars');
  resetEnvForTests();
  try {
  await expect(registerOwner.call({ email: 'outsider@example.test', password: 'audit-attacker-password-123' }, ANONYMOUS)).rejects.toMatchObject({ code: 'permission' });
  const result = await registerOwner.call({ email: 'outsider@example.test', password: 'audit-attacker-password-123', bootstrapSecret: 'regression-operator-secret-at-least-32-chars' }, ANONYMOUS);
  expect(result.userId).toBeTruthy();
  expect(result.token).toBeTruthy();
  } finally { vi.unstubAllEnvs(); resetEnvForTests(); }
});

it('anonymous waitlist repeats reveal no stored contact or offer details', async () => {
  const input = { contact: { email: 'victim@example.test' }, windowStart: '2026-12-01T10:00:00Z', windowEnd: '2026-12-01T11:00:00Z' };
  const original = await joinWaitlist.call({ ...input, notes: 'Private accessibility and scheduling details' }, OWNER);
  const leaked = await joinWaitlist.call(input, ANONYMOUS);
  expect(original).toEqual({ ok: true });
  expect(leaked).toEqual({ ok: true });
});

it('anonymous callers cannot forge referral attribution', async () => {
  const program = await saveProgram.call({ name: 'Audit referrals', status: 'active' }, OWNER);
  const { contact: referrer } = await resolveContact.call({ email: 'referrer@example.test' }, OWNER);
  const { contact: victim } = await resolveContact.call({ email: 'victim@example.test' }, OWNER);
  await issueCode.call({ programId: program.id, contactId: referrer.id, code: 'AUDITCODE' }, OWNER);
  await expect(recordTouch.call({ code: 'AUDITCODE', contactId: victim.id }, ANONYMOUS)).rejects.toMatchObject({ code: 'permission' });
  const credit = await attributionFor.call({ contactId: victim.id, programId: program.id }, OWNER);
  expect(credit.credits).toHaveLength(0);
  const invitation = await invite.call({ referrerContactId: referrer.id,
    codeId: (await issueCode.call({ programId: program.id, contactId: referrer.id, code: 'INVITECODE' }, OWNER)).id,
    channel: 'email', inviteeEmail: 'intended@example.test' }, OWNER);
  await expect(acceptInvitation.call({ token: invitation.token, email: 'victim@example.test' }, ANONYMOUS)).rejects.toMatchObject({ code: 'permission' });
});

it('invalid tokens cannot exhaust an unrelated customer login bucket', async () => {
  for (let i = 0; i < 20; i++) {
    await expect(consumeCustomerMagicLink.call({ token: `invalid-token-for-audit-${i}` }, ANONYMOUS)).rejects.toMatchObject({ code: 'permission' });
  }
  await expect(consumeCustomerMagicLink.call({ token: 'unrelated-customer-token-12345' }, ANONYMOUS)).rejects.toMatchObject({ code: 'permission' });
});

it('registration rejects foreign tickets, missing tickets and unpaid admission', async () => {
  const a = await createEvent.call({ name: 'Paid workshop', slug: 'audit-paid' }, OWNER);
  const b = await createEvent.call({ name: 'Other event', slug: 'audit-other' }, OWNER);
  const session = await addEventSession.call({ eventId: a.id, startsAt: new Date('2026-12-01T10:00:00Z'), endsAt: new Date('2026-12-01T11:00:00Z'), capacity: 10, waitlistEnabled: true }, OWNER);
  const paid = await addEventTicket.call({ eventId: a.id, name: 'Paid admission', priceMinor: 5000 }, OWNER);
  const foreign = await addEventTicket.call({ eventId: b.id, name: 'Different event', priceMinor: 0 }, OWNER);
  const inactive = await addEventTicket.call({ eventId: a.id, name: 'Inactive admission', priceMinor: 0 }, OWNER);
  await db().update(eventTickets).set({ active: false }).where(eq(eventTickets.id, inactive.id));
  await publishEvent.call({ id: a.id, expectedVersion: a.version }, OWNER);
  for (const ticketId of [undefined, foreign.id, inactive.id, paid.id]) {
    await expect(registerForEvent.call({ eventId: a.id, sessionId: session.id, ticketId, email: 'visitor@example.test' }, ANONYMOUS)).rejects.toMatchObject({ code: ticketId === paid.id ? 'conflict' : 'validation' });
  }
  const free = await addEventTicket.call({ eventId: a.id, name: 'Free admission', priceMinor: 0 }, OWNER);
  const occupied = await registerForEvent.call({ eventId: a.id, sessionId: session.id, ticketId: free.id, email: 'group@example.test', quantity: 10 }, ANONYMOUS);
  const waiting = await registerForEvent.call({ eventId: a.id, sessionId: session.id, ticketId: free.id, email: 'waiting@example.test' }, ANONYMOUS);
  // Simulate invalid legacy rows created by the vulnerable build.
  await db().update(eventRegistrations).set({ ticketId: null }).where(eq(eventRegistrations.id, waiting.id));
  await cancelRegistration.call({ id: occupied.id }, OWNER);
  const [held] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, waiting.id));
  expect(held?.status).toBe('waitlisted');
  await db().update(eventRegistrations).set({ status: 'confirmed', ticketId: paid.id }).where(eq(eventRegistrations.id, waiting.id));
  await expect(checkInRegistration.call({ id: waiting.id }, OWNER)).rejects.toMatchObject({ code: 'conflict' });
});

it('concurrent loyalty redemptions cannot spend the same points twice', async () => {
  const program = await loyaltyProgram.call({ name: 'Audit loyalty', status: 'active', earnCurrency: 'CAD', redemptionValueCents: 2, enrolment: 'automatic' }, OWNER);
  const { contact } = await resolveContact.call({ email: 'loyal@example.test' }, OWNER);
  const { accountId } = await enrol.call({ contactId: contact.id, programId: program.id }, OWNER);
  await adjustPoints.call({ accountId, delta: 200, note: 'Audit initial points' }, OWNER);
  const rewards = [];
  for (let i = 0; i < 4; i++) rewards.push(await saveReward.call({ programId: program.id, name: `Reward ${i}`, kind: 'discount', costPoints: 200, value: { percentOffPpm: 100000 }, status: 'active', stock: 1, perContactLimit: 1 }, OWNER));
  const results = await Promise.allSettled(rewards.map(reward => redeem.call({ accountId, rewardId: reward.id }, OWNER)));
  const rows = await db().select().from(pointsLedger).where(eq(pointsLedger.accountId, accountId));
  const balance = rows.reduce((n, row) => n + row.delta, 0);
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  expect(balance).toBe(0);

  const shared = await saveReward.call({ programId: program.id, name: 'Last item', kind: 'discount', costPoints: 200, value: { percentOffPpm: 100000 }, status: 'active', stock: 1 }, OWNER);
  const accounts = [];
  for (const email of ['stock-one@example.test', 'stock-two@example.test']) {
    const { contact: customer } = await resolveContact.call({ email }, OWNER);
    const account = await enrol.call({ contactId: customer.id, programId: program.id }, OWNER);
    await adjustPoints.call({ accountId: account.accountId, delta: 200, note: 'Stock race fixture' }, OWNER);
    accounts.push(account.accountId);
  }
  const stockRace = await Promise.allSettled(accounts.map(id => redeem.call({ accountId: id, rewardId: shared.id }, OWNER)));
  expect(stockRace.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});

it('self-host compose honors the image pin used by rollback', () => {
  const compose = parse(readFileSync('deploy/docker-selfhost/infra/compose.yml', 'utf8')) as { services: { app: { image: string } } };
  expect(compose.services.app.image).toBe('${FREEHOLDER_IMAGE:-ghcr.io/campdenman/freeholder:edge}');
});

it('cannot claim a fingerprint is a recoverable snapshot', async () => {
  await expect(takeSnapshot('audit')).rejects.toMatchObject({ code: 'conflict' });
});

it('refuses unsafe updates before any deploy or rollback command', async () => {
  const pull = vi.fn(), cutover = vi.fn(), rollbackCutover = vi.fn();
  await expect(applyUpdate({ actor: OWNER, target: { pull, cutover, rollbackCutover } })).rejects.toMatchObject({ code: 'conflict' });
  expect(pull).not.toHaveBeenCalled();
  expect(cutover).not.toHaveBeenCalled();
  expect(rollbackCutover).not.toHaveBeenCalled();
});
});
