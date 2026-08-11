// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The way back in when nobody can sign in (MASTER.md §9, §13).
//
// An owner who has lost their password cannot be helped by anything inside the
// product: every screen that could reset it is behind the sign-in they cannot
// pass. Email-based reset is the usual answer and it needs a mail adapter,
// which does not exist yet — and even when it does, an instance whose SMTP
// credentials are wrong has the same problem with an extra step.
//
// So the last resort is the one thing an owner always has: shell access to
// their own machine. That is not a weaker guarantee than a hosted product's
// support queue; it is a stronger one, and it belongs to them.
//
// ── Why this prints SQL instead of running it ─────────────────────────────
//
// Inside the published container there is no Postgres driver to import: the
// application bundles its own, and `node_modules` in a standalone build holds
// four packages. Hashing needs nothing but `node:crypto`, so this computes the
// hash where the code lives and hands the operator a statement to run against
// the database container, which has `psql`. Two commands, no second copy of
// the hashing format, and nothing new in the image.
//
// Where a real driver *is* available — a developer's checkout — it offers to
// do the whole thing itself.
//
// Usage:
//   node scripts/owner-password.mjs [new-password] [--disable-2fa]
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// The parameters and the record format of src/core/auth/passwords.ts. They are
// restated rather than imported because that module cannot be reached from
// inside the runtime image — and they are *self-describing on the row*, so a
// hash written here is verified by the same code as any other.
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

/**
 * Readable, and long enough that reading it aloud is still safe.
 *
 * Avoids the characters people mistake for each other, because this gets typed
 * by hand exactly once by somebody already having a bad day.
 */
function generatePassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(24);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

const disableTwoFactor = process.argv.includes("--disable-2fa");
const password = process.argv.slice(2).find((value) => value !== "--disable-2fa") ?? generatePassword();
if (password.length < 12) {
  console.error("A password needs at least 12 characters.");
  process.exit(1);
}

const hash = await hashPassword(password);

// Sessions go too. If somebody is resetting the owner's password, the
// assumption that every existing session is theirs is exactly the assumption
// worth abandoning.
const ownerIds = "select id from users where role = 'owner'";
const twoFactorReset = disableTwoFactor
  ? `
delete from two_factor_challenges where user_id in (${ownerIds});
delete from two_factor_recovery_codes where user_id in (${ownerIds});
delete from webauthn_credentials where user_id in (${ownerIds});
delete from totp_factors where user_id in (${ownerIds});`
  : "";
const sql = `update users set password_hash = '${hash}' where role = 'owner';
delete from sessions where user_id in (${ownerIds});${twoFactorReset}`;

console.log(`
The new owner password — copy it somewhere safe now, it is not stored anywhere
else and this is the only time it is shown:

    ${password}

It is not in effect yet. Run this against the database to install it:

    docker compose exec -T db psql -U freeholder -d freeholder <<'SQL'
${sql}
SQL

Then sign in and change it from Settings, so the password that ends up in your
shell history is not the one you keep.${disableTwoFactor ? " Two-factor authentication was also disabled; enrol it again immediately from Security." : ""}
`);
