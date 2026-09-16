// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Secret-safe ownership export and media inventory (MASTER.md C1.23).
//
// This is the human/data-portability half of ownership. The disaster-recovery
// half remains pg_dump plus separately protected environment secrets: a
// logical export deliberately cannot recreate sessions, bearer tokens, OAuth
// grants, webhook signatures or second factors.
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export const EXPORT_FORMAT = "freeholder-ownership-export/v1";

/** Columns whose contents can authenticate, sign or unlock something. */
export const SECRET_COLUMNS = new Set([
  "access_token",
  "api_key",
  "authorization",
  "challenge",
  "client_secret",
  "code_hash",
  "cookie",
  "credentials",
  "encrypted_secret",
  "otp_secret",
  "password",
  "password_hash",
  "pending_secret",
  "provider_upload_id",
  "refresh_token",
  "secret",
  "session_token",
  "sync_token",
  "token",
  "token_hash",
]);

const RECOVERY_ENVIRONMENT = [
  {
    name: "CREDENTIAL_KEY",
    class: "irreplaceable",
    consequence: "Connected accounts cannot be decrypted and must be re-authorised.",
    fingerprint: true,
  },
  {
    name: "CREDENTIAL_KEY_PREVIOUS",
    class: "temporary-irreplaceable",
    consequence: "Required only while rotating or restoring an archive encrypted under the previous key.",
    fingerprint: true,
  },
  {
    name: "SESSION_SECRET",
    class: "replaceable-with-impact",
    consequence: "Every active session and API key is invalidated when this changes.",
    fingerprint: false,
  },
  {
    name: "DATABASE_URL",
    class: "target-specific",
    consequence: "Supply the restored database address; never copy a source URL into an archive.",
    fingerprint: false,
  },
  {
    name: "S3_ACCESS_KEY_ID",
    class: "reissuable",
    consequence: "Reissue a bucket-scoped key and verify the media manifest after restore.",
    fingerprint: false,
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    class: "reissuable",
    consequence: "Reissue a bucket-scoped key and verify the media manifest after restore.",
    fingerprint: false,
  },
  ...[
    "TEST_DATABASE_URL",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "POSTMARK_SERVER_TOKEN",
    "POSTMARK_ACCOUNT_TOKEN",
    "POSTMARK_WEBHOOK_USER",
    "POSTMARK_WEBHOOK_PASSWORD",
    "SES_ACCESS_KEY_ID",
    "SES_SECRET_ACCESS_KEY",
    "SES_SESSION_TOKEN",
    "OPENAI_API_KEY",
    "PARADISEMODERN_API_KEY",
  ].map((name) => ({
    name,
    class: "secret-or-identifier",
    consequence: "Recover or reissue this value only when the matching adapter is enabled.",
    fingerprint: false,
  })),
];

/** Explicitly reviewed, non-secret environment configuration safe to copy. */
const PORTABLE_ENVIRONMENT = [
  "APP_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ADDRESSING_STYLE",
  "S3_PUBLIC_BASE_URL",
  "S3_PUBLIC",
  "CSP_THIRD_PARTY_ORIGINS",
  "MAIL_ADAPTER",
  "SMTP_HOST",
  "SMTP_PORT",
  "MAIL_FROM",
  "MICROSOFT_OAUTH_TENANT",
  "MAIL_BULK_ADAPTER",
  "MAIL_BULK_FROM",
  "POSTMARK_MESSAGE_STREAM",
  "SES_REGION",
  "SES_CONFIGURATION_SET",
  "SES_SNS_TOPIC_ARN",
  "REPLIT_BUCKET_ID",
  "LOCAL_STORAGE_ROOT",
  "FREEHOLDER_STORAGE",
  "MALWARE_SCANNER",
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "OPENAI_ALT_TEXT_MODEL",
  "FREEHOLDER_AGENT",
  "PARADISEMODERN_URL",
  "BUILDER_MONTHLY_TOKEN_BUDGET",
  "BUILDER_MAX_OUTPUT_TOKENS",
  "FREEHOLDER_UNSAFE_LOCAL_STORAGE",
  "FREEHOLDER_SEED_DEMO",
  "FREEHOLDER_JOBS",
];
const PORTABLE_URL_ENVIRONMENT = new Set([
  "APP_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_BASE_URL",
  "PARADISEMODERN_URL",
]);

function normalized(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalized(item)]),
    );
  }
  return value ?? null;
}

export function canonicalJson(value) {
  return JSON.stringify(normalized(value));
}

function prettyJson(value) {
  return `${JSON.stringify(normalized(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isSecretColumn(column) {
  return SECRET_COLUMNS.has(column);
}

function decodeCredentialKey(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  return decoded.length === 32 ? decoded : null;
}

function portableEnvironmentValue(name, value) {
  if (!PORTABLE_URL_ENVIRONMENT.has(name)) return value;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[INVALID URL OMITTED]";
  }
}

export function credentialKeyFingerprint(value) {
  const decoded = decodeCredentialKey(value);
  return decoded ? sha256(decoded) : null;
}

function redactRow(row) {
  function redactValue(value) {
    if (Array.isArray(value)) return value.map(redactValue);
    if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const snakeKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        return [
          key,
          isSecretColumn(snakeKey) && item !== null
            ? "[REDACTED]"
            : redactValue(item),
        ];
      }),
    );
  }
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      isSecretColumn(column) && value !== null
        ? "[REDACTED]"
        : redactValue(value),
    ]),
  );
}

async function writeProtected(file, contents) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, contents, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(file, 0o600);
  return {
    path: file,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
  };
}

function safePathSegment(value) {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

async function ensureEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // This path is created for a runtime export. Without the annotations the
  // standalone tracer assumes it could be the repository root and packages
  // every source, test and documentation file as a possible directory entry.
  const details = await lstat(/* turbopackIgnore: true */ directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Export destination must be a real directory: ${directory}`);
  }
  const entries = await readdir(/* turbopackIgnore: true */ directory);
  if (entries.length > 0) {
    throw new Error(`Export destination is not empty: ${directory}`);
  }
  await chmod(directory, 0o700);
}

async function tableInventory(sql) {
  return sql`
    select table_schema as schema, table_name as name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('information_schema', 'pg_catalog')
      and table_schema not like 'pg_toast%'
      and table_schema not like 'pg_temp_%'
    order by table_schema, table_name
  `;
}

async function tableColumns(sql, schema, table) {
  return sql`
    select column_name as name
    from information_schema.columns
    where table_schema = ${schema} and table_name = ${table}
    order by ordinal_position
  `;
}

async function tableRows(sql, schema, table) {
  const rows = await sql`select * from ${sql(schema)}.${sql(table)}`;
  return [...rows].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function variantKeys(variants) {
  if (!variants || typeof variants !== "object") return [];
  const keys = [];
  for (const entries of Object.values(variants)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && typeof entry.key === "string") {
        keys.push(entry.key);
      }
    }
  }
  return keys;
}

export function buildMediaManifest(assetRows, objectRows) {
  const objects = objectRows.map((row) => ({
    key: row.key,
    assetId: row.asset_id,
    uploadId: row.upload_id,
    role: row.role,
    state: row.state,
    bytes: row.bytes,
    contentType: row.content_type,
  }));
  const inventoryKeys = new Set(objects.map((item) => item.key));
  const expectedKeys = new Set();
  const assets = assetRows.map((row) => {
    expectedKeys.add(row.storage_key);
    const variants = variantKeys(row.variants);
    for (const key of variants) expectedKeys.add(key);
    return {
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      mime: row.mime,
      bytes: row.byte_size,
      status: row.status,
      scanStatus: row.scan_status,
      storageKey: row.storage_key,
      variantKeys: variants,
      checksumSha256: row.checksum_sha256,
      source: row.source,
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
    };
  });
  return {
    format: "freeholder-media-manifest/v1",
    assets,
    objects,
    integrity: {
      missingInventoryKeys: [...expectedKeys]
        .filter((key) => !inventoryKeys.has(key))
        .sort(),
      unreferencedInventoryKeys: [...inventoryKeys]
        .filter((key) => !expectedKeys.has(key))
        .sort(),
    },
  };
}

async function mediaManifest(sql) {
  const tables = await tableInventory(sql);
  const names = new Set(tables.map((item) => `${item.schema}.${item.name}`));
  if (!names.has("public.assets") || !names.has("public.media_objects")) {
    return buildMediaManifest([], []);
  }
  const [assets, objects] = await Promise.all([
    tableRows(sql, "public", "assets"),
    tableRows(sql, "public", "media_objects"),
  ]);
  return buildMediaManifest(assets, objects);
}

function configurationRecord(configuration, environment) {
  return {
    config: {
      filename: path.basename(configuration.filename),
      sha256: sha256(configuration.contents),
    },
    secretValuesIncluded: false,
    databaseDumpContainsEncryptedConnectedAccountCredentials: true,
    logicalExportContainsConnectedAccountCredentials: false,
    portableEnvironment: Object.fromEntries(
      PORTABLE_ENVIRONMENT.filter((name) => environment[name]).map((name) => [
        name,
        portableEnvironmentValue(name, environment[name]),
      ]),
    ),
    environment: RECOVERY_ENVIRONMENT.map((item) => ({
      name: item.name,
      class: item.class,
      configured: Boolean(environment[item.name]),
      consequence: item.consequence,
      ...(item.fingerprint
        ? {
            validFormat: environment[item.name]
              ? Boolean(decodeCredentialKey(environment[item.name]))
              : null,
            fingerprint: credentialKeyFingerprint(environment[item.name]),
          }
        : {}),
    })),
    instructions:
      "Protect CREDENTIAL_KEY separately from the database dump. Match its fingerprint before restore. Never place .env or raw secret values in this export.",
  };
}

export async function databaseFingerprint(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const inventory = [];
    for (const table of await tableInventory(sql)) {
      const rows = await tableRows(sql, table.schema, table.name);
      inventory.push({
        schema: table.schema,
        table: table.name,
        rows: rows.length,
        sha256: sha256(canonicalJson(rows)),
      });
    }
    return inventory;
  } finally {
    await sql.end();
  }
}

export async function createOwnershipExport({
  databaseUrl,
  outputDirectory,
  configuration,
  environment = process.env,
  now = new Date(),
}) {
  if (!databaseUrl) throw new Error("A database URL is required for export.");
  if (!outputDirectory) throw new Error("An output directory is required for export.");
  if (!configuration?.filename || typeof configuration.contents !== "string") {
    throw new Error("Configuration filename and contents are required for export.");
  }

  const output = path.resolve(
    /* turbopackIgnore: true */ outputDirectory,
  );
  await ensureEmptyDirectory(output);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const files = [];
  try {
    const inventory = [];
    for (const table of await tableInventory(sql)) {
      const columns = (await tableColumns(sql, table.schema, table.name)).map(
        (item) => item.name,
      );
      const rows = (await tableRows(sql, table.schema, table.name)).map(redactRow);
      const relative = path.join(
        "data",
        safePathSegment(table.schema),
        `${safePathSegment(table.name)}.json`,
      );
      const contents = prettyJson({
        schema: table.schema,
        table: table.name,
        columns,
        redactedColumns: columns.filter(isSecretColumn),
        rowCount: rows.length,
        rows,
      });
      const written = await writeProtected(path.join(output, relative), contents);
      files.push({
        path: relative.replaceAll(path.sep, "/"),
        bytes: written.bytes,
        sha256: written.sha256,
      });
      inventory.push({
        schema: table.schema,
        table: table.name,
        rows: rows.length,
        redactedColumns: columns.filter(isSecretColumn),
        file: relative.replaceAll(path.sep, "/"),
      });
    }

    const media = await mediaManifest(sql);
    const mediaContents = prettyJson(media);
    const mediaWritten = await writeProtected(
      path.join(output, "media-manifest.json"),
      mediaContents,
    );
    files.push({
      path: "media-manifest.json",
      bytes: mediaWritten.bytes,
      sha256: mediaWritten.sha256,
    });

    const configRelative = path.join(
      "configuration",
      path.basename(configuration.filename),
    );
    const configWritten = await writeProtected(
      path.join(output, configRelative),
      configuration.contents,
    );
    files.push({
      path: configRelative.replaceAll(path.sep, "/"),
      bytes: configWritten.bytes,
      sha256: configWritten.sha256,
    });

    const recovery = configurationRecord(configuration, environment);
    const recoveryContents = prettyJson(recovery);
    const recoveryWritten = await writeProtected(
      path.join(output, "recovery.json"),
      recoveryContents,
    );
    files.push({
      path: "recovery.json",
      bytes: recoveryWritten.bytes,
      sha256: recoveryWritten.sha256,
    });

    const manifest = {
      format: EXPORT_FORMAT,
      createdAt: now.toISOString(),
      secretValuesIncluded: false,
      completeTableInventory: true,
      tableCount: inventory.length,
      rowCount: inventory.reduce((sum, item) => sum + item.rows, 0),
      tables: inventory,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      media: {
        assetCount: media.assets.length,
        objectCount: media.objects.length,
        missingInventoryKeys: media.integrity.missingInventoryKeys.length,
        unreferencedInventoryKeys: media.integrity.unreferencedInventoryKeys.length,
      },
      restore:
        "Use a pg_dump archive plus separately protected environment secrets for disaster recovery. This logical export is secret-safe and is not an authentication-state backup.",
    };
    await writeProtected(path.join(output, "manifest.json"), prettyJson(manifest));
    return { outputDirectory: output, manifest };
  } finally {
    await sql.end();
  }
}

