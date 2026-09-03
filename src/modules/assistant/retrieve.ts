// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Retrieve grounding notes for one visitor question (MASTER.md §31, C9.22).
//
// Rank in the service rather than with a pgvector operator: the corpus is
// tens of rows, the same scale the help-centre body search already scans,
// and a cosine over `real[]` runs on stock Postgres.
import { or, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { assistantChunks } from "./schema";
import { embedText } from "./embed";

export interface RetrievedNote {
  title: string;
  body: string;
  sourceType: string;
  score: number;
}

const LIMIT = 8;
const MIN_SCORE = 0.08;

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

function asVector(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(entry));
}

export async function retrieveNotes(
  tx: Tx,
  question: string,
  locale: string,
): Promise<RetrievedNote[]> {
  const trimmed = question.trim();
  if (!trimmed) return [];
  const query = embedText(trimmed);
  const rows = await tx
    .select({
      title: assistantChunks.title,
      body: assistantChunks.body,
      sourceType: assistantChunks.sourceType,
      embedding: assistantChunks.embedding,
    })
    .from(assistantChunks)
    .where(
      or(
        eq(assistantChunks.locale, locale),
        inArray(assistantChunks.sourceType, ["location", "product"]),
      ),
    );
  return rows
    .map((row) => ({
      title: row.title,
      body: row.body,
      sourceType: row.sourceType,
      score: cosine(query, asVector(row.embedding)),
    }))
    .filter((note) => note.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);
}
