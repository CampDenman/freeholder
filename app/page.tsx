// SPDX-License-Identifier: AGPL-3.0-only
// Placeholder home. Replaced by the cms module's block renderer (§7 step 6);
// until then it proves the SSR pipeline: complete HTML, no client JS needed.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">Freeholder</h1>
      <p className="text-muted">
        The open-source operating system for a one-person business. This
        instance hasn&apos;t been set up yet — the setup wizard arrives with
        the core module.
      </p>
    </main>
  );
}
