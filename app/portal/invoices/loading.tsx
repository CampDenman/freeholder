// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { getT } from "../../i18n";
export default async function LoadingInvoice() {
  const t = await getT();
  return <main className="mx-auto max-w-3xl p-6"><p role="status">{t("common.working")}</p></main>;
}
