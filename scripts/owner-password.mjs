// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
// Generated passwords are saved in an exclusive mode-0600 file, never stdout.
import { randomBytes, randomInt, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  return Array.from({ length: 24 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

const disableTwoFactor = process.argv.includes("--disable-2fa");
const supplied = process.argv.slice(2).find((value) => value !== "--disable-2fa");
const password = supplied ?? generatePassword();
let passwordPath;
if (!supplied) {
  const directory = mkdtempSync(join(tmpdir(), "freeholder-owner-recovery-"));
  chmodSync(directory, 0o700);
  passwordPath = join(directory, "password");
  writeFileSync(passwordPath, `${password}\n`, { flag: "wx", mode: 0o600 });
}
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
${passwordPath ? `Generated password saved privately to: ${passwordPath}\nRead it locally, then delete that file after storing it securely.` : "The supplied password is never echoed."}

It is not in effect yet. Run this against the database to install it:

    docker compose exec -T db psql -U freeholder -d freeholder <<'SQL'
${sql}
SQL

Then sign in and change it from Settings. Use a secure local terminal; avoid
putting a chosen password in shell history.${disableTwoFactor ? " Two-factor authentication was also disabled; enrol it again immediately from Security." : ""}
`);
