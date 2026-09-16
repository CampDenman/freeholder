// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Guardrails the module enforces *outside* the model (MASTER.md §31, C9.23).
//
// §31 is explicit that refusals, escalation and "never invent a price" are
// settings, not prompt text. A model asked not to invent $99 will still invent
// $99; a function that reads the reply against the notes will not. Everything
// in this file is therefore a read of the visitor's words or the model's
// words against owner-chosen lists and retrieved notes. Nothing here asks a
// provider anything.
//
// **Refuse and escalate are matches, not instructions.** A topic the owner
// typed is a substring, case-insensitive, two characters or more. That is
// crude on purpose: an owner writing "refund" expects "I want a refund" to
// match, and a regex they did not write is a setting they cannot see.
//
// **Prices and availability are claims.** A number is only a price when a
// currency signal sits next to it; "established 1999" is not a price.
// Availability is a closed list of phrases ("in stock", "fully booked",
// "available on"). Either kind of claim is allowed only when the same
// normalised token already appears in the notes the retriever handed over.
// Anything else is replaced with a canned "I do not have that to hand" —
// the visitor is told the truth, and the owner gets a knowledge gap.
import type { AssistantTone } from "./contract";

const PRICE_RE =
  /(?:[$£€¥]|CAD|USD|EUR|GBP|AUD|NZD)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:CAD|USD|EUR|GBP|AUD|NZD|dollars?|euros?|pounds?)\b/gi;

const AVAILABILITY_RE =
  /\b(?:in stock|out of stock|fully booked|booked until|no availability|available on|we have availability|slots? (?:left|available|open)|free on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|can take you|opening on)\b/gi;

const UNKNOWN_RE =
  /do not have .{0,40} to hand|don't have .{0,40} to hand|i don't know|i do not know|i'm not sure|i am not sure/i;

const MAX_TOPICS = 40;
const MAX_TOPIC_LENGTH = 80;
const MIN_TOPIC_LENGTH = 2;

export function parseTopics(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n,]+/)) {
    const topic = piece.trim();
    if (topic.length < MIN_TOPIC_LENGTH || topic.length > MAX_TOPIC_LENGTH) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/** The first owner-chosen topic that appears in `text`, or null. */
export function matchingTopic(
  text: string,
  topics: readonly string[],
): string | null {
  const haystack = text.toLowerCase();
  for (const topic of topics) {
    const needle = topic.trim().toLowerCase();
    if (needle.length < MIN_TOPIC_LENGTH) continue;
    if (haystack.includes(needle)) return topic.trim();
  }
  return null;
}

function normalizePrice(token: string): string {
  return token
    .toLowerCase()
    .replace(/[,\s]/g, "")
    .replace(/[^\d.]/g, "")
    .replace(/\.00$/, "");
}

function pricesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(PRICE_RE)) {
    const normalised = normalizePrice(match[0] ?? "");
    if (normalised) found.add(normalised);
  }
  return found;
}

function availabilityIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(AVAILABILITY_RE)) {
    const phrase = (match[0] ?? "").toLowerCase();
    if (phrase) found.add(phrase);
  }
  return found;
}

export interface InventedClaims {
  prices: string[];
  availability: string[];
}

/** Claims in the reply that the notes do not already make. */
export function inventedClaims(
  reply: string,
  notes: readonly { body: string }[],
): InventedClaims {
  const noteText = notes.map((note) => note.body).join("\n");
  const allowedPrices = pricesIn(noteText);
  const allowedAvailability = availabilityIn(noteText);
  const prices: string[] = [];
  const availability: string[] = [];
  for (const price of pricesIn(reply)) {
    if (!allowedPrices.has(price)) prices.push(price);
  }
  for (const phrase of availabilityIn(reply)) {
    if (!allowedAvailability.has(phrase)) availability.push(phrase);
  }
  return { prices, availability };
}

export function admitsUnknown(reply: string): boolean {
  return UNKNOWN_RE.test(reply);
}

function pickLocale(locale: string): "en" | "es" | "fr" {
  const base = locale.trim().toLowerCase().slice(0, 2);
  if (base === "es" || base === "fr") return base;
  return "en";
}

const REFUSE_REPLY = {
  en: "I can't help with that. If you have another question about this business, I'm happy to try.",
  es: "No puedo ayudar con eso. Si tiene otra pregunta sobre este negocio, con gusto lo intento.",
  fr: "Je ne peux pas vous aider là-dessus. Si vous avez une autre question sur cette entreprise, je peux essayer.",
} as const;

const UNKNOWN_REPLY = {
  en: "I don't have that price or availability to hand. I can pass you to a person who does.",
  es: "No tengo ese precio ni esa disponibilidad a mano. Puedo pasarle con una persona que sí los tenga.",
  fr: "Je n'ai pas ce prix ni cette disponibilité sous la main. Je peux vous passer quelqu'un qui les a.",
} as const;

const ESCALATE_SUFFIX = {
  en: "I've asked a person at the business to pick this up.",
  es: "He pedido a una persona del negocio que retome esta conversación.",
  fr: "J'ai demandé à une personne de l'entreprise de reprendre cette conversation.",
} as const;

const FORM_SUFFIX = {
  en: (path: string) => `You can also reach us at ${path}.`,
  es: (path: string) => `También puede escribirnos en ${path}.`,
  fr: (path: string) => `Vous pouvez aussi nous joindre à ${path}.`,
} as const;

export function refuseReply(locale: string): string {
  return REFUSE_REPLY[pickLocale(locale)];
}

export function unknownReply(locale: string, contactFormPath: string | null): string {
  const language = pickLocale(locale);
  const path = contactFormPath?.trim();
  if (path) return `${UNKNOWN_REPLY[language]} ${FORM_SUFFIX[language](path)}`;
  return UNKNOWN_REPLY[language];
}

export function escalateSuffix(
  locale: string,
  contactFormPath: string | null,
  handedOver: boolean,
): string {
  const language = pickLocale(locale);
  const parts: string[] = [];
  if (handedOver) parts.push(ESCALATE_SUFFIX[language]);
  const path = contactFormPath?.trim();
  if (path) parts.push(FORM_SUFFIX[language](path));
  return parts.join(" ");
}

export function toneInstruction(tone: AssistantTone): string {
  switch (tone) {
    case "friendly":
      return "Write in a warm, friendly tone, still concise.";
    case "brief":
      return "Keep every answer to one or two short sentences.";
    default:
      return "Write in a professional, calm tone.";
  }
}

export interface SanitizedReply {
  reply: string;
  invented: boolean;
}

/**
 * Replace a reply that invented a price or an availability claim.
 *
 * The whole reply goes, not the offending clause. Splicing a sentence the
 * model wrote around a number it made up is how a leftover "from $99" survives
 * in the next clause. A canned refusal is the honest answer, and it is the
 * same answer every time, which is what an owner can stand behind.
 */
export function sanitizeReply(
  reply: string,
  notes: readonly { body: string }[],
  locale: string,
  contactFormPath: string | null,
): SanitizedReply {
  const invented = inventedClaims(reply, notes);
  if (invented.prices.length === 0 && invented.availability.length === 0) {
    return { reply, invented: false };
  }
  return { reply: unknownReply(locale, contactFormPath), invented: true };
}

/** A path the visitor can actually open. Relative, or https. */
export function validContactFormPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed.slice(0, 300);
  if (trimmed.startsWith("https://")) return trimmed.slice(0, 300);
  return null;
}
