// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Railway's current TypeScript infrastructure-as-code entrypoint.
import {
  bucket,
  defineRailway,
  image,
  postgres,
  preserve,
  project,
  ref,
  service,
} from "railway/iac";

export default defineRailway(() => {
  const database = postgres("freeholder-db");
  const media = bucket("freeholder-media", { region: "sjc" });
  const freeholderImage =
    process.env.FREEHOLDER_IMAGE ?? "ghcr.io/campdenman/freeholder:edge";
  const web = service("freeholder-web", {
    source: image(freeholderImage),
    start: "node server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: database.env.DATABASE_URL,
      FREEHOLDER_STORAGE: "s3",
      S3_BUCKET: ref(media, "BUCKET"),
      S3_ENDPOINT: ref(media, "ENDPOINT"),
      S3_ACCESS_KEY_ID: ref(media, "ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: ref(media, "SECRET_ACCESS_KEY"),
      S3_REGION: ref(media, "REGION"),
      S3_ADDRESSING_STYLE: "virtual",
      APP_URL: preserve(),
      SESSION_SECRET: preserve(),
      CREDENTIAL_KEY: preserve(),
    },
  });

  return project("freeholder", { resources: [database, media, web] });
});
