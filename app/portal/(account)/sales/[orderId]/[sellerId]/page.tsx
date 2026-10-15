// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: one sale, seen by the seller.
import type { Metadata } from "next";
import { getT } from "../../../../../i18n";
import { SaleView } from "../../../sales/SaleView";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.sales.sales"), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: Promise<{ orderId: string; sellerId: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const [{ orderId, sellerId }, query] = await Promise.all([params, searchParams]);
  return <SaleView orderId={orderId} sellerId={sellerId} side="seller" query={query} />;
}
