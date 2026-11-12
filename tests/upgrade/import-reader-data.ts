// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fictional original-reader data shared by two genuinely different runtimes.
import type postgres from "postgres";
export const READER_UPGRADE_EMAIL = "fictional-reader-before-upgrade@example.test";
export const READER_UPGRADE_BODY = "Fictional original private reader body before the upgrade.";
export const READER_UPGRADE_SOURCE = `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-reader-upgrade.example/</link><item><title>Fictional prior article</title><link>https://fictional-reader-upgrade.example/prior-article/</link><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Fictional original article.</p>]]></content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Fictional original reader</wp:comment_author><wp:comment_author_email>${READER_UPGRADE_EMAIL}</wp:comment_author_email><wp:comment_content>${READER_UPGRADE_BODY}</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment></item></channel></rss>`;
export const READER_UPGRADE_TABLES = ["contacts", "import_runs", "blog_reader_comments", "audit_log"] as const;
export async function readerTableSnapshots(client: ReturnType<typeof postgres>) {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of READER_UPGRADE_TABLES) {
    const [row] = await client.unsafe<{ count: number; hash: string }[]>(`select count(*)::int as count,md5(coalesce(jsonb_agg(to_jsonb(original) order by original.id)::text,'[]')) as hash from "${table}" original`);
    result[table] = row!;
  }
  return result;
}
