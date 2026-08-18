// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The service registry — the single choke point (MASTER.md §11). Admin UI,
// REST API, and MCP all call services; nothing else touches business logic.
// Every mutation, regardless of caller: validates with Zod, checks
// permissions, executes in a transaction, can emit TimelineEvents, and writes
// AuditLog *inside the same transaction*. A service method that skips any of
// these cannot be constructed — the invariant lives in this wrapper, not in
// code review.
//
// Services compose through `ctx.call` / `ctx.callAsSystem`, which reuse the
// caller's transaction. That is deliberate: §11 routes all inter-module
// traffic through services, and §2 principle 12 requires one transaction per
// multi-table mutation — so composition must not mean a second transaction on
// a second connection.
import type { z } from "zod";
import { db, type Database } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { writeTimelineEvent } from "@/core/events";
import { dispatchNow, enqueue } from "@/core/events/outbox";
import type { TimelineEventInput } from "@/core/events";
import { consume, rateLimitKey, type RateLimitPolicy } from "@/core/security/rate-limit";
import {
  enqueueJob,
  type EnqueuedJob,
  type EnqueueJobOptions,
} from "@/core/jobs";
import { ready } from "@/core/runtime";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type GrantAccess = "view" | "manage";

export interface ModuleGrant {
  module: string;
  access: GrantAccess;
}

export interface RequestMetadata {
  /** Transient source address reported by the deployment proxy. */
  ip?: string;
  /** Sanitized and bounded at the HTTP boundary. */
  userAgent?: string;
}

type ActorIdentity =
  | {
      kind: "user";
      userId: string;
      role: string;
      grants: readonly ModuleGrant[];
      /** Present on actors resolved from a live browser session. */
      sessionId?: string;
      security?: {
        twoFactorRequired: boolean;
        twoFactorEnrolled: boolean;
        twoFactorVerified: boolean;
        stepUpValid: boolean;
      };
    }
  | { kind: "agent"; keyName: string; scopes: string[] }
  | { kind: "system" }
  | { kind: "anonymous" };

export type Actor = ActorIdentity & {
  /** Request context is advisory metadata, never authorization input. */
  request?: RequestMetadata;
};

/**
 * A service declares only whether it is public, personal to a signed-in user,
 * or governed by module grants. No role name appears in this contract.
 */
export type Permission = "public" | "authenticated" | "scoped";

export class ServiceError extends Error {
  constructor(
    readonly code:
      | "validation"
      | "permission"
      | "not_found"
      | "conflict"
      | "rate_limited"
      | "step_up_required"
      | "internal",
    message: string,
    /** Seconds until a rate-limited caller may retry; surfaced as Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function actorString(actor: Actor): string {
  switch (actor.kind) {
    case "user":
      return `user:${actor.userId}`;
    case "agent":
      // An agent hired through core/agents holds a key already named
      // `agent:<worker>`, so prefixing unconditionally produced
      // "agent:agent:Inbox triager" in the audit trail an owner reads. The
      // prefix is what marks the actor kind; a key that already carries it
      // does not need a second.
      return actor.keyName.startsWith("agent:")
        ? actor.keyName
        : `agent:${actor.keyName}`;
    case "system":
      return "system";
    case "anonymous":
      return "anonymous";
  }
}

/**
 * The whole authorization decision, as one pure function — exported so the
 * matrix can be tested exhaustively without a database standing behind it.
 * `public` admits anyone including unscoped API keys, which is the same reach
 * an anonymous visitor already has, so it grants nothing extra.
 */
export function permits(
  actor: Actor,
  required: Permission,
  serviceName: string,
  kind: "query" | "mutation" = "mutation",
): boolean {
  if (actor.kind === "system") return true;
  if (required === "public") return true;
  if (actor.kind === "anonymous") return false;
  if (actor.kind === "agent") {
    if (required === "authenticated") return false;
    const family = `${serviceName.split(".")[0]}.*`;
    return actor.scopes.includes(serviceName) || actor.scopes.includes(family);
  }
  if (required === "authenticated") return true;
  return hasModuleAccess(
    actor,
    serviceName.split(".")[0]!,
    kind === "query" ? "view" : "manage",
  );
}

/** The same stored-grant decision used by services, routes, and navigation. */
export function hasModuleAccess(
  actor: Actor,
  module: string,
  required: GrantAccess = "view",
): boolean {
  if (actor.kind === "system") return true;
  if (actor.kind !== "user") return false;
  if (
    actor.security?.twoFactorRequired &&
    (!actor.security.twoFactorEnrolled || !actor.security.twoFactorVerified)
  ) {
    return false;
  }
  const applicable = actor.grants.filter(
    (candidate) => candidate.module === "*" || candidate.module === module,
  );
  if (required === "view") return applicable.length > 0;
  // The database does not promise row order. A wildcard and a specific grant
  // may coexist, so authorization must depend on their meaning rather than on
  // whichever row happened to be returned first.
  return applicable.some((grant) => grant.access === "manage");
}

const REDACTED_KEY =
  /pass(word)?|secret|token|otp|key|credential|response|classificationNote/i;

/** Secrets never reach the audit trail, whatever shape the input takes. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        REDACTED_KEY.test(k) ? "[redacted]" : redact(v),
      ]),
    );
  }
  return value;
}

export interface QueuedEvent {
  eventName: string;
  payload: unknown;
  /** The outbox row, once the outermost call has written it. */
  id?: string;
}

/**
 * How a composed call joins its parent instead of starting its own work.
 * Callers outside the service layer never pass this — `ctx.call` does.
 */
export interface ServiceCallOptions {
  /** Reuse this transaction rather than opening one. */
  tx?: Tx;
  /** Append bus events here so the outermost call publishes them. */
  queued?: QueuedEvent[];
}

export interface ServiceContext {
  tx: Tx;
  actor: Actor;
  /** Written inside the transaction (§4.1: modules write, the CRM reads). */
  emitTimeline: (event: TimelineEventInput) => Promise<void>;
  /** Names what the audit row is about: setSubject("contact", id). */
  setSubject: (subjectType: string, subjectId: string) => void;
  /** Queues a bus event; published to listeners only after commit (§11). */
  queueEvent: (eventName: string, payload: unknown) => void;
  /**
   * Insert durable background work through this caller's transaction. The
   * returned id is stable when an idempotency key suppresses a duplicate.
   */
  queueJob: (
    name: string,
    data?: Record<string, unknown>,
    options?: EnqueueJobOptions,
  ) => Promise<EnqueuedJob>;
  /**
   * Call another service inside *this* transaction, as the same actor.
   * Composition is how modules reach each other (§11), and sharing the
   * transaction is what makes a multi-service mutation atomic (§2 principle
   * 12) — a quote that issues a deposit invoice either does both or neither.
   */
  call: <I extends z.ZodType, O>(
    service: Service<I, O>,
    input: z.input<I>,
  ) => Promise<O>;
  /**
   * Same, but as `system` — for machinery the caller is allowed to *trigger*
   * yet not to perform directly (an anonymous form submission resolving a
   * contact). Deliberately a separate, greppable name: privilege escalation
   * inside the spine is never implicit. Both audit rows are still written,
   * so the chain from real actor to elevated effect stays readable.
   */
  callAsSystem: <I extends z.ZodType, O>(
    service: Service<I, O>,
    input: z.input<I>,
  ) => Promise<O>;
  /**
   * Attribute a composed operation to a named, narrowly-scoped builder.
   *
   * This is not ambient impersonation: the parent service still authorizes
   * the human approval, names the exact key and scopes in code, shares the
   * transaction, and receives its own audit row. The nested mutation receives
   * the ordinary agent permission check and its audit row says who authored
   * the content rather than pretending the approving owner typed it.
   */
  callAsAgent: <I extends z.ZodType, O>(
    keyName: string,
    scopes: string[],
    service: Service<I, O>,
    input: z.input<I>,
  ) => Promise<O>;
}

/**
 * Throttling declared on the service rather than bolted onto a route.
 *
 * §2 principle 7 is the reason: the admin UI, a server action, the REST API and
 * an MCP tool all reach the same service, so a limit enforced at any one of
 * those doors is a limit the other three walk around. Declared here it applies
 * wherever the call comes from, exactly as the permission check does.
 */
export interface ServiceRateLimit extends RateLimitPolicy {
  /**
   * What to count separately — the email being attempted, the caller's IP.
   * Return undefined to skip counting this particular call.
   */
  subject: (input: never) => string | undefined;
  /** Message shown when the limit is hit. Written for a person, not a log. */
  message: string;
}

export interface ServiceDef<In extends z.ZodType, Out> {
  /** Dotted "<module>.<verb>": "contacts.create", "auth.login"… */
  name: string;
  summary: string;
  kind: "query" | "mutation";
  permission: Permission;
  input: In;
  /**
   * Required public return shape (C3.01). Validated after the handler in
   * development and tests so a service cannot quietly return something the
   * contract does not describe. Optional only while the remaining services
   * are being annotated; the completeness gate refuses a missing schema.
   */
  output?: z.ZodType;
  /** Optional throttle, consumed before the transaction opens. */
  rateLimit?: ServiceRateLimit & { subject: (input: z.output<In>) => string | undefined };
  /** Require a fresh second-factor proof from an interactive user session. */
  stepUp?: boolean;
  /**
   * False when the operation inherently needs a person at the controls, such
   * as reviewing generated accessibility copy. It remains in the human UI and
   * HTTP contract, but API-key actors are refused and MCP never advertises it.
   */
  agentCallable?: boolean;
  handler: (input: z.output<In>, ctx: ServiceContext) => Promise<Out>;
}

export interface Service<In extends z.ZodType = z.ZodType, Out = unknown> {
  def: ServiceDef<In, Out>;
  call(
    rawInput: unknown,
    actor: Actor,
    options?: ServiceCallOptions,
  ): Promise<Out>;
}

export function defineService<In extends z.ZodType, Out>(
  def: ServiceDef<In, Out>,
): Service<In, Out> {
  return {
    def,
    async call(
      rawInput: unknown,
      actor: Actor,
      options?: ServiceCallOptions,
    ): Promise<Out> {
      if (!permits(actor, def.permission, def.name, def.kind)) {
        // Written for whoever reads it, which is a business owner looking at a
        // form that just refused them — not the author of this file. The old
        // message ("anonymous may not call settings.updateBusiness.") reached
        // the setup wizard verbatim and named an internal service to someone
        // who has no idea what one is. The actor and service still reach the
        // audit trail and the server log, where they are useful.
        throw new ServiceError(
          "permission",
          actor.kind === "anonymous"
            ? "You are not signed in, or your session has expired. Sign in and try again."
            : actor.kind === "agent"
              // An API key is read by a developer, not by a business owner, and
              // naming the missing scope is the whole difference between a
              // five-second fix and an afternoon. The service name is safe to
              // give them: they already hold a credential for this instance,
              // and §28 publishes the whole registry to them anyway.
              ? `This API key is not allowed to call ${def.name}. Grant it "${def.name}" or "${def.name.split(".")[0]}.*" in Settings.`
              : `Your role does not have permission to ${def.kind === "query" ? "view" : "manage"} ${def.name.split(".")[0]}.`,
        );
      }
      if (def.agentCallable === false && actor.kind === "agent") {
        throw new ServiceError(
          "permission",
          "Sign in as a person to perform this human-review action.",
        );
      }
      if (
        def.stepUp &&
        actor.kind !== "system" &&
        actor.kind === "agent"
      ) {
        throw new ServiceError(
          "permission",
          "Sign in as a person to perform this security-sensitive action.",
        );
      }
      if (
        def.stepUp &&
        actor.kind === "user" &&
        actor.security !== undefined &&
        !actor.security.stepUpValid
      ) {
        throw new ServiceError(
          "step_up_required",
          "Confirm your identity with two-factor authentication to continue.",
        );
      }
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; ");
        throw new ServiceError("validation", `${def.name}: ${details}`);
      }

      // A composed call inherits its parent's transaction and event queue; a
      // top-level call owns both. Exactly one transaction per outermost call.
      const inheritedTx = options?.tx;

      // The platform must be wired before a mutation can fan out to the
      // modules listening for it. Awaited here rather than at each entry point
      // because every surface reaches the platform through a service, so this
      // is the one place that cannot be forgotten — and only on the outermost
      // call, since a composed one is already inside a booted graph. See
      // core/runtime.ts for why boot cannot be left to instrumentation alone.
      if (!inheritedTx) await ready();

      // Throttled *before* the transaction opens, and skipped for composed and
      // system calls. A composed call is one step of a mutation the outermost
      // caller was already allowed to make — charging it again would let an
      // internal refactor that adds a step start failing under a limit nobody
      // changed. See rate-limit.ts for why the counter commits separately.
      if (def.rateLimit && !inheritedTx && actor.kind !== "system") {
        const subject = def.rateLimit.subject(parsed.data);
        if (subject !== undefined) {
          const verdict = await consume(
            rateLimitKey(def.name, subject),
            def.rateLimit,
          );
          if (!verdict.allowed) {
            throw new ServiceError(
              "rate_limited",
              def.rateLimit.message,
              verdict.retryAfterSeconds,
            );
          }
        }
      }
      const queued: QueuedEvent[] = options?.queued ?? [];
      let subject: { subjectType: string; subjectId: string } | undefined;

      const run = async (tx: Tx): Promise<Out> => {
        const ctx: ServiceContext = {
          tx,
          actor,
          emitTimeline: (event) =>
            writeTimelineEvent(tx, actorString(actor), event),
          setSubject: (subjectType, subjectId) => {
            subject = { subjectType, subjectId };
          },
          queueEvent: (eventName, payload) => {
            // Recorded *inside* this transaction, so the event commits with
            // the change that caused it or not at all (§11's outbox). The
            // write is deferred to the end of the handler rather than awaited
            // here, because queueEvent's signature is synchronous and every
            // caller in the codebase treats it as fire-and-forget.
            queued.push({ eventName, payload });
          },
          queueJob: (name, data = {}, jobOptions = {}) =>
            enqueueJob(tx, name, data, jobOptions),
          call: (service, input) => service.call(input, actor, { tx, queued }),
          callAsSystem: (service, input) =>
            service.call(input, { kind: "system" }, { tx, queued }),
          callAsAgent: (keyName, scopes, service, input) =>
            service.call(
              input,
              { kind: "agent", keyName, scopes },
              { tx, queued },
            ),
        };
        const out = assertOutput(def, await def.handler(parsed.data, ctx));

        // The outermost call owns the outbox rows: a composed call shares the
        // queue, and writing them per-nested-call would order them by who
        // finished first rather than by what happened.
        if (!inheritedTx) {
          for (const event of queued) {
            event.id = await enqueue(tx, event.eventName, event.payload);
          }
        }

        if (def.kind === "mutation") {
          await tx.insert(auditLog).values({
            actor: actorString(actor),
            action: def.name,
            subjectType: subject?.subjectType,
            subjectId: subject?.subjectId,
            diff: redact(parsed.data) ?? {},
          });
        }
        return out;
      };

      const result = inheritedTx
        ? await run(inheritedTx)
        : await db().transaction(run);

      // Only the outermost call dispatches, and only after its commit — a
      // listener must never observe state that later rolled back (§11). The
      // rows are already durable, so a crash here costs latency rather than
      // the event.
      if (!inheritedTx) {
        await dispatchNow(
          queued
            .filter((event): event is Required<QueuedEvent> => Boolean(event.id))
            .map(({ id, eventName, payload }) => ({ id, eventName, payload })),
        );
      }
      return result;
    },
  };
}

/**
 * C3.01: a declared output schema is the contract. In development and tests
 * a mismatch is a thrown error so the handler cannot quietly lie. Production
 * logs and still returns the handler value — a live instance must not 500
 * because a new column appeared on a row the schema has not listed yet.
 */
function assertOutput<Out>(def: ServiceDef<z.ZodType, Out>, out: Out): Out {
  if (!def.output) return out;
  const parsed = def.output.safeParse(out);
  if (parsed.success) return parsed.data as Out;
  const message = `${def.name} returned a shape its output schema rejects: ${parsed.error.message}`;
  if (process.env.NODE_ENV === "production") {
    console.error(message);
    return out;
  }
  throw new ServiceError("internal", message);
}

const registry = new Map<string, Service>();

export function registerService(service: Service): void {
  const existing = registry.get(service.def.name);
  // Registering the *same* service again is a no-op, not an error. Boot is a
  // precondition now (core/runtime.ts) rather than a one-shot startup step, so
  // a graph can legitimately be asked to boot more than once. What must still
  // fail is two *different* services claiming one name — that is a collision
  // between modules, and silently letting the second win would route calls to
  // whichever happened to load last.
  if (existing === service) return;
  if (existing) {
    throw new Error(`service "${service.def.name}" registered twice`);
  }
  registry.set(service.def.name, service);
}

export function getService(name: string): Service {
  const service = registry.get(name);
  if (!service) {
    throw new ServiceError("not_found", `no service named "${name}"`);
  }
  return service;
}

export function listServices(): ReadonlyMap<string, Service> {
  return registry;
}

export function resetRegistryForTests(): void {
  registry.clear();
}
