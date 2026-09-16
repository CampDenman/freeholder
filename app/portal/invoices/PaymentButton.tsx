// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/ui/primitives";

export function PaymentButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : label}</Button>;
}
