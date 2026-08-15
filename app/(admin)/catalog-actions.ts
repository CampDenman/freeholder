// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin catalog admin callers. Lifecycle rules, stale-write refusal and audit
// remain in the catalog services used by HTTP and MCP too.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  activateProduct,
  archiveProduct,
  createProduct,
  restoreProduct,
  updateProduct,
  updateProductDescription,
} from "@/modules/catalog/service";
import type { EditorNode } from "./admin/BlockEditor";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function errorMessage(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  console.error("catalog action failed", error);
  return "The product could not be saved. Nothing was changed.";
}

export async function productAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  let destination = "/admin/products";
  try {
    const actor = await currentActor();
    if (intent === "create") {
      const product = await createProduct.call(
        {
          name: field(form, "name"),
          slug: field(form, "slug"),
          kind: field(form, "kind"),
          visibility: field(form, "visibility") || "public",
          subtitle: field(form, "subtitle") || undefined,
          brand: field(form, "brand") || undefined,
          taxCategoryId: field(form, "taxCategoryId") || undefined,
        },
        actor,
      );
      destination = `/admin/products/${product.id}?saved=created`;
    } else {
      const id = field(form, "id");
      const expectedVersion = Number(field(form, "expectedVersion"));
      destination = `/admin/products/${id}`;
      if (intent === "update") {
        await updateProduct.call(
          {
            id,
            expectedVersion,
            name: field(form, "name"),
            slug: field(form, "slug"),
            ...(field(form, "kind") ? { kind: field(form, "kind") } : {}),
            subtitle: field(form, "subtitle") || null,
            brand: field(form, "brand") || null,
            visibility: field(form, "visibility"),
            taxCategoryId: field(form, "taxCategoryId") || null,
            seo: {
              ...(field(form, "seoTitle") ? { title: field(form, "seoTitle") } : {}),
              ...(field(form, "seoDescription")
                ? { description: field(form, "seoDescription") }
                : {}),
            },
          },
          actor,
        );
      } else if (intent === "activate") {
        await activateProduct.call({ id, expectedVersion }, actor);
      } else if (intent === "archive") {
        await archiveProduct.call(
          { id, expectedVersion, reason: field(form, "reason") },
          actor,
        );
      } else if (intent === "restore") {
        await restoreProduct.call(
          { id, expectedVersion, reason: field(form, "reason") },
          actor,
        );
      } else {
        throw new ServiceError("validation", "Choose a product action.");
      }
      destination += `?saved=${encodeURIComponent(intent)}`;
    }
  } catch (error) {
    const id = field(form, "id");
    destination = id ? `/admin/products/${id}` : "/admin/products/new";
    destination += `?error=${encodeURIComponent(errorMessage(error))}`;
  }
  revalidatePath("/admin/products");
  redirect(destination);
}

export interface ProductDescriptionResult {
  error?: string;
  version?: number;
}

export async function saveProductDescriptionAction(
  id: string,
  expectedVersion: number,
  description: EditorNode[],
): Promise<ProductDescriptionResult> {
  try {
    const product = await updateProductDescription.call(
      { id, expectedVersion, description },
      await currentActor(),
    );
    revalidatePath(`/admin/products/${id}`);
    return { version: product.version };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
