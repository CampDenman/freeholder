// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared locale fixtures for catalog, routing and layout gates (MASTER C1.17).

export const LOCALE_FIXTURES = [
  {
    locale: "en",
    regionalLocale: "en-CA",
    nativeName: "English",
    direction: "ltr",
    path: "/services",
    save: "Save",
    portalTitle: "Customer sign-in",
    contacts: ["No contacts yet", "1 contact", "7 contacts"],
  },
  {
    locale: "fr",
    regionalLocale: "fr-CA",
    nativeName: "Français",
    direction: "ltr",
    path: "/fr/services",
    save: "Enregistrer",
    portalTitle: "Connexion client",
    contacts: ["Aucun contact", "1 contact", "7 contacts"],
  },
  {
    locale: "es",
    regionalLocale: "es-MX",
    nativeName: "Español",
    direction: "ltr",
    path: "/es/services",
    save: "Guardar",
    portalTitle: "Acceso de clientes",
    contacts: ["Aún no hay contactos", "1 contacto", "7 contactos"],
  },
] as const;

export const RTL_LOCALE_FIXTURES = [
  { locale: "ar", direction: "rtl" },
  { locale: "he-IL", direction: "rtl" },
  { locale: "fa-AF", direction: "rtl" },
  { locale: "ur-PK", direction: "rtl" },
  // An explicit Latin script must win over Arabic's likely Arab script.
  { locale: "ar-Latn", direction: "ltr" },
] as const;
