// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.22: show a Web Push message and open its link. Nothing else lives here:
// no caching, no analytics, no third-party scripts.
self.addEventListener("push", (event) => {
  let message = { title: "", body: "" };
  try {
    message = event.data ? event.data.json() : message;
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Notification", {
      body: message.body || "",
      tag: message.tag,
      data: { href: message.href || "/portal/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/portal/notifications";
  // Only ever open this site.
  const target = new URL(href, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(target.href));
});
