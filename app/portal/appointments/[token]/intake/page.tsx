// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The intake form a service asks for (C6.09, MASTER.md §4.4, §4.6).
//
// The *same* form the rest of the site renders, with a different destination —
// which is why `RenderedForm` is imported rather than reimplemented. A second
// copy of that markup would be a second copy of the honeypot inside it, and
// that is the part that fails silently: a real person's answers quietly
// discarded because their phone filled in a box they could not see.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { bookingByToken } from "@/core/scheduling/bookings";
import { getT } from "../../../../i18n";
import { submitIntakeAction } from "../../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("myBooking.intake"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const [t, booking, query] = await Promise.all([
    getT(),
    bookingByToken.call({ token }, { kind: "anonymous" }),
    searchParams,
  ]);
  if (!booking?.intakeFormId) notFound();

  const [{ getFormById }, { RenderedForm }, { issueStamp }] = await Promise.all([
    import("@/modules/forms/service"),
    import("@/modules/forms/block"),
    import("@/modules/forms/antispam"),
  ]);
  const form = await getFormById.call(
    { id: booking.intakeFormId },
    { kind: "anonymous" },
  );
  // A form retired between the booking and the visit leaves nothing to fill
  // in. Better an honest 404 than a page with no fields on it.
  if (!form || form.status === "closed") notFound();

  return (
    <div className="mx-auto grid max-w-2xl gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <div>
          <a href={`/portal/appointments/${token}`} className="text-sm text-ink-muted">
            {t("myBooking.title")}
          </a>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{form.name}</h1>
        </div>

        {query.error ? (
          <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {query.error.includes(" ") ? query.error : t("myBooking.failed")}
          </p>
        ) : null}

        <Card>
          <CardHeader title={t("myBooking.intake")} />
          <CardBody>
            <RenderedForm
              form={{
                slug: form.slug,
                name: form.name,
                fields: form.fields as never,
                submitLabel: form.submitLabel,
                successMessage: form.successMessage,
                // Issued per render: the trap measures the gap between the
                // page being built and the answer arriving, so a stamp reused
                // across renders would measure nothing.
                stamp: issueStamp(),
              }}
              failed={Boolean(query.error)}
              t={t}
              action={submitIntakeAction}
              extraFields={<input type="hidden" name="bookingToken" value={token} />}
            />
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
