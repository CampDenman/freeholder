// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Blog structure: posts, categories, tags and authors (C2.27, C2.28).
//
// A post is still an ordinary CMS page — block tree, revisions, working copy,
// approval, publish — and `blog_posts` is the row that says "this page is a
// post", so a post can live at any path (an imported WordPress permalink keeps
// its exact address) instead of only under `blog/`. Everything a post has that
// a page does not hangs off that row: its author, its categories and tags, and
// whether it takes comments.
//
// Category, tag and author archives are not pages. They are resolved by path
// at request time from these rows, listed in the sitemap only while they have
// a published post, and carry their own SEO fields. An archive with nothing in
// it is a thin page; one that appears the moment its first post is published
// needs no owner to remember to make it.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { users } from "@/core/auth/schema";
import { pages } from "./schema";

export const BLOG_TAXONOMIES = ["category", "tag"] as const;
export type BlogTaxonomy = (typeof BLOG_TAXONOMIES)[number];

/**
 * Where new archives live, and how many posts a listing page shows. One row;
 * the key is fixed so there is never a second answer.
 */
export const blogSettings = pgTable("blog_settings", {
  key: text("key").primaryKey().default("site"),
  categoryBase: text("category_base").notNull().default("blog/category"),
  tagBase: text("tag_base").notNull().default("blog/tag"),
  authorBase: text("author_base").notNull().default("blog/author"),
  postsPerPage: integer("posts_per_page").notNull().default(12),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * A person a post is by. Either an account on this site (`user_id`) or a
 * profile that cannot sign in — a guest writer, or the author of an imported
 * post. `email` is private: it only matches imports and accounts, and is
 * never rendered.
 */
export const blogAuthors = pgTable(
  "blog_authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    /** The archive's address, e.g. "author/maple" for an imported site. */
    path: text("path").notNull(),
    name: text("name").notNull(),
    bio: text("bio"),
    email: text("email"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Per-archive SEO overrides: title, description, noindex. */
    seo: jsonb("seo").notNull().default({}),
    /** Where it came from: "admin", or "import:<run id>". */
    source: text("source").notNull().default("admin"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("blog_authors_slug_idx").on(t.slug),
    uniqueIndex("blog_authors_path_idx").on(t.path),
    uniqueIndex("blog_authors_user_idx").on(t.userId).where(sql`${t.userId} is not null`),
  ],
);

/** Categories (hierarchical) and tags (flat) share one table. */
export const blogTerms = pgTable(
  "blog_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxonomy: text("taxonomy", { enum: BLOG_TAXONOMIES }).notNull(),
    slug: text("slug").notNull(),
    /** The archive's address: base plus the ancestors' slugs for a category. */
    path: text("path").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id").references((): AnyPgColumn => blogTerms.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    seo: jsonb("seo").notNull().default({}),
    source: text("source").notNull().default("admin"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("blog_terms_taxonomy_allowed", sql`${t.taxonomy} in ('category', 'tag')`),
    uniqueIndex("blog_terms_slug_idx").on(t.taxonomy, t.slug),
    uniqueIndex("blog_terms_path_idx").on(t.path),
    index("blog_terms_parent_idx").on(t.parentId),
  ],
);

/** The row that makes a page a post. */
export const blogPosts = pgTable(
  "blog_posts",
  {
    pageId: uuid("page_id")
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => blogAuthors.id, { onDelete: "set null" }),
    /** Per-post switch; the site-wide switch can still close every post. */
    commentsEnabled: boolean("comments_enabled").notNull().default(true),
    /** When the content last changed where it was first published. */
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    source: text("source").notNull().default("admin"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("blog_posts_author_idx").on(t.authorId)],
);

export const blogPostTerms = pgTable(
  "blog_post_terms",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => blogPosts.pageId, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => blogTerms.id, { onDelete: "cascade" }),
    /** The first category is the post's primary one (breadcrumbs). */
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.termId] }),
    index("blog_post_terms_term_idx").on(t.termId),
  ],
);
